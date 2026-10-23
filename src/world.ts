// The "world" (TinyWorld analogue): roster, shared transcript, phase/turn
// scheduling and the effects of each action. Pure state transitions live here;
// persistence is in store.ts so this module is easy to test.
import type { Entry, EntryKind, PersonaSpec, PhaseDef, SessionState, Task, TaskStatus, Trial, Verdict } from "./types.ts";
import { parseReply, type Action } from "./protocol.ts";
import { allowedActions } from "./sop.ts";

interface NewSessionOptions {
  name: string;
  brief: string;
  members: PersonaSpec[];
  phases: PhaseDef[];
  language?: string;
  workspace?: string;
  externalWorkspace?: boolean;
  maxIterations?: number;
  historyWindow?: number;
  now?: () => string;
}

export class World {
  state: SessionState;
  /** Entries produced since construction (to be appended to the transcript by the caller). */
  readonly emitted: Entry[] = [];
  /**
   * Ids of the questions the human has answered, as far as this process knows: the answers in the transcript when it
   * was loaded (Store.load) plus its own. The transcript is the only record of answers, so state.json has none.
   */
  readonly answered = new Set<string>();
  private now: () => string;

  constructor(state: SessionState, now: () => string = systemNow) {
    this.state = state;
    this.now = now;
  }

  static create(o: NewSessionOptions): World {
    const ids = new Set<string>();
    for (const m of o.members) {
      assertPersona(m);
      if (ids.has(m.id)) throw new Error(`duplicate member id: ${m.id}`);
      ids.add(m.id);
    }
    if (o.phases.length === 0) throw new Error("at least one phase is required");
    const now = o.now ?? systemNow;
    const state: SessionState = {
      version: 1,
      name: o.name,
      brief: o.brief,
      language: o.language ?? "ja",
      workspace: o.workspace ?? "workspace",
      ...(o.externalWorkspace ? { externalWorkspace: true } : {}),
      createdAt: now(),
      status: "running",
      members: o.members,
      phases: o.phases,
      phaseIndex: Math.max(0, o.phases.findIndex((p) => !p.finale)),
      iteration: 1,
      maxIterations: o.maxIterations ?? 2,
      round: 0,
      turn: 0,
      queue: [],
      pending: [],
      insertions: 0,
      tasks: [],
      decisions: [],
      verdicts: [],
      demos: [],
      questions: [],
      notes: {},
      historyWindow: o.historyWindow ?? 40,
    };
    const w = new World(state, now);
    w.log("system", "system", `Session "${o.name}" started. Brief: ${o.brief}`);
    w.logPhaseStart();
    w.schedule();
    return w;
  }

  get phase(): PhaseDef {
    return currentPhase(this.state);
  }

  member(id: string): PersonaSpec | undefined {
    return findMember(this.state, id);
  }

  /** Whether the runtime still has to run the verification command before this phase's first turn. */
  get trialDue(): boolean {
    return this.state.status === "running" && !!this.phase.trial && !this.state.trials?.some((t) => t.iteration === this.state.iteration);
  }

  /** Record the runtime's run of the verification command (see trialDue). */
  addTrial(t: Omit<Trial, "iteration" | "at">): void {
    const trial: Trial = { ...t, iteration: this.state.iteration, at: this.now() };
    (this.state.trials ??= []).push(trial);
    const result = !t.command
      ? "No verification command was declared ([VERIFY]); users judge from the demos only."
      : `Trial run of \`${t.command}\`: ${t.timedOut ? "timed out" : `exit ${t.exitCode}`}` +
        (t.artifacts.length ? `, ${t.artifacts.length} file(s) saved` : "") + ".";
    this.log("system", "system", result);
  }

  /** Members who should act now. Empty when the session is done. */
  next(): string[] {
    this.schedule();
    return [...this.state.pending];
  }

  /** A stimulus from outside the simulation (e.g. the real human), like TinyWorld.broadcast. */
  broadcast(text: string, from = "human"): void {
    this.log(from, "say", text, ["all"]);
  }

