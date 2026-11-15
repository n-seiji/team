import { test } from "node:test";
import assert from "node:assert/strict";
import { formatStatusSummary } from "../src/summary.ts";
import type { HumanQuestion, SessionState } from "../src/types.ts";
import { newState, task, verdict } from "./session-state.ts";
import { isWellFormed } from "./well-formed.ts";

type Context = Parameters<typeof formatStatusSummary>[1];
const quiet: Context = { answers: new Map(), next: [], overlaps: [], via: "" };
const summary = (s: SessionState, ctx: Partial<Context> = {}) => formatStatusSummary(s, { ...quiet, ...ctx });
const lines = (text: string) => text.split("\n");
const ask = (text: string, by = "eng"): HumanQuestion => ({ by, text, phase: "build", iteration: 1 });

test("the summary names the session, its state, the phase, the iteration and the round, and leaves the phase's goal out", () => {
  const s = newState({ iteration: 2, round: 1 });
  const out = summary(s);
  assert.match(out, /^session: s1 {2}status: running {2}iteration: 2\/2$/m);
  assert.match(out, /^phase: discovery \(round 1\/\d+, round-robin\)$/m);
  assert.ok(!out.includes(s.phases[s.phaseIndex].goal), "the goal is a long paragraph");
});

test("an existing codebase is named as the workspace", () => {
  assert.match(summary(newState({ workspace: "wt-a", externalWorkspace: true })), /^workspace: wt-a \(existing codebase\)$/m);
  assert.doesNotMatch(summary(newState()), /^workspace:/m);
});

test("a long brief is cut to one line, whole characters only", () => {
  const brief = "請求書を作るツール。\n" + "あ".repeat(300) + "𠮷";
  const out = summary(newState({ brief }));
  const line = lines(out).find((l) => l.startsWith("brief: "))!;
  assert.ok(line.endsWith("…"));
  assert.ok(isWellFormed(line));
  assert.ok(line.length < 120);
  assert.match(line, /^brief: 請求書を作るツール。 ああ/);
});

test("the backlog is one line per task: id, status, owner and title, without acceptance or result", () => {
  const out = summary(
    newState({
      tasks: [
        task("T1", { title: "Save entry", acceptance: "- ACCEPT-ONE\n- ACCEPT-TWO", summary: "RESULT-TEXT\nsecond line" }),
        task("T2", { title: "Export", status: "doing", owner: undefined }),
        task("T3", { title: "Old idea", status: "dropped", summary: "not needed" }),
      ],
    }),
  );
  assert.match(out, /^backlog:\n- T1 \[done\] owner=eng Save entry\n- T2 \[doing\] owner=- Export\n- T3 \[dropped\] owner=eng Old idea$/m);
  assert.doesNotMatch(out, /ACCEPT-|RESULT-TEXT|not needed/);
});

test("an empty backlog says so", () => {
  assert.match(summary(newState()), /^backlog:\n {2}\(none\)$/m);
});

test("a task handed to a person is listed with what the person must do, in full", () => {
  const out = summary(
    newState({
      tasks: [
        task("T3", { title: "Publish", status: "blocked", summary: "works locally", handoff: "Create the store account.\nThen upload the build.\n" + "x".repeat(300) }),
      ],
    }),
  );
  const [, section] = out.split("needs a person:\n");
  assert.match(section, /^- T3 \[blocked\] Publish\n {4}Create the store account\.\n {4}Then upload the build\.\n {4}x{300}\n/);
  assert.doesNotMatch(section, /works locally/, "the result is not what the person has to act on");
});

test("a blocked task from before hand-offs had a field of their own shows the hand-off kept in its summary", () => {
  const out = summary(newState({ tasks: [task("T4", { title: "Print", status: "blocked", summary: "needs a printer" })] }));
  assert.match(out, /needs a person:\n- T4 \[blocked\] Print\n {4}needs a printer$/m);
});

test("a blocked task with no text still shows, because a person has to act on it", () => {
  const out = summary(newState({ tasks: [task("T5", { title: "Sign", status: "blocked", handoff: "" })] }));
  assert.match(out, /needs a person:\n- T5 \[blocked\] Sign\n {4}\(no details given\)/);
});

