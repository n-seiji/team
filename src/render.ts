import type { Entry, PersonaSpec, PhaseDef, SessionState, Task } from "./types.ts";
import { answersByQuestion, currentPhase, decisionId, findMember, isPrivate, questionId } from "./world.ts";

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
      return `${who} [memo]: ${e.text}`;
    case "note":
      return `${who} [notes]: ${e.text}`;
    case "say":
      return `${who}${to}: ${e.text}`;
    case "task_update":
      // Not "[TASK_UPDATE]": agents copy what they see, and that is not an action tag.
      return `${who} (task update) ${e.text}`;
    default:
      return `${who} [${e.kind.toUpperCase()}]: ${e.text}`;
  }
}

/** The first line `run` prints: what it will talk to. "default" is the choice the backend makes itself. */
export function formatBackendLine(type: string, model: string | undefined): string {
  return `backend=${type} model=${model ?? "default"}`;
}

/** What `run` stops with once turns have been skipped this many times in a row: the setup is more likely broken than one call unlucky. */
export function formatSkipStop(skippedInARow: number, lastFailure: string): string {
  return [
    `stopped: the last ${skippedInARow} turns in a row were skipped because they failed (last failure: ${lastFailure}).`,
    "The step that reached the limit was not recorded and the session is still running.",
    "Fix the cause and run `team run` to continue from here.",
  ].join("\n");
}

/** What `record` writes down for a member who could not answer, and what `run` writes for a turn it skips. */
export const SKIPPED_TURN_REPLY = "[SAY to=all] (could not attend this turn)";

/** What `record` says when it is given nothing: an empty reply would use up a member's turn without anyone having spoken. */
export function formatEmptyReply(member: string): string {
  return [
    `the reply for ${member} is empty, so nothing was recorded.`,
    "Pass the member's reply on stdin or with --file.",
    `If the member could not answer (an error or empty output, even after one retry), record this instead: ${SKIPPED_TURN_REPLY}`,
  ].join("\n");
}

/** One warning per role that phases list as a speaker but that no member has: that role never gets a turn. */
export function formatUnstaffedRoles(phases: readonly PhaseDef[], members: readonly PersonaSpec[]): readonly string[] {
  const staffed = new Set(members.map((m) => m.role));
  // a config is not validated, and a phase that has no speakers is not this warning's business
  const speakers = (p: PhaseDef) => p.speakers ?? [];
  const missing = [...new Set(phases.flatMap(speakers))].filter((role) => !staffed.has(role));
  return missing.map((role) => {
    const where = phases.filter((p) => speakers(p).includes(role)).map((p) => p.id);
    return `warning: no member has the role "${role}", yet it is a speaker in: ${where.join(", ")}. It never speaks there.`;
  });
}

/** `init --force` keeps what the earlier session built, and the new team is shown it like any file in its workspace. */
export function formatLeftoverWorkspace(workspace: string): string {
  return `warning: ${workspace} already has files from before. They were not deleted, so the new team will see them; delete the folder yourself if you want a clean start.`;
}

/** `continue` does not copy files: a workspace that is gone or empty means the team starts the new iteration without what it built before. */
export function formatEmptyWorkspace(workspace: string): string {
  return `warning: ${workspace} does not exist or is empty, so the team will not see what the earlier iterations built, and the trial run before acceptance fails too unless the team rebuilds it. The files are not part of the session (.team/); restore them if you want the team to build on them.`;
}

/**
 * What `continue` prints: which iteration the session restarted as, and who speaks first. `via` is what the commands to
 * run next need to reach this session (see `sessionFlag` in cli.ts): empty when it is the current one.
 */
export function formatContinued(s: SessionState, next: readonly string[], via: string): string {
  return [
    `continued session "${s.name}": iteration ${s.iteration}/${s.maxIterations} begins at phase "${currentPhase(s).id}".`,
    `next: ${next.map((id) => displayName(s, id)).join(", ") || "-"}`,
    `Go on with: team next${via} (host mode) or team run${via} (auto mode).`,
  ].join("\n");
}

/** `first`, the line saying a session is done, plus the way to give it another iteration. For text output only: JSON stays as it is. */
export function withContinueHint(first: string, via: string): string {
  return `${first}\nTo go on with another iteration: team continue${via} [--iterations N] ["<text>"]`;
}

/** What `answer` adds on a finished session: the answer is recorded, but only a continued session reads it. */
export function formatAnswerAfterDone(via: string): string {
  return `The session is done, so the team acts on this answer only after you run: team continue${via}`;
}

export function formatTask(t: Task): string {
  const acc = t.acceptance ? `\n    acceptance: ${indent(t.acceptance, "    ")}` : "";
  // Sessions saved before `handoff` existed kept a blocked task's hand-off in its summary.
  const oldHandoff = t.status === "blocked" && t.handoff === undefined;
  const label = oldHandoff ? "needs a person" : t.status === "dropped" ? "dropped" : "result";
  const sum = t.summary ? `\n    ${label}: ${indent(t.summary, "    ")}` : "";
  const handoff = t.status === "blocked" && t.handoff ? `\n    needs a person: ${indent(t.handoff, "    ")}` : "";
  const checks = (t.checks ?? []).map((c) => `\n    check by a person: ${indent(c, "    ")}`).join("");
  return `- ${t.id} [${t.status}] owner=${t.owner ?? "-"} ${t.title}${acc}${sum}${handoff}${checks}`;
}

export function formatBacklog(tasks: Task[], empty: string): string {
  return tasks.length ? tasks.map(formatTask).join("\n") : empty;
}

/** The questions for the human with their ids (Q1, Q2, ...) and answers, all or only the open / answered ones. */
export function formatQuestions(s: SessionState, answers: ReadonlyMap<string, string>, which: "all" | "open" | "answered" = "all"): string {
  return (s.questions ?? [])
    .map((q, i) => ({ q, id: questionId(i), answer: answers.get(questionId(i)) }))
    .filter(({ answer }) => which === "all" || (answer !== undefined) === (which === "answered"))
    .map(
      ({ q, id, answer }) =>
        `- ${id} (${q.phase}, ${displayName(s, q.by)}) ${indent(q.text, "  ")}` +
        (answer === undefined ? "" : `\n  answer: ${indent(answer, "    ")}`),
    )
    .join("\n");
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
  out.push(s.decisions.length ? s.decisions.map((d, i) => `- ${decisionId(i)} (${d.phase}, ${displayName(s, d.by)}) ${d.text}`).join("\n") : "_(none)_");
  const questions = s.questions ?? [];
  if (questions.length) {
    out.push("", "## Questions for the human", "");
    out.push(formatQuestions(s, answersByQuestion(entries)));
  }
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
