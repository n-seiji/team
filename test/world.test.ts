import { test } from "node:test";
import assert from "node:assert/strict";
import { World, visibleTo } from "../src/world.ts";
import { DEFAULT_PHASES } from "../src/sop.ts";
import type { PersonaSpec } from "../src/types.ts";

const p = (id: string, role: string): PersonaSpec => ({ id, role, persona: { name: id.toUpperCase() } });
const team = () => [p("pm", "pm"), p("e1", "engineer"), p("e2", "engineer"), p("u1", "user"), p("u2", "user")];
const make = (maxIterations = 2) =>
  World.create({ name: "t", brief: "b", members: team(), phases: DEFAULT_PHASES, maxIterations, now: () => "T" });

test("discovery starts with the PM, then users in order", () => {
  const w = make();
  assert.deepEqual(w.next(), ["pm"]);
  w.record("pm", "[SAY to=all] hi");
  assert.deepEqual(w.next(), ["u1"]);
  w.record("u1", "hello");
  assert.deepEqual(w.next(), ["u2"]);
});

test("addressed members reply next; repeat speakers go to the end of the round", () => {
  const w = make();
  w.record("pm", "[SAY to=u2] question for u2");
  assert.deepEqual(w.next(), ["u2"]);
  w.record("u2", "[SAY to=pm] answer");
  assert.deepEqual(w.next(), ["u1"], "u1 is not starved by the pm<->u2 exchange");
  w.record("u1", "me too");
  assert.deepEqual(w.next(), ["pm"]);
});

test("rejects out-of-turn replies unless forced", () => {
  const w = make();
  assert.throws(() => w.record("u1", "hi"), /not u1's turn/);
  w.record("u1", "[SAY to=all] interjection", { force: true });
  assert.deepEqual(w.next(), ["pm"]);
});

test("role permissions: users cannot create tasks", () => {
  const w = make();
  w.record("pm", "[SAY to=all] hi");
  w.record("u1", "[TASK owner=e1] sneaky");
  assert.equal(w.state.tasks.length, 0);
  assert.ok(w.emitted.some((e) => e.kind === "system" && /Ignored \[TASK\]/.test(e.text)));
});

test("private thoughts are only visible to their author", () => {
  const w = make();
  w.record("pm", "[THINK] secret\n[SAY to=all] public");
  const think = w.emitted.find((e) => e.kind === "think")!;
  const say = w.emitted.find((e) => e.kind === "say")!;
  assert.ok(visibleTo(think, "pm"));
  assert.ok(!visibleTo(think, "u1"));
  assert.ok(visibleTo(say, "u1"));
});

function toBuild(w: World) {
  w.record("pm", "[ADVANCE] enough");
  assert.equal(w.phase.id, "planning");
  w.record("pm", "[TASK owner=e1] A\n- a works\n[TASK owner=e2] B\n- b works\n[ADVANCE]");
  assert.equal(w.phase.id, "build");
}

test("build runs engineers in parallel and ends when all tasks are done", () => {
  const w = make();
  toBuild(w);
  assert.deepEqual(w.next(), ["e1", "e2"]);
  w.record("e1", "[TASK_DONE T1] did A");
  assert.deepEqual(w.next(), ["e2"]);
  w.record("e2", "[TASK_DONE T2] did B");
  assert.equal(w.phase.id, "review");
  assert.ok(w.state.tasks.every((t) => t.status === "done"));
});

function toAcceptance(w: World) {
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] ok");
  w.record("e2", "[TASK_DONE T2] ok");
  w.record("e1", "lgtm");
  w.record("e2", "lgtm");
  w.record("pm", "ready");
  assert.equal(w.phase.id, "acceptance");
}

test("a rejection loops back to planning for another iteration", () => {
  const w = make(2);
  toAcceptance(w);
  w.record("u1", "[VERDICT accept] good");
  w.record("u2", "[VERDICT reject] too slow");
  w.record("pm", "[DECISION] fix speed");
  assert.equal(w.state.status, "running");
  assert.equal(w.state.iteration, 2);
  assert.equal(w.phase.id, "planning");
});

test("all accepted (or iteration budget used) finishes the session", () => {
  const w = make(1);
  toAcceptance(w);
  w.record("u1", "[VERDICT accept] good");
  w.record("u2", "[VERDICT reject] meh");
  w.record("pm", "ok");
  assert.equal(w.state.status, "done");
  assert.deepEqual(w.next(), []);
});

test("rejects duplicate member ids", () => {
  assert.throws(
    () => World.create({ name: "x", brief: "b", members: [p("a", "pm"), p("a", "user")], phases: DEFAULT_PHASES }),
    /duplicate/,
  );
});
