import type { Entry, SessionState, Task } from "./types.ts";
import { currentPhase, findMember, isPrivate } from "./world.ts";

const indent = (text: string, pad: string) => text.replace(/\n/g, "\n" + pad);

export function displayName(s: SessionState, id: string): string {
  const m = findMember(s, id);
  return m ? `${m.persona.name} (${m.id})` : id;
}

export function formatEntry(s: SessionState, e: Entry): string {
  const who = displayName(s, e.from);
  const to = e.to && !e.to.includes("all") ? ` → ${e.to.join(", ")}` : "";
  switch (e.kind) {
    case "system":
      return `— ${e.text}`;
    case "think":
      return `${who} [thinks]: ${e.text}`;
    case "note":
      return `${who} [notes]: ${e.text}`;
    case "say":
      return `${who}${to}: ${e.text}`;
    default:
      return `${who} [${e.kind.toUpperCase()}]: ${e.text}`;
  }
}

export function formatTask(t: Task): string {
  const acc = t.acceptance ? `\n    acceptance: ${indent(t.acceptance, "    ")}` : "";
  const sum = t.summary ? `\n    result: ${indent(t.summary, "    ")}` : "";
  return `- ${t.id} [${t.status}] owner=${t.owner ?? "-"} ${t.title}${acc}${sum}`;
}

export function formatBacklog(tasks: Task[], empty: string): string {
  return tasks.length ? tasks.map(formatTask).join("\n") : empty;
}

/** Human-readable transcript, including private thoughts (like TinyTroupe's console view). */
export function renderMarkdown(s: SessionState, entries: Entry[]): string {
  const out: string[] = [
    `# ${s.name}`,
    "",
    `**Brief:** ${s.brief}`,
    "",
    `**Status:** ${s.status} · iteration ${s.iteration}/${s.maxIterations} · phase \`${currentPhase(s).id}\``,
    "",
    "## Team",
    "",
  ];
  for (const m of s.members) out.push(`- **${m.persona.name}** (\`${m.id}\`, ${m.role})`);
  out.push("", "## Backlog", "");
  out.push(formatBacklog(s.tasks, "_(none)_"));
  out.push("", "## Decisions", "");
  out.push(s.decisions.length ? s.decisions.map((d) => `- (${d.phase}, ${displayName(s, d.by)}) ${d.text}`).join("\n") : "_(none)_");
  out.push("", "## Verdicts", "");
  out.push(
    s.verdicts.length
      ? s.verdicts.map((v) => `- iteration ${v.iteration} · ${displayName(s, v.by)} · **${v.verdict}** — ${v.reason}`).join("\n")
      : "_(none)_",
  );
  out.push("", "## Transcript", "");
  let lastPhase = "";
  for (const e of entries) {
    const key = `${e.iteration}:${e.phase}`;
    if (key !== lastPhase) {
      out.push(`### iteration ${e.iteration} · ${e.phase}`, "");
      lastPhase = key;
    }
    const line = indent(formatEntry(s, e), "  ");
    out.push(isPrivate(e) ? `> _${line}_` : `- ${line}`, "");
  }
  return out.join("\n");
}