  /** The real human answers question `id` (e.g. "Q2"). Answering again replaces the answer. Allowed once the session is done. */
  answer(id: string, text: string): void {
    const qs = this.state.questions ?? [];
    const n = Number(/^Q([1-9]\d*)$/i.exec(id.trim())?.[1]);
    const q = qs[n - 1];
    if (!q) throw new Error(`unknown question "${id}" (${qs.length ? `asked so far: Q1..Q${qs.length}` : "no questions have been asked"})`);
    if (!text.trim()) throw new Error("an answer is required");
    const question = questionId(n - 1);
    const given = text.trim();
    const asked = Array.from(q.text.replace(/\s+/g, " ").trim());
    const excerpt = asked.length > 60 ? asked.slice(0, 60).join("") + "…" : asked.join("");
    const replaced = this.answered.has(question) ? ", replacing the earlier answer" : "";
    // A plain message from the human, like `say`: agents copy what they see, so no tag-like kind.
    this.log("human", "say", `Answer to ${question} (${excerpt})${replaced}: ${given}`, ["all"], { question, text: given });
    this.answered.add(question);
  }

  /** Apply an agent's reply and move the schedule forward. Returns the parsed actions. */
  record(id: string, raw: string, opts: { force?: boolean } = {}): Action[] {
    const s = this.state;
    if (s.status !== "running") throw new Error("session is already done");
    const m = this.member(id);
    if (!m) throw new Error(`unknown member: ${id}`);
    if (!s.pending.includes(id) && !opts.force) {
      throw new Error(`it is not ${id}'s turn (waiting for: ${s.pending.join(", ") || "nobody"}). Use --force to interject.`);
    }
    const actions = parseReply(raw);
    const allowed = new Set(allowedActions(m.role));
    s.turn++;
    for (const a of actions) {
      if (!allowed.has(a.type)) {
        this.log("system", "system", `Ignored [${a.type}] from ${id}: not allowed for role "${m.role}".`);
        continue;
      }
      this.apply(m, a);
    }
    s.pending = s.pending.filter((p) => p !== id);
    this.schedule();
    return actions;
  }

