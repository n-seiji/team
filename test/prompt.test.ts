import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/world.ts";
import { buildPrompt } from "../src/prompt.ts";
import type { SectionId, TurnPrompt } from "../src/prompt.ts";
import { DEFAULT_PHASES } from "../src/sop.ts";
import type { Entry, PersonaSpec } from "../src/types.ts";

const p = (id: string, role: string): PersonaSpec => ({ id, role, persona: { name: id.toUpperCase() } });
const make = () =>
  World.create({ name: "t", brief: "b", members: [p("pm", "pm"), p("e1", "engineer"), p("u1", "user")], phases: DEFAULT_PHASES, now: () => "T" });
const goTo = (w: World, phase: string, iteration = 1) => {
  w.state.phaseIndex = DEFAULT_PHASES.findIndex((x) => x.id === phase);
  w.state.iteration = iteration;
};

/** What each section's text starts with. Typed by SectionId so a new section without a heading fails to compile; key order is prompt order. */
const HEADINGS: Record<SectionId, string> = {
  brief: "## Product brief",
  phase: "## Current phase",
  team: "## Team",
  backlog: "## Backlog",
  decisions: "## Decisions",
  wrapup: "## Wrap-up checklist",
  "open-questions": "## Open questions",
  "answered-questions": "## Answered by the human",
  rejections: "## Rejections from the last iteration",
  trial: "## Trial run",
  demos: "## Demos shown by the team",
  notes: "## Your long-term notes",
  workspace: "## Workspace",
  others: "## Other sessions",
  conversation: "## Conversation so far",
  turn: "## Your turn",
};
const ALWAYS: SectionId[] = ["brief", "phase", "team", "backlog", "decisions", "workspace", "conversation", "turn"];

/** The sections a prompt has: the always-present ones plus `extra`, in prompt order. */
const expected = (...extra: SectionId[]) =>
  (Object.keys(HEADINGS) as SectionId[]).filter((id) => ALWAYS.includes(id) || extra.includes(id));

/** The sections must be the user prompt cut into consecutive pieces, in order, each starting with its own heading. */
const assertSections = (prompt: TurnPrompt, ids: SectionId[]) => {
  assert.deepEqual(prompt.sections.map((x) => x.id), ids);
  let at = 0;
  for (const { id, chars } of prompt.sections) {
    const text = prompt.user.slice(at, at + chars);
    assert.ok(text.replace(/^\n+/, "").startsWith(HEADINGS[id]), `${id} starts with "${HEADINGS[id]}", got ${JSON.stringify(text.slice(0, 40))}`);
    at += chars;
  }
  assert.equal(at, prompt.user.length, "the sections' chars add up to the user prompt's length");
};

test("a fresh prompt has the always-present sections, in order, sized to add up to the user prompt", () => {
  const w = make();
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), expected());
});

test("sections are separated by exactly one blank line", () => {
  const w = make();
  const { user } = buildPrompt(w.state, "pm", w.emitted, []);
  assert.doesNotMatch(user, /\n\n\n/);
  assert.ok(user.startsWith("## Product brief\n"));
  assert.match(user, /\n\n## Current phase/);
});

test("open questions and notes show up for the PM, not for a user", () => {
  const w = make();
  w.record("pm", "[ASK_HUMAN] Which provider? Default: Stripe.\n[NOTE] remember the default");
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), expected("open-questions", "notes"));
  assertSections(buildPrompt(w.state, "u1", w.emitted, []), expected());
});

test("an answered question moves from open to answered", () => {
  const w = make();
  w.record("pm", "[ASK_HUMAN] Which provider? Default: Stripe.");
  w.answer("Q1", "PayPay");
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), expected("answered-questions"));
  assertSections(buildPrompt(w.state, "u1", w.emitted, []), expected());
});

test("other sessions' changes are shown to engineers only", () => {
  const w = make();
  const others = { others: ["villa-58: src/b.ts"] };
  assertSections(buildPrompt(w.state, "e1", w.emitted, [], others), expected("others"));
  assertSections(buildPrompt(w.state, "pm", w.emitted, [], others), expected());
});

test("the wrap-up checklist appears in the finale phase only", () => {
  const w = make();
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), expected());
  goTo(w, "wrapup");
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), expected("wrapup"));
  assertSections(buildPrompt(w.state, "e1", w.emitted, []), expected("wrapup"));
});

