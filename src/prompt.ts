// Builds the turn prompt for one agent: persona spec + role + shared state +
// its own memory (episodic: visible transcript window, semantic: notes).
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type { Entry, SessionState, Trial } from "./types.ts";
import { ACTION_HELP, PROTOCOL_HELP } from "./protocol.ts";
import { EXTERNAL_WORKSPACE_GUIDE, allowedActions, canEdit, roleGuide, workspaceGuide } from "./sop.ts";
import { formatBacklog, formatEntry, formatQuestions } from "./render.ts";
import { currentPhase, findMember, visibleTo, wrapupItems } from "./world.ts";

export interface TurnPrompt {
  member: string;
  role: string;
  /** Whether this member may edit the workspace this turn (decided by the phase, not the backend). */
  canEdit: boolean;
  system: string;
  user: string;
}

/**
 * @param files workspace listing from listWorkspace(); compute it once per step and share it
 *              between members acting in the same step.
 * @param extra other sessions' changes in the same repository (from otherSessionChanges()), shown to engineers.
 */
export function buildPrompt(
  s: SessionState,
  memberId: string,
  entries: Entry[],
  files: string[],
  extra: { others?: string[] } = {},
): TurnPrompt {
  const m = findMember(s, memberId);
  if (!m) throw new Error(`unknown member: ${memberId}`);
  const phase = currentPhase(s);
  const edit = canEdit(phase, m.role);

  const system = [
    `You are ${m.persona.name} (id: ${m.id}), role: ${m.role}. You take part in a simulated product team.`,
    "Stay fully in character as described by your persona spec. Never mention that you are an AI or a simulation.",
    "",
    "## Your persona spec",
    "```json",
    JSON.stringify(m.persona, null, 2),
    "```",
    "",
    "## Your role",
    roleGuide(m.role),
    "",
    `Always write the content of your messages in the language "${s.language}".`,
    MEETING_STYLE,
  ].join("\n");

  // Walk back from the end: only the latest window of visible entries is needed.
  const window: Entry[] = [];
  let i = entries.length - 1;
  for (; i >= 0 && window.length < s.historyWindow; i--) if (visibleTo(entries[i], m.id)) window.unshift(entries[i]);
  const older = i >= 0;
  const notes = s.notes[m.id] ?? [];
  const actions = allowedActions(m.role).filter((a) => ACTION_HELP[a]);

  const roster = s.members.map((x) => `- ${x.id}: ${x.persona.name} (${x.role})${x.id === m.id ? "  ← you" : ""}`);
  const decisions = s.decisions.length ? s.decisions.map((d) => `- ${d.text}`) : ["(none)"];
  // Demos of this iteration stay in view even when they scroll out of the history window.
  const demos = (s.demos ?? []).filter((d) => d.iteration === s.iteration);
  const showDemos = demos.length > 0 && (m.role !== "engineer" || phase.finale);
  const wrap = phase.finale ? wrapupItems(s) : undefined;
  const others = m.role === "engineer" ? (extra.others ?? []) : [];
  const questions = m.role !== "user" && s.questions?.length ? formatQuestions(s) : "";
  const trial = s.trials?.find((t) => t.iteration === s.iteration);
  const lastSay = entries.findLast((e) => e.kind === "say" && e.from === m.id);
  const longLast = lastSay && lastSay.text.length > LONG_SAY ? lastSay.text.length : 0;
  const rejections = m.role === "pm" && phase.iterationStart ? rejectionsToAddress(s) : [];

  const user = [
    "## Product brief",
    s.brief,
    "",
    `## Current phase: ${phase.id} (iteration ${s.iteration}/${s.maxIterations}, round ${s.round}/${phase.maxRounds})`,
    `Goal: ${phase.goal}`,
    "",
    "## Team",
    ...roster,
    "",
    "## Backlog",
    formatBacklog(s.tasks, "(no tasks yet)"),
    "",
    "## Decisions",
    ...decisions,
    ...(wrap
      ? [
          "",
          "## Wrap-up checklist (must be settled before the session ends)",
          ...wrap.tasks.map((t) => `- open task ${t.id} owner=${t.owner ?? "-"}: ${t.title}`),
          ...wrap.decisions.map((d) => `- decision to apply (${d.phase}): ${d.text}`),
          ...wrap.followUps.map(
            (t) => `- follow-up ${t.id} (added in ${t.phase}; users have not seen it): do NOT build it, hand it over: ${t.title}`,
          ),
        ]
      : []),
    ...(questions
      ? ["", "## Questions already sent to the human (unanswered unless the human said otherwise; keep going on the defaults)", questions]
      : []),
    ...(rejections.length
      ? [
          "",
          "## Rejections from the last iteration",
          ...rejections,
          "Before planning fixes, write down in one sentence the premise of the current product that each rejection " +
            "contradicts (e.g. \"users start it from a terminal\"), and decide whether to change that premise instead of " +
            "patching around it. A user who rejected for the same reason again means the last fixes rested on a wrong premise.",
        ]
      : []),
    ...(trial ? ["", ...formatTrial(trial)] : []),
    ...(showDemos ? ["", "## Demos shown by the team (this iteration)", ...demos.map((d) => `- ${displayDemo(s, d)}`)] : []),
    ...(notes.length ? ["", "## Your long-term notes", ...notes.map((n) => `- ${n}`)] : []),
    "",
    `## Workspace (${s.workspace}/)`,
    workspaceGuide(m.role),
    ...(m.role === "engineer" ? [`Artifacts folder for evidence (relative to the repository root): ${artifactsDir(s.name)}/`] : []),
    ...(s.externalWorkspace && m.role === "engineer" ? [EXTERNAL_WORKSPACE_GUIDE] : []),
    edit ? "You may edit files in the workspace during this phase." : "Do not edit files during this phase.",
    ...(s.externalWorkspace ? ["Files changed so far (git status, relative to the workspace):"] : []),
    ...(files.length ? files.map((f) => `- ${f}`) : [s.externalWorkspace ? "(no changes yet)" : "(empty)"]),
    ...(others.length
      ? [
          "",
          "## Other sessions changing the same repository",
          "Avoid clashing with these (e.g. do not reuse a migration number or edit the same file without need):",
          ...others.map((o) => `- ${o}`),
        ]
      : []),
    "",
    `## Conversation so far${older ? ` (latest ${window.length}; older entries omitted)` : ""}`,
    ...(window.length ? window.map((e) => formatEntry(s, e)) : ["(nothing yet)"]),
    "",
    "## Your turn",
    `It is now your turn, ${m.persona.name}. Act according to the phase goal and your persona.`,
    ...(longLast ? [`Your last message was ${longLast} characters, which read like a written report. Talk this time: respond to the others and leave reference material to tasks and notes.`] : []),
    PROTOCOL_HELP,
    ...actions.map((a) => "  " + ACTION_HELP[a]),
  ].join("\n");

  return { member: m.id, role: m.role, canEdit: edit, system, user };
}