  private apply(m: PersonaSpec, a: Action): void {
    const s = this.state;
    switch (a.type) {
      case "THINK":
        this.log(m.id, "think", a.text, [m.id]);
        break;
      case "SAY": {
        const to = (a.attrs.to ?? a.arg ?? "all").split(",").map((t) => t.trim().replace(/^@/, "")).filter(Boolean);
        this.log(m.id, "say", a.text, to);
        this.replyTo(m.id, to);
        break;
      }
      case "NOTE":
        (s.notes[m.id] ??= []).push(a.text);
        this.log(m.id, "note", a.text, [m.id]);
        break;
      case "TASK": {
        const [title, ...rest] = a.text.split("\n");
        const owner = a.attrs.owner?.replace(/^@/, "");
        const t: Task = {
          id: `T${s.tasks.length + 1}`,
          title: (title || a.arg || "untitled").trim(),
          acceptance: rest.join("\n").trim(),
          owner,
          status: "todo",
          createdBy: m.id,
          phase: this.phase.id,
          iteration: s.iteration,
        };
        s.tasks.push(t);
        this.log(m.id, "task", `${t.id} owner=${owner ?? "-"}: ${t.title}${t.acceptance ? "\n" + t.acceptance : ""}`);
        if (owner && !this.member(owner)) this.log("system", "system", `Warning: ${t.id} owner "${owner}" is not a team member.`);
        // [TASK replaces=T1]: the new task supersedes T1, so T1 no longer holds the build open.
        for (const old of (a.attrs.replaces ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
          const o = s.tasks.find((x) => x.id === old && x !== t);
          if (!o) {
            this.log("system", "system", `Warning: ${t.id} replaces unknown task "${old}".`);
            continue;
          }
          if (o.status === "dropped") {
            this.log("system", "system", `Ignored replaces=${old} from ${m.id}: ${old} is already dropped.`);
            continue;
          }
          this.updateTask(m.id, o, "dropped", `replaced by ${t.id}`);
        }
        break;
      }
      case "TASK_START":
      case "TASK_DONE":
      case "TASK_BLOCKED":
      case "TASK_DROP":
      case "CHECK": {
        const tid = a.arg ?? /\bT\d+\b/.exec(a.text)?.[0];
        const t = s.tasks.find((x) => x.id === tid);
        if (!t) {
          this.log("system", "system", `Ignored [${a.type}] from ${m.id}: unknown task "${tid ?? ""}".`);
          break;
        }
        // A dropped task is closed for good: an engineer's stale TASK_START must not bring it back.
        if (t.status === "dropped") {
          this.log("system", "system", `Ignored [${a.type}] from ${m.id}: ${t.id} is already dropped.`);
          break;
        }
        if (a.type === "CHECK") {
          this.addCheck(m.id, t, a.text);
          break;
        }
        t.owner ??= m.id;
        this.updateTask(m.id, t, TASK_STATUS[a.type], a.type === "TASK_START" ? undefined : a.text);
        break;
      }
      case "VERIFY": {
        const command = a.text.replace(/^`+|`+$/g, "").trim();
        if (!command || command.includes("\n")) {
          this.log("system", "system", `Ignored [VERIFY] from ${m.id}: give one command on one line.`);
          break;
        }
        s.verify = { command, by: m.id };
        this.log(m.id, "verify", command);
        break;
      }
      case "ASK_HUMAN":
        (s.questions ??= []).push({ by: m.id, text: a.text, phase: this.phase.id, iteration: s.iteration });
        this.log(m.id, "ask_human", a.text, ["human"]);
        break;
      case "DEMO": {
        const tid = a.arg ?? /\bT\d+\b/.exec(a.text)?.[0];
        (s.demos ??= []).push({ by: m.id, text: tid && a.arg ? `${tid}: ${a.text}` : a.text, phase: this.phase.id, iteration: s.iteration });
        this.log(m.id, "demo", tid && a.arg ? `${tid}: ${a.text}` : a.text);
        break;
      }
      case "DECISION":
        s.decisions.push({ by: m.id, text: a.text, phase: this.phase.id, iteration: s.iteration });
        this.log(m.id, "decision", a.text);
        break;
      case "ADVANCE":
        // Finishing the round early makes the scheduler end the phase.
        s.round = this.phase.maxRounds;
        s.queue = [];
        this.log(m.id, "advance", a.text || `End of phase "${this.phase.id}".`);
        break;
      case "VERDICT": {
        const v = (a.arg ?? a.attrs.v ?? "").toLowerCase();
        if (v !== "accept" && v !== "reject") {
          this.log("system", "system", `Ignored [VERDICT] from ${m.id}: use "accept" or "reject".`);
          break;
        }
        s.verdicts.push({ by: m.id, verdict: v, reason: a.text, iteration: s.iteration });
        this.log(m.id, "verdict", `${v.toUpperCase()}: ${a.text}`);
        break;
      }
      case "DONE":
        break;
    }
  }

  private updateTask(by: string, t: Task, status: TaskStatus, text?: string): void {
    t.status = status;
    if (status === "blocked") t.handoff = text ?? "";
    else {
      delete t.handoff;
      if (text !== undefined) t.summary = text;
    }
    this.log(by, "task_update", `${t.id} → ${status}${text ? ": " + text : ""}`);
  }

  /** [CHECK]: something a person should check on a built task. Neither its status nor its summary changes. */
  private addCheck(by: string, t: Task, text: string): void {
    const ignore = (why: string) => this.log("system", "system", `Ignored [CHECK] from ${by}: ${why}`);
    if (t.status !== "done") {
      return ignore(`${t.id} is not done. Use [CHECK] on a built task, or [TASK_BLOCKED] to hand work over to a person.`);
    }
    if (!text) return ignore(`say what a person should check on ${t.id}.`);
    if (t.checks?.includes(text)) return ignore(`${t.id} already has that check.`);
    (t.checks ??= []).push(text);
    this.log(by, "task_update", `${t.id} check by a person: ${text}`);
  }

  /**
   * Conversation dynamics: addressed members who are still waiting this round
   * speak next; addressed members who already spoke get one more turn at the
   * end of the round (capped per round so an interview cannot ping-pong forever).
   */
  private replyTo(from: string, to: string[]): void {
    const s = this.state;
    if (to.includes("all")) return;
    const speakers = new Set(this.order());
    const targets = to.filter((id) => id !== from && speakers.has(id) && !s.pending.includes(id));
    const waiting = targets.filter((id) => s.queue.includes(id));
    s.queue = [...waiting, ...s.queue.filter((q) => !waiting.includes(q))];
    for (const id of targets) {
      if (waiting.includes(id) || s.insertions >= REPLY_BUDGET * speakers.size) continue;
      s.queue.push(id);
      s.insertions++;
    }
  }

  /** Members of the current phase, in speaking order. */
  order(): string[] {
    const out: string[] = [];
    for (const role of this.phase.speakers) for (const m of this.state.members) if (m.role === role) out.push(m.id);
    return out;
  }

  private schedule(): void {
    const s = this.state;
    for (let guard = 0; s.status === "running" && s.pending.length === 0; guard++) {
      if (guard > 1000) throw new Error("scheduler did not converge");
      if (s.queue.length === 0) {
        const p = this.phase;
        const tasksDone = !!p.untilTasksDone && s.tasks.length > 0 && s.tasks.every(isSettled);
        if (s.round > 0 && (s.round >= p.maxRounds || tasksDone)) {
          this.endPhase();
          continue;
        }
        const order = this.order();
        s.round++;
        s.insertions = 0;
        s.queue = order;
        if (order.length === 0) s.round = p.maxRounds; // nobody can act in this phase
        continue;
      }
      if (this.phase.mode === "parallel") {
        s.pending = s.queue;
        s.queue = [];
      } else {
        s.pending = [s.queue.shift()!];
      }
    }
  }

  /**
   * Next phase; after the last one, either loop (users rejected) or finish. Before finishing, a `finale`
   * phase (wrap-up) runs once if tasks are still open or decisions came after the last chance to build.
   */
  private endPhase(): void {
    const s = this.state;
    s.round = 0;
    s.queue = [];
    if (!this.phase.finale) {
      const next = s.phases.findIndex((p, i) => i > s.phaseIndex && !p.finale);
      if (next >= 0) {
        s.phaseIndex = next;
        this.logPhaseStart();
        return;
      }
      const vs = latestVerdicts(s, s.iteration);
      const rejected = vs.filter((v) => v.verdict === "reject");
      // Tasks added after the last chance to build (e.g. users' conditions in acceptance) are new scope:
      // build them in another iteration so users see them, never silently in wrap-up.
      const followUps = wrapupItems(s).followUps;
      if ((rejected.length > 0 || followUps.length > 0) && s.iteration < s.maxIterations) {
        s.iteration++;
        s.phaseIndex = Math.max(0, s.phases.findIndex((p) => p.iterationStart && !p.finale));
        const why = rejected.length
          ? `${rejected.length}/${vs.length} users rejected (${rejected.map((r) => r.by).join(", ")})`
          : `follow-up tasks were added after the build (${followUps.map((t) => t.id).join(", ")})`;
        this.log("system", "system", `Iteration ${s.iteration} begins: ${why}.`);
        this.logPhaseStart();
        return;
      }
      const finale = s.phases.findIndex((p) => p.finale);
      const left = wrapupItems(s);
      if (finale >= 0 && (left.tasks.length || left.decisions.length || left.followUps.length)) {
        s.phaseIndex = finale;
        this.log(
          "system",
          "system",
          `Wrap-up before finishing: ${left.tasks.length} open task(s), ${left.decisions.length} late decision(s) to apply, ` +
            `${left.followUps.length} follow-up(s) to hand over.`,
        );
        this.logPhaseStart();
        return;
      }
    }
    this.finish();
  }

  private finish(): void {
    const s = this.state;
    s.status = "done";
    const vs = latestVerdicts(s, s.iteration);
    const accepted = vs.filter((v) => v.verdict === "accept").length;
    const summary = vs.length ? `${accepted}/${vs.length} users accepted.` : "No user verdicts were given.";
    const list = (status: (t: Task) => boolean) =>
      s.tasks
        .filter(status)
        .map((t) => `${t.id} (${t.title})`)
        .join(", ");
    const open = list((t) => !isSettled(t));
    const blocked = list((t) => t.status === "blocked");
    const checked = list((t) => t.status === "done" && !!t.checks?.length);
    const unanswered = (s.questions ?? []).filter((_, i) => !this.answered.has(questionId(i)));
    const rest = [
      checked && `Built, a person should check: ${checked}.`,
      open && `Still open: ${open}.`,
      blocked && `Waiting on a person: ${blocked}.`,
      unanswered.length && `${unanswered.length} question(s) for the human (see team status).`,
    ].filter(Boolean);
    this.log("system", "system", `Session finished after iteration ${s.iteration}. ${summary}${rest.map((r) => " " + r).join("")}`);
  }

  private logPhaseStart(): void {
    this.log("system", "system", `Phase "${this.phase.id}" started (iteration ${this.state.iteration}) — ${this.phase.goal}`);
  }

  private log(from: string, kind: EntryKind, text: string, to?: string[], answers?: Entry["answers"]): void {
    const e: Entry = {
      turn: this.state.turn,
      at: this.now(),
      phase: this.phase.id,
      iteration: this.state.iteration,
      from,
      kind,
      text,
    };
    if (to) e.to = to;
    if (answers) e.answers = answers;
    this.emitted.push(e);
  }
}

const systemNow = () => new Date().toISOString();

/** Extra reply turns per round, per speaker: enough for a few question-and-answer exchanges, but bounded. */
const REPLY_BUDGET = 2;

const TASK_STATUS: Record<string, TaskStatus> = {
  TASK_START: "doing",
  TASK_DONE: "done",
  TASK_BLOCKED: "blocked",
  TASK_DROP: "dropped",
};

/** Questions are append-only, so the i-th one is always `Q{i+1}`; the id is never stored. */
export const questionId = (i: number) => `Q${i + 1}`;

/** Decisions are append-only, so the i-th one is always `D{i+1}`; the id is never stored. */
export const decisionId = (i: number) => `D${i + 1}`;

/** The latest answer per question id from `team answer` entries (a later one replaces an earlier one). */
export function answersByQuestion(entries: readonly Entry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) if (e.answers) out.set(e.answers.question, e.answers.text);
  return out;
}