test("rejections reach the PM at the start of the next iteration, and nobody else", () => {
  const w = make();
  w.state.verdicts.push({ by: "u1", verdict: "reject", reason: "too slow", iteration: 1 });
  goTo(w, "planning", 2);
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), expected("rejections"));
  assertSections(buildPrompt(w.state, "e1", w.emitted, []), expected());
  goTo(w, "review", 2);
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), expected());
});

test("the trial run is shown once the runtime has recorded it", () => {
  const w = make();
  goTo(w, "acceptance");
  assertSections(buildPrompt(w.state, "u1", w.emitted, []), expected());
  w.addTrial({ command: "npm run verify", exitCode: 0, output: "journey: ok", artifacts: [] });
  assertSections(buildPrompt(w.state, "u1", w.emitted, []), expected("trial"));
});

test("this iteration's demos are shown to everyone but engineers before the finale", () => {
  const w = make();
  w.state.demos = [{ by: "e1", text: "T1: open /day", phase: "review", iteration: 1 }];
  goTo(w, "acceptance");
  assertSections(buildPrompt(w.state, "u1", w.emitted, []), expected("demos"));
  assertSections(buildPrompt(w.state, "e1", w.emitted, []), expected());
  goTo(w, "wrapup");
  assertSections(buildPrompt(w.state, "e1", w.emitted, []), expected("wrapup", "demos"));
});

const rec = (w: World, id: string, text: string) => w.record(id, text, { force: true });
const sectionText = (prompt: TurnPrompt, id: SectionId) => {
  let at = 0;
  for (const s of prompt.sections) {
    if (s.id === id) return prompt.user.slice(at, at + s.chars).replace(/^\n+/, "");
    at += s.chars;
  }
  return "";
};
/** The conversation section's text after its heading. */
const windowOf = (prompt: TurnPrompt) => sectionText(prompt, "conversation").split("\n").slice(1).join("\n");

test("a task creation entry is one reference line while the Backlog keeps its acceptance criteria", () => {
  const w = make();
  rec(w, "pm", "[TASK owner=e1] Daily view\n- shows 3 rows\n[TASK] Settings");
  goTo(w, "build");
  for (const id of ["pm", "e1", "u1"]) {
    const prompt = buildPrompt(w.state, id, w.emitted, []);
    const talk = windowOf(prompt);
    const lines = talk.split("\n");
    assert.ok(lines.includes("PM (pm) added task T1: Daily view (full text in Backlog)"), `${id}: T1 is a reference`);
    assert.ok(lines.includes("PM (pm) added task T2: Settings (full text in Backlog)"), `${id}: T2 has no acceptance but is still covered`);
    assert.ok(!talk.includes("shows 3 rows"), `${id}: the acceptance criteria are not repeated in the conversation`);
    assert.match(sectionText(prompt, "backlog"), /- T1 \[todo\] owner=e1 Daily view\n {4}acceptance: - shows 3 rows/);
  }
});

test("a task update is a reference only while the Backlog still shows its text", () => {
  const w = make();
  rec(w, "pm", "[TASK owner=e1] Daily view\n- shows 3 rows\n[TASK owner=e1] Settings\n- remembers the choice\n[TASK owner=e1] Export\n- csv");
  rec(w, "e1", "[TASK_START T1]");
  rec(w, "e1", "[TASK_DONE T1] first try");
  rec(w, "e1", "[TASK_START T1]");
  rec(w, "e1", "[TASK_DONE T1] second try");
  rec(w, "e1", "[TASK_BLOCKED T2] the owner must sign in once");
  rec(w, "pm", "[CHECK T1] open it on a real phone");
  rec(w, "pm", "[TASK_DROP T3] nobody asked for it");
  goTo(w, "review");
  const prompt = buildPrompt(w.state, "pm", w.emitted, []);
  const talk = windowOf(prompt);
  const lines = talk.split("\n");
  assert.deepEqual(
    lines.filter((l) => /^(E1|PM) \(\w+\) .*\bT[123]\b/.test(l) && !l.includes("added task")),
    [
      "E1 (e1) (task update) T1 → doing",
      "E1 (e1) (task update) T1 → done: first try",
      "E1 (e1) (task update) T1 → doing",
      "E1 (e1) finished T1 (result in Backlog)",
      "E1 (e1) handed T2 over to a person (hand-off in Backlog)",
      "PM (pm) added a check to T1 (in Backlog)",
      "PM (pm) dropped T3 (reason in Backlog)",
    ],
  );
  for (const text of ["second try", "the owner must sign in once", "open it on a real phone", "nobody asked for it"]) {
    assert.ok(!talk.includes(text), `"${text}" is in the Backlog, not repeated in the conversation`);
    assert.ok(sectionText(prompt, "backlog").includes(text), `"${text}" is in the Backlog`);
  }
});