test("the checks a person should make on a built task are listed, each with its task", () => {
  const out = summary(
    newState({
      tasks: [
        task("T1", { title: "Save entry", checks: ["Enter saves on a real phone", "Works offline"] }),
        task("T2", { title: "Export" }),
      ],
    }),
  );
  assert.match(out, /needs a person:\n- T1 \[done\] Save entry\n {4}check: Enter saves on a real phone\n {4}check: Works offline$/m);
  assert.doesNotMatch(out.split("needs a person:")[1], /T2/);
});

test("no section for a person when nobody has anything to do", () => {
  const out = summary(newState({ tasks: [task("T1"), task("T2", { status: "todo" })] }));
  assert.doesNotMatch(out, /needs a person/);
});

test("verdicts show each user's accept or reject with the start of the reason", () => {
  const long = "Could not find the export button anywhere.\n" + "detail ".repeat(60);
  const out = summary(newState({ iteration: 2, status: "done", verdicts: [verdict("u1", "reject", long, 2), verdict("u2", "accept", "Works for me", 2)] }));
  const [, section] = out.split("verdicts (iteration 2):\n");
  const [first, second] = lines(section);
  assert.match(first, /^- Yamada \(u1\): reject — Could not find the export button anywhere\. detail /);
  assert.ok(first.endsWith("…") && first.length < 200, first);
  assert.equal(second, "- Garcia (u2): accept — Works for me");
});

test("a user who changed their mind counts once, with the last verdict", () => {
  const out = summary(newState({ iteration: 1, verdicts: [verdict("u1", "reject", "first"), verdict("u1", "accept", "second")] }));
  assert.match(out, /- Yamada \(u1\): accept — second/);
  assert.doesNotMatch(out, /first/);
});

test("while the next iteration is running, the verdicts shown are the latest ones given, with their iteration", () => {
  const out = summary(newState({ iteration: 2, verdicts: [verdict("u1", "reject", "too slow", 1)] }));
  assert.match(out, /^verdicts \(iteration 1\):\n- Yamada \(u1\): reject — too slow$/m);
});

test("no verdicts section before anyone has given one", () => {
  assert.doesNotMatch(summary(newState()), /verdicts/);
});

test("an open question is shown in full with its id, who asked and the default the team goes on", () => {
  const text = "Which payment provider?\nDefault: Stripe. " + "y".repeat(200);
  const out = summary(newState({ questions: [ask(text, "eng"), ask("Publish it?")] }));
  assert.match(out, /^open questions for the human \(the team proceeds on the stated defaults; answer with: team answer <Qn> <text>\):$/m);
  assert.match(out, /^- Q1 \(build, Tanaka \(eng\)\) Which payment provider\?\n {2}Default: Stripe\. y{200}$/m);
  assert.match(out, /^- Q2 \(build, Tanaka \(eng\)\) Publish it\?$/m);
});

test("an answered question is one line with its answer, apart from the open ones", () => {
  const out = summary(newState({ questions: [ask("Which payment provider?\nDefault: Stripe."), ask("Publish it?")] }), { answers: new Map([["Q1", "Use Stripe,\nplease"]]) });
  const [open, answered] = out.split("answered questions:\n");
  assert.match(open, /- Q2 .*Publish it\?/);
  assert.doesNotMatch(open, /Q1/);
  assert.match(answered, /^- Q1 \(build, Tanaka \(eng\)\) Which payment provider\? Default: Stripe\.\n {2}answer: Use Stripe, please$/m);
});

test("no question sections when nobody asked", () => {
  const out = summary(newState());
  assert.doesNotMatch(out, /questions/);
});

test("overlaps with other sessions are listed", () => {
  const out = summary(newState(), { overlaps: ["same file src/a.ts: a, b"] });
  assert.match(out, /^overlaps with other sessions:\n {2}same file src\/a\.ts: a, b$/m);
  assert.doesNotMatch(summary(newState()), /overlaps/);
});

test("who speaks next is shown while the session is running, and not once it is done", () => {
  assert.match(summary(newState(), { next: ["pm", "u1"] }), /^next speaker: Sato \(pm\), Yamada \(u1\)$/m);
  assert.doesNotMatch(summary(newState({ status: "done" }), { next: [] }), /next speaker/);
});

