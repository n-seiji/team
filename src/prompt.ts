// Builds the turn prompt for one agent: persona spec + role + shared state +
// its own memory (episodic: visible transcript window, semantic: notes).
import * as fs from "node:fs";
import * as path from "node:path";
import type { Entry, SessionState } from "./types.ts";
import { ACTION_HELP, PROTOCOL_HELP } from "./protocol.ts";
import { allowedActions, roleGuide } from "./sop.ts";
import { formatEntry, formatTask } from "./render.ts";
import { visibleTo } from "./world.ts";

export interface TurnPrompt {
  member: string;
  role: string;
  system: string;
  user: string;
}

export function buildPrompt(s: SessionState, memberId: string, entries: Entry[], root = "."): TurnPrompt {
  const m = s.members.find((x) => x.id === memberId);
  if (!m) throw new Error(`unknown member: ${memberId}`);
  const phase = s.phases[s.phaseIndex];

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

  const visible = entries.filter((e) => visibleTo(e, m.id));
  const window = visible.slice(-s.historyWindow);
  const older = visible.length - window.length;
  const notes = s.notes[m.id] ?? [];
  const actions = allowedActions(m.role).filter((a) => ACTION_HELP[a]);

  const roster = s.members.map((x) => `- ${x.id}: ${x.persona.name} (${x.role})${x.id === m.id ? "  ← you" : ""}`);
  const tasks = s.tasks.length ? s.tasks.map(formatTask) : ["(no tasks yet)"];
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
    ...tasks,
    "",
    "## Decisions",
    ...decisions,
    ...(notes.length ? ["", "## Your long-term notes", ...notes.map((n) => `- ${n}`)] : []),
    ...(m.role !== "pm" || phase.id === "review" || phase.id === "acceptance" ? workspaceSection(s, m.role, root) : []),
    "",
    `## Conversation so far${older > 0 ? ` (latest ${window.length}; ${older} older entries omitted)` : ""}`,
    ...(window.length ? window.map((e) => formatEntry(s, e)) : ["(nothing yet)"]),
    "",
    "## Your turn",
    `It is now your turn, ${m.persona.name}. Act according to the phase goal and your persona.`,
    PROTOCOL_HELP,
    ...actions.map((a) => "  " + ACTION_HELP[a]),
  ].join("\n");

  return { member: m.id, role: m.role, system, user };
}

function workspaceSection(s: SessionState, role: string, root: string): string[] {
  const dir = path.resolve(root, s.workspace);
  const files = listFiles(dir, 60);
  const lines = ["", `## Workspace (${s.workspace}/)`];
  if (role === "engineer") {
    lines.push(
      `All product code lives under "${s.workspace}/" (relative to the repository root). ` +
        "If you have file tools, read and edit files there for real; keep the product runnable and document how to run it in its README.md.",
    );
  } else if (role === "user") {
    lines.push("This is what the team has built so far. If you can read files, look at README.md and try it as a user would.");
  }
  lines.push(...(files.length ? files.map((f) => `- ${f}`) : ["(empty)"]));
  return lines;
}

function listFiles(dir: string, max: number): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    if (out.length >= max || !fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= max) return;
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out;
}

export function promptAsText(p: TurnPrompt): string {
  return `${p.system}\n\n${p.user}\n`;
}
