import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/world.ts";
import { buildPrompt } from "../src/prompt.ts";
import type { TurnPrompt } from "../src/prompt.ts";
import { DEFAULT_PHASES } from "../src/sop.ts";
import type { PersonaSpec } from "../src/types.ts";

const p = (id: string, role: string): PersonaSpec => ({ id, role, persona: { name: id.toUpperCase() } });
const make = () =>
  World.create({ name: "t", brief: "b", members: [p("pm", "pm"), p("e1", "engineer"), p("u1", "user")], phases: DEFAULT_PHASES, now: () => "T" });

const HEADINGS: Record<string, string> = {
  brief: "## Product brief",
  phase: "## Current phase",
  team: "## Team",
  backlog: "## Backlog",
  decisions: "## Decisions",
  "open-questions": "## Open questions",
  notes: "## Your long-term notes",
  workspace: "## Workspace",
  others: "## Other sessions",
  conversation: "## Conversation so far",
  turn: "## Your turn",
};
const ALWAYS = ["brief", "phase", "team", "backlog", "decisions", "workspace", "conversation", "turn"];

/** The sections must be the user prompt cut into consecutive pieces, in order, each starting with its own heading. */
const assertSections = (prompt: TurnPrompt, ids: string[]) => {
  assert.deepEqual(prompt.sections.map((x) => x.id), ids);
  let at = 0;
  for (const { id, chars } of prompt.sections) {
    const text = prompt.user.slice(at, at + chars);
    assert.ok(text.replace(/^\n+/, "").startsWith(HEADINGS[id]), `${id} starts with "${HEADINGS[id]}", got ${JSON.stringify(text.slice(0, 40))}`);
    at += chars;
  }
  assert.equal(at, prompt.user.length, "the sections' chars add up to the user prompt's length");
};

test("a prompt lists its sections in order, sized to add up to the user prompt, and leaves out the empty ones", () => {
  const w = make();
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), ALWAYS);

  w.record("pm", "[ASK_HUMAN] Which provider? Default: Stripe.\n[NOTE] remember the default");
  const withMore = [...ALWAYS.slice(0, 5), "open-questions", "notes", ...ALWAYS.slice(5)];
  assertSections(buildPrompt(w.state, "pm", w.emitted, []), withMore);
  assertSections(buildPrompt(w.state, "u1", w.emitted, []), ALWAYS);

  const others = { others: ["villa-58: src/b.ts"] };
  assertSections(buildPrompt(w.state, "e1", w.emitted, [], others), [...ALWAYS.slice(0, 5), "open-questions", "workspace", "others", "conversation", "turn"]);
  assertSections(buildPrompt(w.state, "pm", w.emitted, [], others), withMore);
});
