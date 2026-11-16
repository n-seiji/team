// The default `team status`: where the session stands and what a person has to do, in a screenful. The full text of
// every task is `status --full`. This module only formats; what is shown is chosen by the caller (cli.ts).
import type { SessionState, Task, Verdict } from "./types.ts";
import { latestVerdicts, questionId } from "./world.ts";
import { displayName, formatNextSteps, formatQuestions, formatStatusHead, openQuestionIds } from "./render.ts";
import { shorten, stripControls } from "./text.ts";

// Columns, not characters: the long texts are Japanese as often as not.
const BRIEF_WIDTH = 100;
const TITLE_WIDTH = 70;
// A reject's reason is what the team has to act on, so it keeps more than an accept's.
const ACCEPT_WIDTH = 80;
const REJECT_WIDTH = 160;
const QUESTION_WIDTH = 60;
const ANSWER_WIDTH = 80;

type SummaryContext = Readonly<{
  /** What the human answered, by question id. */
  answers: ReadonlyMap<string, string>;
  /** Members who speak next; shown only while the session is running. */
  next: readonly string[];
  /** The overlaps with other sessions, already formatted. */
  overlaps: readonly string[];
  /** What the commands we suggest need to reach this session; see `formatNextSteps`. */
  via: string;
}>;

/** What is printed is passed through `stripControls` once more as a whole: a hand-off, a question and a title are written by the team or typed by the human, and a terminal acts on what is in them. */
export function formatStatusSummary(s: SessionState, ctx: SummaryContext): string {
  const text = [
    ...formatStatusHead(s, false),
    `brief: ${shorten(s.brief, BRIEF_WIDTH)}`,
    "backlog:",
    ...backlogLines(s.tasks),
    ...personLines(s.tasks),
    ...verdictLines(s),
    ...questionLines(s, ctx.answers),
    ...(ctx.overlaps.length ? ["overlaps with other sessions:", ...ctx.overlaps.map((o) => "  " + o)] : []),
    ...(s.status === "running" ? [`next speaker: ${ctx.next.map((id) => displayName(s, id)).join(", ") || "-"}`] : []),
    formatNextSteps(s, openQuestionIds(s, ctx.answers), ctx.via),
  ].join("\n");
  return stripControls(text);
}

const taskLine = (t: Task) => `- ${t.id} [${t.status}] owner=${t.owner ?? "-"} ${shorten(t.title, TITLE_WIDTH)}`;

function backlogLines(tasks: readonly Task[]): readonly string[] {
  return tasks.length ? tasks.map(taskLine) : ["  (none)"];
}

const indented = (text: string) => text.split("\n").map((l) => `    ${l}`.trimEnd());

/**
 * What only a real person can do, which is why it is never cut short: a blocked task's hand-off, and the checks on
 * built tasks. A blocked task from before hand-offs had a field of its own kept the text in `summary`.
 */
function personLines(tasks: readonly Task[]): readonly string[] {
  const items = tasks.flatMap((t) => {
    const notes =
      t.status === "blocked"
        ? [(t.handoff ?? t.summary ?? "").trim() || "(no details given)"]
        : t.status === "done"
          ? (t.checks ?? []).map((c) => `check: ${c}`)
          : [];
    return notes.length ? [`- ${t.id} [${t.status}] ${shorten(t.title, TITLE_WIDTH)}`, ...notes.flatMap(indented)] : [];
  });
  return items.length ? ["needs a person:", ...items] : [];
}

/**
 * The verdicts of the session's own iteration once it is done, so an earlier iteration's accepts are never read as the
 * result of the last one (`sessions` says the same); while it runs, the latest ones given, whichever iteration they came
 * in: a continued or looped session has none of its own yet.
 */
function verdictLines(s: SessionState): readonly string[] {
  const lastGiven = Math.max(0, ...s.verdicts.map((v) => v.iteration));
  const iteration = s.status === "done" ? s.iteration : lastGiven;
  const verdicts = latestVerdicts(s, iteration);
  if (!verdicts.length) return s.status === "done" ? [`no verdicts in iteration ${iteration}${lastGiven ? ` (last given in iteration ${lastGiven})` : ""}`] : [];
  const reason = (v: Verdict) => (v.reason.trim() ? ` — ${shorten(v.reason, v.verdict === "reject" ? REJECT_WIDTH : ACCEPT_WIDTH)}` : "");
  return [`verdicts (iteration ${iteration}):`, ...verdicts.map((v) => `- ${displayName(s, v.by)}: ${v.verdict}${reason(v)}`)];
}

/** Open questions in full (the default the team goes on is part of the text, and the human answers from here); answered ones in a line. */
function questionLines(s: SessionState, answers: ReadonlyMap<string, string>): readonly string[] {
  const open = formatQuestions(s, answers, "open");
  const answered = (s.questions ?? []).flatMap((q, i) => {
    const answer = answers.get(questionId(i));
    return answer === undefined
      ? []
      : [`- ${questionId(i)} (${q.phase}, ${displayName(s, q.by)}) ${shorten(q.text, QUESTION_WIDTH)}`, `  answer: ${shorten(answer, ANSWER_WIDTH)}`];
  });
  return [
    ...(open ? ["open questions for the human (the team proceeds on the stated defaults; answer with: team answer <Qn> <text>):", open] : []),
    ...(answered.length ? ["answered questions:", ...answered] : []),
  ];
}
