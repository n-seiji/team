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

test("a late decision sends the session through wrap-up before it finishes", () => {
  const w = make(1);
  toAcceptance(w);
  w.record("u1", "[VERDICT accept] good");
  w.record("u2", "[VERDICT accept] good");
  w.record("pm", "[DECISION] edge days stay at 100%");
  assert.equal(w.state.status, "running");
  assert.equal(w.phase.id, "wrapup");
  assert.deepEqual(w.next(), ["e1"]);
  w.record("e1", "applied");
  w.record("e2", "nothing for me");
  w.record("pm", "shipped");
  assert.equal(w.state.status, "done");
  assert.equal(w.phase.id, "wrapup");
});

test("wrap-up is skipped when nothing is left, and runs for open tasks", () => {
  const clean = make(1);
  toAcceptance(clean);
  clean.record("u1", "[VERDICT accept] ok");
  clean.record("u2", "[VERDICT accept] ok");
  clean.record("pm", "thanks");
  assert.equal(clean.state.status, "done");
  assert.equal(clean.phase.id, "acceptance");

  const w = make(1);
  toAcceptance(w);
  w.record("pm", "[TASK owner=e1] follow-up\n- docs updated", { force: true });
  w.record("u1", "[VERDICT accept] ok");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "thanks");
  assert.equal(w.phase.id, "wrapup");
  w.record("e1", "could not finish");
  w.record("e2", "-");
  w.record("pm", "left for the human");
  assert.equal(w.state.status, "done");
  assert.ok(w.emitted.some((e) => e.kind === "system" && /Still open: T3 \(follow-up\)/.test(e.text)));
});

test("a rejection with iterations left loops instead of wrapping up", () => {
  const w = make(2);
  toAcceptance(w);
  w.record("pm", "[TASK owner=e1] extra", { force: true });
  w.record("u1", "[VERDICT reject] no");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "[DECISION] retry");
  assert.equal(w.phase.id, "planning");
  assert.equal(w.state.iteration, 2);
});

test("demos are recorded for engineers only", () => {
  const w = make();
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] did A\n[DEMO T1] run `a` → prints OK");
  w.record("e2", "[TASK_DONE T2] did B");
  w.record("e1", "[SAY to=all] lgtm");
  w.record("e2", "lgtm");
  w.record("pm", "[DEMO] fake");
  assert.deepEqual(
    w.state.demos!.map((d) => [d.by, d.text]),
    [["e1", "T1: run `a` → prints OK"]],
  );
});

test("follow-up tasks from acceptance start another iteration while iterations remain", () => {
  const w = make(2);
  toAcceptance(w);
  w.record("u1", "[VERDICT accept] ok if the wording changes");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "[TASK owner=e1] change the wording\n- says 記録なし");
  assert.equal(w.state.status, "running");
  assert.equal(w.state.iteration, 2);
  assert.equal(w.phase.id, "planning");
  assert.ok(w.emitted.some((e) => /follow-up tasks were added after the build \(T3\)/.test(e.text)));
});

test("in the last iteration, follow-ups are handed over in wrap-up, not built", async () => {
  const { wrapupItems } = await import("../src/world.ts");
  const w = make(1);
  toAcceptance(w);
  w.record("u1", "[VERDICT accept] ok");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "[TASK owner=e1] later\n- x");
  assert.equal(w.phase.id, "wrapup");
  const items = wrapupItems(w.state);
  assert.deepEqual(items.followUps.map((t) => t.id), ["T3"]);
  assert.deepEqual(items.tasks, []);
});

test("dropped, replaced and blocked tasks no longer hold the build open", () => {
  const w = make();
  w.record("pm", "[ADVANCE] enough");
  w.record(
    "pm",
    "[TASK owner=e1] A\n- a\n[TASK owner=e2] B\n- b\n[TASK owner=e1] C\n- c\n" +
      "[TASK owner=e2 replaces=T2] B, smaller\n- b'\n[TASK_DROP T3] out of scope\n[ADVANCE]",
  );
  assert.equal(w.phase.id, "build");
  assert.deepEqual(
    w.state.tasks.map((t) => [t.id, t.status]),
    [["T1", "todo"], ["T2", "dropped"], ["T3", "dropped"], ["T4", "todo"]],
  );
  assert.equal(w.state.tasks[1].summary, "replaced by T4");
  w.record("e1", "[TASK_DONE T1] did A");
  w.record("e2", "[TASK_BLOCKED T4] needs a real phone to scan the QR");
  assert.equal(w.phase.id, "review", "build ends: nothing left the team itself can do");
  assert.equal(w.state.tasks[3].status, "blocked");
});

test("users cannot drop tasks; questions for the human are kept and reported at the end", () => {
  const w = make(1);
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] ok\n[ASK_HUMAN] May we publish to GitHub Pages? Meanwhile we demo from a local server.");
  w.record("e2", "[TASK_BLOCKED T2] only the owner can create the API key");
  w.record("e1", "lgtm");
  w.record("e2", "lgtm");
  w.record("pm", "ready");
  w.record("u1", "[TASK_DROP T1] I don't need it\n[VERDICT accept] ok");
  assert.equal(w.state.tasks[0].status, "done");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "thanks");
  assert.equal(w.state.status, "done");
  assert.equal(w.state.questions?.length, 1);
  assert.match(w.state.questions![0].text, /GitHub Pages/);
  const end = w.emitted.at(-1)!.text;
  assert.match(end, /Waiting on a person: T2 \(B\)\./);
  assert.match(end, /1 question\(s\) for the human/);
  assert.doesNotMatch(end, /Still open/);
});

test("the PM plans the next iteration with last rejections, flagging users who keep rejecting", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = make(3);
  toAcceptance(w);
  w.record("u1", "[VERDICT reject] I can't open a terminal");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "[DECISION] retry");
  assert.equal(w.phase.id, "planning");
  let pm = buildPrompt(w.state, "pm", w.emitted, []).user;
  assert.match(pm, /## Rejections from the last iteration\n- U1: I can't open a terminal/);
  assert.doesNotMatch(pm, /rejected in all/);
  assert.doesNotMatch(buildPrompt(w.state, "e1", w.emitted, []).user, /Rejections from the last iteration/);

  w.record("pm", "[TASK owner=e1] C\n- c\n[ADVANCE]");
  w.record("e1", "[TASK_DONE T3] ok");
  w.record("e2", "-");
  w.record("e1", "-");
  w.record("e2", "-");
  w.record("pm", "-");
  w.record("u1", "[VERDICT reject] still a terminal");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "-");
  assert.equal(w.state.iteration, 3);
  pm = buildPrompt(w.state, "pm", w.emitted, []).user;
  assert.match(pm, /- U1 \(rejected in all 2 iterations so far\): still a terminal/);
});
