import { test } from "node:test";
import assert from "node:assert/strict";
import { formatNextSteps, formatStatusHead, openQuestionIds } from "../src/render.ts";
import { newState } from "./session-state.ts";

const lines = (text: string) => text.split("\n");

test("a running session points to Claude Code (host mode) and to team run (auto mode), in one line", () => {
  const out = formatNextSteps(newState(), [], "");
  assert.deepEqual(lines(out).length, 1);
  assert.match(out, /^Next: team run \(auto mode\), or in Claude Code: "continue the s1 session" \(host mode, \/team-dev\)$/);
});

test("a finished session points to continue with a request, and to the log to read", () => {
  const out = formatNextSteps(newState({ status: "done" }), [], "");
  assert.equal(lines(out).length, 1);
  assert.match(out, /^Next: team continue "<what to add or change>" for another iteration, or read the conversation: team log --html$/);
});

test("open questions get their own line, before the line for going on, with the first id to answer", () => {
  const out = formatNextSteps(newState(), ["Q1", "Q3"], "");
  assert.deepEqual(lines(out).length, 2);
  assert.match(lines(out)[0], /^Next: answer the open questions \(Q1, Q3\): team answer Q1 "<answer>"$/);
  assert.match(lines(out)[1], /^Next: team run /);
});

test("one open question is named in the singular", () => {
  assert.match(formatNextSteps(newState(), ["Q2"], ""), /^Next: answer the open question \(Q2\): team answer Q2 "<answer>"/);
});

test("on a finished session an answer is said to be read only after continue", () => {
  const out = formatNextSteps(newState({ status: "done" }), ["Q1"], "");
  assert.equal(lines(out).length, 2);
  assert.match(lines(out)[0], /team answer Q1 "<answer>".*after.*team continue/);
  assert.match(lines(out)[1], /^Next: team continue /);
});

test("every command names the session when it is not the current one", () => {
  const running = formatNextSteps(newState(), ["Q1"], " --session s1");
  assert.match(running, /team answer --session s1 Q1 "<answer>"/);
  assert.match(running, /team run --session s1 /);
  const done = formatNextSteps(newState({ status: "done" }), [], " --session s1");
  assert.match(done, /team continue --session s1 "<what to add or change>"/);
  assert.match(done, /team log --session s1 --html/);
});

test("the Claude Code phrase names the session, so it works whichever session is current", () => {
  assert.match(formatNextSteps(newState({ name: "villa-57" }), [], ""), /"continue the villa-57 session"/);
});

test("openQuestionIds lists the questions nobody answered yet, in order", () => {
  const ask = (text: string) => ({ by: "eng", text, phase: "build", iteration: 1 });
  const s = newState({ questions: [ask("a"), ask("b"), ask("c")] });
  assert.deepEqual(openQuestionIds(s, new Set(["Q2"])), ["Q1", "Q3"]);
  assert.deepEqual(openQuestionIds(s, new Map([["Q1", "x"], ["Q2", "y"], ["Q3", "z"]])), []);
  assert.deepEqual(openQuestionIds(newState({ questions: undefined }), new Set()), [], "a session saved before questions existed has none");
});

test("just after an answer on a finished session, the line to continue says the answer reaches the team only after it", () => {
  const done = newState({ status: "done" });
  const out = formatNextSteps(done, [], "", true);
  assert.equal(lines(out).length, 1);
  assert.match(out, /^Next: team continue "<what to add or change>" for another iteration \(the team reads your answer only after this\), or read the conversation: team log --html$/);
  const more = lines(formatNextSteps(done, ["Q2"], "", true));
  assert.equal(more.length, 2);
  assert.match(more[0], /^Next: answer the open question \(Q2\): team answer Q2 "<answer>"$/, "the note is said once, on the line to continue");
  assert.match(more[1], /only after this/);
});

test("the head of status is the session line and the phase line, which --full ends with the phase's goal", () => {
  const s = newState({ iteration: 2, round: 1 });
  const goal = s.phases[s.phaseIndex].goal;
  const [session, phase, ...rest] = formatStatusHead(s, false);
  assert.equal(session, "session: s1  status: running  iteration: 2/2");
  assert.match(phase, /^phase: discovery \(round 1\/\d+, round-robin\)$/);
  assert.deepEqual(rest, []);
  assert.deepEqual(formatStatusHead(s, true), [session, `${phase} — ${goal}`]);
});

test("the head of status names the workspace of an existing codebase between the session and the phase", () => {
  const head = formatStatusHead(newState({ workspace: "wt-a", externalWorkspace: true }), false);
  assert.equal(head.length, 3);
  assert.equal(head[1], "workspace: wt-a (existing codebase)");
});