test("a decision is numbered in the Decisions section and referenced by its number in the conversation", () => {
  const w = make();
  rec(w, "pm", "[DECISION] use SQLite");
  rec(w, "pm", "[DECISION] one screen only");
  rec(w, "pm", "[DECISION] use SQLite");
  goTo(w, "build");
  for (const id of ["pm", "e1", "u1"]) {
    const prompt = buildPrompt(w.state, id, w.emitted, []);
    assert.equal(sectionText(prompt, "decisions"), "## Decisions\n- D1: use SQLite\n- D2: one screen only\n- D3: use SQLite");
    const refs = windowOf(prompt).split("\n").filter((l) => l.includes("decision"));
    assert.deepEqual(refs, [
      "PM (pm) made decision D1 (in Decisions)",
      "PM (pm) made decision D2 (in Decisions)",
      "PM (pm) made decision D3 (in Decisions)",
    ]);
  }
});

test("a demo is a reference where the Demos section is shown, and stays in full where it is not", () => {
  const w = make();
  rec(w, "e1", "[DEMO T1] open /day and see 3 rows");
  rec(w, "e1", "[DEMO] the CLI prints ok");
  const full = ["E1 (e1) (demo): T1: open /day and see 3 rows", "E1 (e1) (demo): the CLI prints ok"];
  const refs = ["E1 (e1) showed a demo for T1 (in Demos)", "E1 (e1) showed a demo (in Demos)"];
  const demoLines = (id: string) => windowOf(buildPrompt(w.state, id, w.emitted, [])).split("\n").filter((l) => l.includes("demo"));

  goTo(w, "acceptance");
  assert.deepEqual(demoLines("u1"), refs);
  assert.deepEqual(demoLines("pm"), refs);
  assert.deepEqual(demoLines("e1"), full, "an engineer outside the finale has no Demos section");
  assert.match(sectionText(buildPrompt(w.state, "u1", w.emitted, []), "demos"), /- E1: T1: open \/day and see 3 rows/);

  goTo(w, "wrapup");
  assert.deepEqual(demoLines("e1"), refs, "in the finale engineers see the Demos section too");

  goTo(w, "acceptance", 2);
  assert.deepEqual(demoLines("u1"), full, "demos of an earlier iteration are not listed, so they are not references");
});

test("verdicts, remarks, questions and the human's answers keep their full text", () => {
  const w = make();
  rec(w, "u1", "[SAY to=pm] it feels slow on my phone\n[VERDICT reject] too slow to open");
  rec(w, "pm", "[ASK_HUMAN] Which provider? Default: Stripe.\n[SAY] noted");
  w.answer("Q1", "PayPay");
  rec(w, "e1", "[VERIFY] node verify.js");
  rec(w, "pm", "[ADVANCE] enough");
  const lines = windowOf(buildPrompt(w.state, "pm", w.emitted, [])).split("\n");
  for (const line of [
    "U1 (u1) → pm: it feels slow on my phone",
    "U1 (u1) (verdict REJECT): too slow to open",
    "PM (pm) (ask the human): Which provider? Default: Stripe.",
    "PM (pm): noted",
    "human: Answer to Q1 (Which provider? Default: Stripe.): PayPay",
    "E1 (e1) (verify): node verify.js",
    "PM (pm) (end phase): enough",
  ])
    assert.ok(lines.includes(line), `has the line ${JSON.stringify(line)}`);
});

test("private memos and notes stay in full and say they are the member's own", () => {
  const w = make();
  rec(w, "pm", "[THINK] ask about the weekend\n[NOTE] users are on phones\n[SAY to=all] hello");
  const lines = windowOf(buildPrompt(w.state, "pm", w.emitted, [])).split("\n");
  assert.ok(lines.includes("PM (pm) (your memo): ask about the weekend"));
  assert.ok(lines.includes("PM (pm) (your note): users are on phones"));
  assert.doesNotMatch(windowOf(buildPrompt(w.state, "u1", w.emitted, [])), /memo|users are on phones/);
});