/** The team talks in a meeting: short remarks and questions; long material goes into tasks, demos and notes. */
const MEETING_STYLE =
  "This is a live meeting, not an exchange of written reports. Speak the way you would out loud, in your own voice: " +
  "casual spoken language, no headings or bullet lists, react to what the last person just said (agree, push back, " +
  "ask back), answer what you were asked before moving on, and when you need someone's input, ask them directly " +
  "(to=<id>) so they answer next. A remark can be long when you are explaining something, but it is still talk. " +
  "Put reference material (specs, file lists, test output, step-by-step plans) in [TASK], [TASK_DONE], [DEMO] or [NOTE].";

/** A [SAY] longer than this (characters) reads as a report; its author gets a reminder on their next turn. */
const LONG_SAY = 800;

/** Where a session keeps evidence files: screenshots, generated files, trial runs. */
export function artifactsDir(session: string): string {
  return `.team/sessions/${session}/artifacts`;
}

function formatTrial(t: Trial): string[] {
  if (!t.command)
    return ["## Trial run", "The team declared no verification command, so nothing was run for users; judge from the demos only."];
  const status = t.timedOut ? "timed out (stopped)" : t.exitCode === 0 ? "exit 0 (passed)" : `exit ${t.exitCode} (FAILED)`;
  return [
    `## Trial run (iteration ${t.iteration}): real output, produced by the team's runtime, not written by the team`,
    `Command (run in the workspace): ${t.command}`,
    `Result: ${status}`,
    "```",
    t.output.trim() || "(no output)",
    "```",
    ...(t.artifacts.length
      ? ["Files it saved (open them; screenshots are images you can read):", ...t.artifacts.map((a) => `- ${a}`)]
      : []),
  ];
}

/** Last iteration's rejections, marking users who rejected in every iteration so far (the fixes did not land). */
function rejectionsToAddress(s: SessionState): string[] {
  const last = s.iteration - 1;
  return s.verdicts
    .filter((v) => v.iteration === last && v.verdict === "reject")
    .map((v) => {
      const name = findMember(s, v.by)?.persona.name ?? v.by;
      const streak = s.verdicts.filter((x) => x.by === v.by && x.iteration <= last).every((x) => x.verdict === "reject");
      const again = streak && last > 1 ? ` (rejected in all ${last} iterations so far)` : "";
      return `- ${name}${again}: ${v.reason.replace(/\n/g, " ")}`;
    });
}

function displayDemo(s: SessionState, d: { by: string; text: string }): string {
  const name = findMember(s, d.by)?.persona.name ?? d.by;
  return `${name}: ${d.text.replace(/\n/g, "\n  ")}`;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "venv", "__pycache__"]);

/**
 * Up to `max` workspace files (relative paths), skipping hidden and build/dependency folders.
 * For an existing codebase the full tree is not useful, so only the files changed so far are listed.
 */
export function listWorkspace(s: SessionState, root: string, max = 60): string[] {
  if (s.externalWorkspace) return (gitChanges(path.resolve(root, s.workspace)) ?? []).slice(0, max);
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return; // workspace not created yet
    }
    for (const ent of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= max) return;
      if (ent.name.startsWith(".") || SKIP_DIRS.has(ent.name)) continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
      else out.push(r);
    }
  };
  walk(path.resolve(root, s.workspace), "");
  return out;
}

export function promptAsText(p: TurnPrompt): string {
  return `${p.system}\n\n${p.user}\n`;
}

/** Paths changed in a git checkout (uncommitted and committed on top of its upstream / default branch), or null. */
export function gitChanges(dir: string): string[] | null {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    const files = new Set<string>();
    for (const line of git("status", "--porcelain", "--untracked-files=all").split("\n")) {
      const f = line.slice(3).split(" -> ").pop()?.trim();
      if (f) files.add(f);
    }
    const base = mergeBase(git);
    if (base) for (const f of git("diff", "--name-only", `${base}...HEAD`).split("\n")) if (f.trim()) files.add(f.trim());
    return [...files].sort();
  } catch {
    return null;
  }
}

function mergeBase(git: (...args: string[]) => string): string | null {
  for (const ref of ["origin/HEAD", "origin/main", "main", "@{upstream}"]) {
    try {
      const sha = git("merge-base", "HEAD", ref).trim();
      const head = git("rev-parse", "HEAD").trim();
      // A branch pushed with its own upstream has nothing "ahead"; keep looking for the real base.
      if (sha && sha !== head) return sha;
    } catch {}
  }
  return null;
}