/** Nothing more the team itself can do: done, dropped, or waiting on a real person. */
export function isSettled(t: Task): boolean {
  return t.status === "done" || t.status === "dropped" || t.status === "blocked";
}

/**
 * What a wrap-up phase must take care of: tasks not done, and decisions of this iteration made in or after the
 * last regular phase where anyone could edit the workspace (so nobody has applied them yet). Open tasks created
 * after that phase are follow-ups: new scope that users have not seen, handed over instead of built.
 */
export function wrapupItems(s: SessionState): {
  tasks: Task[];
  decisions: SessionState["decisions"];
  followUps: Task[];
} {
  const regular = s.phases.map((p, i) => ({ p, i })).filter(({ p }) => !p.finale);
  const lastEdit = Math.max(-1, ...regular.filter(({ p }) => p.editors?.length).map(({ i }) => i));
  const late = (phase: string | undefined, iteration: number | undefined) =>
    lastEdit >= 0 && iteration === s.iteration && s.phases.findIndex((p) => p.id === phase) > lastEdit;
  const open = s.tasks.filter((t) => !isSettled(t));
  const followUps = open.filter((t) => late(t.phase, t.iteration) && !s.phases.find((p) => p.id === t.phase)?.finale);
  const decisions =
    lastEdit < 0
      ? []
      : s.decisions.filter((d) => d.iteration === s.iteration && s.phases.findIndex((p) => p.id === d.phase) >= lastEdit);
  return { tasks: open.filter((t) => !followUps.includes(t)), decisions, followUps };
}

/** An iteration's outcome: each user's latest verdict in it (a user may speak again and change their mind). */
export function latestVerdicts(s: SessionState, iteration: number): Verdict[] {
  const latest = new Map<string, Verdict>();
  for (const v of s.verdicts) if (v.iteration === iteration) latest.set(v.by, v);
  return [...latest.values()];
}

export function currentPhase(s: SessionState): PhaseDef {
  return s.phases[s.phaseIndex];
}

export function findMember(s: SessionState, id: string): PersonaSpec | undefined {
  return s.members.find((m) => m.id === id);
}

export function assertPersona(m: PersonaSpec, where = "persona"): void {
  if (!m?.id || !m.role || !m.persona?.name) throw new Error(`${where}: needs "id", "role" and "persona.name"`);
}

/** Private entries (thoughts, notes) belong only to their author's memory. */
export function isPrivate(e: Entry): boolean {
  return e.kind === "think" || e.kind === "note";
}

/** Whether a transcript entry is part of `member`'s episodic memory. */
export function visibleTo(e: Entry, member: string): boolean {
  return !isPrivate(e) || e.from === member;
}