test("the summary ends with the next steps, naming the session when it is not the current one", () => {
  const s = newState({ status: "done", questions: [ask("Publish it?")] });
  const out = lines(summary(s, { via: " --session s1" }));
  assert.match(out.at(-2)!, /^Next: answer the open question \(Q1\): team answer --session s1 Q1 /);
  assert.match(out.at(-1)!, /^Next: team continue --session s1 /);
});

test("a finished session with a full backlog, verdicts and a hand-off still fits on a screen", () => {
  const tasks = Array.from({ length: 9 }, (_, i) => task(`T${i + 1}`, { title: "Do something useful ".repeat(10), acceptance: "x\n".repeat(40), summary: "y\n".repeat(60) }));
  tasks[2] = task("T3", { status: "blocked", handoff: "Publish the build to the store" });
  const s = newState({ status: "done", iteration: 2, brief: "b\n".repeat(50), tasks, verdicts: [verdict("u1", "reject", "r\n".repeat(30), 2), verdict("u2", "accept", "ok", 2)] });
  assert.ok(lines(summary(s)).length <= 30, summary(s));
});

test("a finished session with no verdict in its last iteration says so, and does not show an earlier iteration's verdicts as its result", () => {
  const out = summary(newState({ status: "done", iteration: 2, verdicts: [verdict("u1", "accept", "ok", 1), verdict("u2", "accept", "ok", 1)] }));
  assert.match(out, /^no verdicts in iteration 2 \(last given in iteration 1\)$/m);
  assert.doesNotMatch(out, /^- Yamada/m);
  assert.doesNotMatch(out, /^verdicts/m);
});

test("a finished session that never had a verdict says so without naming another iteration", () => {
  assert.match(summary(newState({ status: "done" })), /^no verdicts in iteration 1$/m);
});

test("a finished session shows the verdicts of its last iteration even when an earlier one had more", () => {
  const out = summary(newState({ status: "done", iteration: 2, verdicts: [verdict("u1", "reject", "bad", 1), verdict("u2", "reject", "bad", 1), verdict("u1", "accept", "fine", 2)] }));
  assert.match(out, /^verdicts \(iteration 2\):\n- Yamada \(u1\): accept — fine$/m);
  assert.doesNotMatch(out, /Garcia/);
});

test("a reject keeps twice as much of its reason as an accept does, because the reason is what to act on", () => {
  const reason = "word ".repeat(80);
  const out = summary(newState({ status: "done", verdicts: [verdict("u1", "reject", reason), verdict("u2", "accept", reason)] }));
  const [reject, accept] = lines(out.split("verdicts (iteration 1):\n")[1]);
  assert.ok(reject.endsWith("…") && accept.endsWith("…"));
  assert.ok(reject.length > accept.length + 60, `${reject.length} vs ${accept.length}`);
  assert.ok(reject.length <= 200, "still one line of a terminal's width");
});

const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

test("nothing that could disturb a terminal gets through, from any text the team wrote or the human typed", () => {
  const bad = "\u001b[31mred\u202ereversed\u0007\u0085";
  const s = newState({
    brief: `brief ${bad}`,
    workspace: `ws ${bad}`,
    externalWorkspace: true,
    tasks: [
      task("T1", { title: `title ${bad}`, owner: `eng${bad}`, checks: [`check ${bad}\nsecond ${bad}`] }),
      task("T2", { title: "Publish", status: "blocked", handoff: `hand-off ${bad}\nsecond ${bad}` }),
    ],
    verdicts: [verdict("u1", "reject", `reason ${bad}`)],
    questions: [ask(`question ${bad}\nDefault: ${bad}`), ask("answered one")],
  });
  const out = summary(s, { answers: new Map([["Q2", `answer ${bad}`]]), overlaps: [`same file ${bad}`] });
  assert.doesNotMatch(out, UNSAFE);
  assert.match(out, /^brief: brief \[31mredreversed$/m);
  assert.match(out, /^ {4}hand-off \[31mredreversed\n {4}second /m, "a hand-off keeps its line breaks");
  assert.match(out, /^- Q1 .* question \[31mredreversed\n {2}Default: /m, "so does a question");
});