test("no line the conversation adds looks like a reply tag, while the protocol help still lists the tags", () => {
  const w = make();
  rec(w, "pm", "[THINK] plan\n[NOTE] n\n[SAY to=e1] hi\n[TASK owner=e1] A\n- a\n[DECISION] d\n[ASK_HUMAN] q?");
  rec(w, "e1", "[TASK_START T1]\n[TASK_DONE T1] done it\n[DEMO T1] ran it\n[VERIFY] npm test\n[SAY] done");
  rec(w, "pm", "[CHECK T1] on a phone\n[ADVANCE] go");
  rec(w, "u1", "[VERDICT accept] fine");
  goTo(w, "acceptance");
  for (const id of ["pm", "e1", "u1"]) {
    const prompt = buildPrompt(w.state, id, w.emitted, []);
    const tagged = windowOf(prompt).split("\n").filter((l) => !l.startsWith("— ") && /^\S.*\[[A-Z_]+\]/.test(l));
    assert.deepEqual(tagged, [], `${id}: no bracketed tag in the window`);
    assert.match(sectionText(prompt, "turn"), /\[SAY to=all\][\s\S]*\[DONE\]/);
  }
  assert.match(sectionText(buildPrompt(w.state, "e1", w.emitted, []), "turn"), /\[TASK_DONE T1\]/);
});

test("the transcript, the log and the HTML view keep the full tagged text", async () => {
  const { formatEntry, renderMarkdown } = await import("../src/render.ts");
  const { renderHtml } = await import("../src/html.ts");
  const w = make();
  rec(w, "pm", "[TASK owner=e1] Daily view\n- shows 3 rows\n[DECISION] use SQLite");
  rec(w, "e1", "[TASK_DONE T1] built it\n[DEMO T1] ran it");
  const md = renderMarkdown(w.state, w.emitted);
  for (const text of [
    "PM (pm) [TASK]: T1 owner=e1: Daily view",
    "  - shows 3 rows",
    "PM (pm) [DECISION]: use SQLite",
    "E1 (e1) (task update) T1 → done: built it",
    "E1 (e1) [DEMO]: T1: ran it",
  ])
    assert.ok(md.includes(text), `transcript.md has ${JSON.stringify(text)}`);
  assert.equal(formatEntry(w.state, w.emitted.find((e) => e.kind === "decision")!), "PM (pm) [DECISION]: use SQLite");
  assert.ok(renderHtml(w.state, w.emitted).includes("use SQLite"));
  const talk = windowOf(buildPrompt(w.state, "pm", w.emitted, []));
  assert.ok(!talk.includes("[DECISION]") && !talk.includes("[DEMO]") && !talk.includes("[TASK]"));
});

test("an entry the sections do not hold stays in full, without a tag", () => {
  const w = make();
  const entry = (kind: Entry["kind"] | "task_done", text: string): Entry =>
    ({ turn: 1, at: "T", phase: "discovery", iteration: 1, from: "pm", kind, text }) as Entry;
  const entries = [
    entry("task", "T9 owner=e1: Ghost\n- not in the backlog"),
    entry("task_update", "T9 → done: no such task"),
    entry("task_update", "T9 check by a person: no such task"),
    entry("decision", "never recorded"),
    entry("demo", "T1: never recorded"),
    entry("task_done", "T9 → done: legacy kind"),
    entry("verdict", "who knows"),
  ];
  const lines = windowOf(buildPrompt(w.state, "pm", entries, [])).split("\n");
  assert.deepEqual(lines, [
    "PM (pm) (task): T9 owner=e1: Ghost",
    "- not in the backlog",
    "PM (pm) (task update) T9 → done: no such task",
    "PM (pm) (task update) T9 check by a person: no such task",
    "PM (pm) (decision): never recorded",
    "PM (pm) (demo): T1: never recorded",
    "PM (pm) (task update) T9 → done: legacy kind",
    "PM (pm) (verdict): who knows",
  ]);
});

test("the history window still counts entries, so references take the place of the entries they shorten", () => {
  const w = make();
  rec(w, "pm", "[TASK owner=e1] A\n- long\n- acceptance\n[DECISION] d1\n[DECISION] d2\n[SAY] last");
  w.state.historyWindow = 3;
  const prompt = buildPrompt(w.state, "pm", w.emitted, []);
  assert.deepEqual(sectionText(prompt, "conversation").split("\n"), [
    "## Conversation so far (latest 3; older entries omitted)",
    "PM (pm) made decision D1 (in Decisions)",
    "PM (pm) made decision D2 (in Decisions)",
    "PM (pm): last",
  ]);
});
