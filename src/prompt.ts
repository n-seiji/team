// Builds the turn prompt for one agent: persona spec + role + shared state +
// its own memory (episodic: visible transcript window, semantic: notes).
import * as fs from "node:fs";
import * as path from "node:path";
import type { Entry, SessionState } from "./types.ts";
import { ACTION_HELP, PROTOCOL_HELP } from "./protocol.ts";
import { allowedActions, canEdit, roleGuide, workspaceGuide } from "./sop.ts";
import { formatBacklog, formatEntry } from "./render.ts";
import { currentPhase, findMember, visibleTo } from "./world.ts";

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
 */
export function buildPrompt(s: SessionState, memberId: string, entries: Entry[], files: string[]): TurnPrompt {
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
    `Always write the content of your messages in the language "${s.language}". Be concise: say what matters, like in a real meeting.`,
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
    ...(notes.length ? ["", "## Your long-term notes", ...notes.map((n) => `- ${n}`)] : []),
    "",
    `## Workspace (${s.workspace}/)`,
    workspaceGuide(m.role),
    edit ? "You may edit files in the workspace during this phase." : "Do not edit files during this phase.",
    ...(files.length ? files.map((f) => `- ${f}`) : ["(empty)"]),
    "",
    `## Conversation so far${older ? ` (latest ${window.length}; older entries omitted)` : ""}`,
    ...(window.length ? window.map((e) => formatEntry(s, e)) : ["(nothing yet)"]),
    "",
    "## Your turn",
    `It is now your turn, ${m.persona.name}. Act according to the phase goal and your persona.`,
    PROTOCOL_HELP,
    ...actions.map((a) => "  " + ACTION_HELP[a]),
  ].join("\n");

  return { member: m.id, role: m.role, canEdit: edit, system, user };
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "venv", "__pycache__"]);

/** Up to `max` workspace files (relative paths), skipping hidden and build/dependency folders. */
export function listWorkspace(s: SessionState, root: string, max = 60): string[] {
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
