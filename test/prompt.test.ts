import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/world.ts";
import { buildPrompt } from "../src/prompt.ts";
import type { SectionId, TurnPrompt } from "../src/prompt.ts";
import { DEFAULT_PHASES } from "../src/sop.ts";
import type { PersonaSpec } from "../src/types.ts";

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
