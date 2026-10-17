// The "world" (TinyWorld analogue): roster, shared transcript, phase/turn
// scheduling and the effects of each action. Pure state transitions live here;
// persistence is in store.ts so this module is easy to test.
import type { Entry, EntryKind, PersonaSpec, PhaseDef, SessionState, Task } from "./types.ts";
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

  /** Members who should act now. Empty when the session is done. */
  next(): string[] {
    this.schedule();
    return [...this.state.pending];
  }

  /** A stimulus from outside the simulation (e.g. the real human), like TinyWorld.broadcast. */
  broadcast(text: string, from = "human"): void {
    this.log(from, "say", text, ["all"]);
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
        break;
      }
      case "TASK_START":
      case "TASK_DONE": {
        const tid = a.arg ?? /\bT\d+\b/.exec(a.text)?.[0];
        const t = s.tasks.find((x) => x.id === tid);
        if (!t) {
          this.log("system", "system", `Ignored [${a.type}] from ${m.id}: unknown task "${tid ?? ""}".`);
          break;
        }
        t.status = a.type === "TASK_DONE" ? "done" : "doing";
        t.owner ??= m.id;
        if (a.type === "TASK_DONE") t.summary = a.text;
        this.log(m.id, "task_update", `${t.id} → ${t.status}${a.text ? ": " + a.text : ""}`);
        break;
      }
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
      if (waiting.includes(id) || s.insertions >= speakers.size) continue;
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
        const tasksDone = !!p.untilTasksDone && s.tasks.length > 0 && s.tasks.every((t) => t.status === "done");
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
      const vs = s.verdicts.filter((v) => v.iteration === s.iteration);
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
    const vs = s.verdicts.filter((v) => v.iteration === s.iteration);
    const accepted = vs.filter((v) => v.verdict === "accept").length;
    const summary = vs.length ? `${accepted}/${vs.length} users accepted.` : "No user verdicts were given.";
    const open = s.tasks.filter((t) => t.status !== "done");
    const rest = open.length ? ` Still open (for the human): ${open.map((t) => `${t.id} (${t.title})`).join(", ")}.` : "";
    this.log("system", "system", `Session finished after iteration ${s.iteration}. ${summary}${rest}`);
  }

  private logPhaseStart(): void {
    this.log("system", "system", `Phase "${this.phase.id}" started (iteration ${this.state.iteration}) — ${this.phase.goal}`);
  }

  private log(from: string, kind: EntryKind, text: string, to?: string[]): void {
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
    this.emitted.push(e);
  }
}

const systemNow = () => new Date().toISOString();

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
  const open = s.tasks.filter((t) => t.status !== "done");
  const followUps = open.filter((t) => late(t.phase, t.iteration) && !s.phases.find((p) => p.id === t.phase)?.finale);
  const decisions =
    lastEdit < 0
      ? []
      : s.decisions.filter((d) => d.iteration === s.iteration && s.phases.findIndex((p) => p.id === d.phase) >= lastEdit);
  return { tasks: open.filter((t) => !followUps.includes(t)), decisions, followUps };
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
