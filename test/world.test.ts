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

test("a user who gives two verdicts in one iteration counts once, by the latest", () => {
  const w = make(2);
  toAcceptance(w);
  w.record("u1", "[VERDICT reject] no");
  w.record("u2", "[VERDICT accept] ok");
  w.record("u1", "[VERDICT reject] still no", { force: true });
  w.record("pm", "[DECISION] retry");
  assert.equal(w.state.verdicts.length, 3, "every verdict stays in the history");
  assert.ok(w.emitted.some((e) => e.kind === "system" && /Iteration 2 begins: 1\/2 users rejected \(u1\)\./.test(e.text)));

  const done = make(1);
  toAcceptance(done);
  done.record("u1", "[VERDICT reject] no");
  done.record("u2", "[VERDICT accept] ok");
  done.record("u1", "[VERDICT accept] fine", { force: true });
  done.record("pm", "thanks");
  assert.equal(done.state.status, "done");
  assert.ok(done.emitted.some((e) => e.kind === "system" && /2\/2 users accepted\./.test(e.text)));
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

test("an engineer's [VERIFY] command is kept; the trial phase is due once per iteration", () => {
  const w = make(1);
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] ok");
  w.record("e2", "[TASK_DONE T2] ok");
  w.record("e1", "[VERIFY] `npm run verify`");
  w.record("e2", "[VERIFY] two\nlines");
  assert.deepEqual(w.state.verify, { command: "npm run verify", by: "e1" });
  assert.equal(w.trialDue, false, "not in review");
  w.record("pm", "ready");
  assert.equal(w.phase.id, "acceptance");
  assert.equal(w.trialDue, true);
  w.addTrial({ command: "npm run verify", exitCode: 1, output: "journey 2 failed", artifacts: [] });
  assert.equal(w.trialDue, false);
  assert.match(w.emitted.at(-1)!.text, /exit 1/);
});

test("users see the trial run's real output in their acceptance prompt", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = make(1);
  toAcceptance(w);
  w.addTrial({ command: "node verify.js", exitCode: 0, output: "opened /day: 3 rows", artifacts: [".team/sessions/t/artifacts/iteration-1/day.png"] });
  const u = buildPrompt(w.state, "u1", w.emitted, []).user;
  assert.match(u, /## Trial run \(iteration 1\)/);
  assert.match(u, /opened \/day: 3 rows/);
  assert.match(u, /day\.png/);
});

test("a member whose last remark read like a report is reminded to talk", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = make();
  w.record("pm", "[SAY to=all] " + "長い説明です。".repeat(150));
  w.record("u1", "はい");
  w.record("u2", "はい");
  assert.match(buildPrompt(w.state, "pm", w.emitted, []).user, /read like a written report/);
  assert.doesNotMatch(buildPrompt(w.state, "u1", w.emitted, []).user, /read like a written report/);
  assert.match(buildPrompt(w.state, "u1", w.emitted, []).system, /live meeting/);
});

test("a round leaves room for several question-and-answer exchanges", () => {
  const w = make();
  w.record("pm", "[SAY to=u1] q1");
  w.record("u1", "[SAY to=pm] a1");
  w.record("u2", "[SAY to=pm] me too");
  // the PM already spoke, so each answer earns it a follow-up turn, and each follow-up earns the user a reply
  const order: string[] = [];
  for (let i = 0; i < 6 && w.state.round === 1; i++) {
    const [id] = w.next();
    order.push(id);
    w.record(id, id === "pm" ? "[SAY to=u1] more?" : "[SAY to=pm] sure");
  }
  assert.ok(order.filter((id) => id === "pm").length >= 2, `pm follows up more than once: ${order.join(",")}`);
});

test("a dropped task stays closed: later start, done, blocked or drop reports are ignored", () => {
  const w = make();
  toBuild(w);
  w.record("pm", "[TASK_DROP T2] out of scope", { force: true });
  w.record("pm", "[TASK owner=e1 replaces=T1] A, smaller\n- a'", { force: true });
  const closed = () => w.state.tasks.slice(0, 2).map((t) => [t.status, t.summary, t.owner]);
  const before = closed();
  assert.deepEqual(before, [["dropped", "replaced by T3", "e1"], ["dropped", "out of scope", "e2"]]);

  const log = w.emitted.length;
  w.record("e1", "[TASK_START T1]\n[TASK_DONE T1] did A\n[TASK_BLOCKED T1] needs a phone");
  w.record("pm", "[TASK_DROP T1] again", { force: true });
  w.record("e2", "[TASK_START T2]");
  assert.deepEqual(closed(), before);
  const ignored = w.emitted.slice(log).filter((e) => e.kind === "system").map((e) => e.text);
  assert.deepEqual(ignored, [
    "Ignored [TASK_START] from e1: T1 is already dropped.",
    "Ignored [TASK_DONE] from e1: T1 is already dropped.",
    "Ignored [TASK_BLOCKED] from e1: T1 is already dropped.",
    "Ignored [TASK_DROP] from pm: T1 is already dropped.",
    "Ignored [TASK_START] from e2: T2 is already dropped.",
  ]);
  assert.ok(!w.emitted.slice(log).some((e) => e.kind === "task_update"));
});

test("a done task can still be reopened to fix a review finding", () => {
  const w = make();
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] did A");
  w.record("e2", "[TASK_DONE T2] did B");
  assert.equal(w.phase.id, "review");
  w.record("e1", "[TASK_START T1] fixing what e2 found");
  assert.equal(w.state.tasks[0].status, "doing");
});

test("replacing an already dropped task is ignored: its drop reason stays and nothing is logged for it", () => {
  const w = make();
  toBuild(w);
  w.record("pm", "[TASK_DROP T2] out of scope", { force: true });
  const log = w.emitted.length;
  w.record("pm", "[TASK owner=e1 replaces=T1,T2] C\n- c", { force: true });
  assert.deepEqual(w.state.tasks.map((t) => [t.id, t.status, t.summary]), [
    ["T1", "dropped", "replaced by T3"],
    ["T2", "dropped", "out of scope"],
    ["T3", "todo", undefined],
  ]);
  const added = w.emitted.slice(log);
  assert.deepEqual(added.filter((e) => e.kind === "task_update").map((e) => e.text), ["T1 → dropped: replaced by T3"]);
  assert.deepEqual(added.filter((e) => e.kind === "system").map((e) => e.text), ["Ignored replaces=T2 from pm: T2 is already dropped."]);
});

test("a done task can still be replaced by a new one that supersedes it", () => {
  const w = make();
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] did A");
  w.record("pm", "[TASK owner=e1 replaces=T1] A, redone\n- a'", { force: true });
  assert.deepEqual([w.state.tasks[0].status, w.state.tasks[0].summary], ["dropped", "replaced by T3"]);
  assert.ok(!w.emitted.some((e) => e.kind === "system" && /Ignored replaces/.test(e.text)));
});

test("a user who rejected then accepted in one iteration is not in the PM's rejections; one who accepted then rejected is", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = make(3);
  toAcceptance(w);
  w.record("u1", "[VERDICT reject] first impression");
  w.record("u2", "[VERDICT accept] fine");
  w.record("u1", "[VERDICT accept] it works after all", { force: true });
  w.record("u2", "[VERDICT reject] on second thought, no", { force: true });
  w.record("pm", "[DECISION] retry");
  assert.equal(w.phase.id, "planning");
  assert.equal(w.state.iteration, 2);
  const lines = buildPrompt(w.state, "pm", w.emitted, []).user.split("\n");
  const at = lines.indexOf("## Rejections from the last iteration");
  assert.ok(at >= 0, "the section is there");
  assert.equal(lines[at + 1], "- U2: on second thought, no");
  assert.match(lines[at + 2], /^Before planning fixes/, "U1 is not listed");
});

test("the streak of rejections counts each iteration's latest verdict, so a changed mind in one iteration decides it", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = make(3);
  toAcceptance(w);
  w.record("u1", "[VERDICT accept] looks fine");
  w.record("u2", "[VERDICT reject] no");
  w.record("u1", "[VERDICT reject] on second thought, no", { force: true });
  w.record("u2", "[VERDICT accept] ok now", { force: true });
  w.record("pm", "[DECISION] retry");
  w.record("pm", "[TASK owner=e1] C\n- c\n[ADVANCE]");
  w.record("e1", "[TASK_DONE T3] ok");
  for (const id of ["e2", "e1", "e2", "pm"]) w.record(id, "-");
  w.record("u1", "[VERDICT reject] broken again");
  w.record("u2", "[VERDICT reject] now this");
  w.record("pm", "-");
  assert.equal(w.state.iteration, 3);
  const pm = buildPrompt(w.state, "pm", w.emitted, []).user;
  assert.match(pm, /- U1 \(rejected in all 2 iterations so far\): broken again/);
  assert.match(pm, /- U2: now this/, "U2 accepted last time, so no streak");
});

/** The body of the prompt section whose heading matches `title`. */
const section = (prompt: string, title: RegExp) => prompt.split("\n## ").find((s) => title.test(s.split("\n")[0])) ?? "";
const OPEN = /^Open questions/;
const ANSWERED = /^Answered by the human/;

const askTwo = () => {
  const w = make();
  w.record("pm", "[ASK_HUMAN] Which payment provider? Default: Stripe.\n[ASK_HUMAN] May we publish? Default: no.");
  return w;
};

test("questions for the human are numbered Q1, Q2 in the order asked, in prompts of everyone but users", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = askTwo();
  const open = section(buildPrompt(w.state, "e1", w.emitted, []).user, OPEN);
  assert.match(open, /- Q1 .*Which payment provider/);
  assert.match(open, /- Q2 .*May we publish/);
  assert.match(open, /assigned by the engine/, "members are told not to number their own questions");
  assert.equal(section(buildPrompt(w.state, "u1", w.emitted, []).user, OPEN), "", "users get no questions section");
});

test("answering a question moves it from open to answered in the next prompt and tells the whole team", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const { formatEntry } = await import("../src/render.ts");
  const w = askTwo();
  const asked = structuredClone(w.state.questions);
  w.answer("Q2", "Yes, publish it.");

  const e = w.emitted.at(-1)!;
  assert.deepEqual([e.from, e.kind, e.to], ["human", "say", ["all"]]);
  assert.equal(e.text, "Answer to Q2 (May we publish? Default: no.): Yes, publish it.");
  assert.deepEqual(e.answers, { question: "Q2", text: "Yes, publish it." });
  assert.match(formatEntry(w.state, e), /^human: Answer to Q2 /);
  assert.deepEqual(w.state.questions, asked, "the transcript is the only record of an answer, so state.json has none");
  for (const id of ["pm", "e1", "u1"]) assert.ok(visibleTo(e, id), `${id} sees the answer`);

  const prompt = buildPrompt(w.state, "e1", w.emitted, []).user;
  const open = section(prompt, OPEN);
  assert.match(open, /Q1/);
  assert.doesNotMatch(open, /Q2/);
  const answered = section(prompt, ANSWERED);
  assert.match(answered, /- Q2 .*May we publish/);
  assert.match(answered, /Yes, publish it\./);
  assert.doesNotMatch(answered, /Q1/);
});

test("with every question answered there is no open-questions section", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = askTwo();
  w.answer("Q1", "Stripe");
  w.answer("Q2", "no");
  const prompt = buildPrompt(w.state, "pm", w.emitted, []).user;
  assert.equal(section(prompt, OPEN), "");
  assert.match(section(prompt, ANSWERED), /Q1[\s\S]*Q2/);
});

test("a multi-line answer keeps its continuation lines under the answer label", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = askTwo();
  w.answer("Q1", "Stripe,\nbut only for cards.");
  const answered = section(buildPrompt(w.state, "pm", w.emitted, []).user, ANSWERED);
  assert.match(answered, /\n {2}answer: Stripe,\n {4}but only for cards\./);
});

test("answering an unknown question fails and changes nothing", () => {
  const w = askTwo();
  const before = [JSON.stringify(w.state), w.emitted.length];
  for (const id of ["Q3", "Q0", "2", "T1", ""]) assert.throws(() => w.answer(id, "x"), /unknown question/);
  assert.throws(() => make().answer("Q1", "x"), /no questions have been asked/);
  assert.deepEqual([JSON.stringify(w.state), w.emitted.length], before);
});

test("an empty answer is refused and changes nothing", () => {
  const w = askTwo();
  const before = [JSON.stringify(w.state), w.emitted.length];
  for (const text of ["", "  \n "]) assert.throws(() => w.answer("Q1", text), /an answer is required/);
  assert.deepEqual([JSON.stringify(w.state), w.emitted.length], before);
});

test("answering again replaces the earlier answer and the log line says so", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = askTwo();
  w.answer("Q1", "Stripe is fine.");
  assert.doesNotMatch(w.emitted.at(-1)!.text, /replac/);
  w.answer("q1", "No, use PayPay.");
  assert.match(w.emitted.at(-1)!.text, /^Answer to Q1 \(.*\), replacing the earlier answer: No, use PayPay\.$/);
  const answered = section(buildPrompt(w.state, "pm", w.emitted, []).user, ANSWERED);
  assert.match(answered, /No, use PayPay\./);
  assert.doesNotMatch(answered, /Stripe is fine\./);
});

test("answersByQuestion keeps the latest answer per question and ignores plain messages", async () => {
  const { answersByQuestion } = await import("../src/world.ts");
  const w = askTwo();
  w.answer("Q1", "Stripe");
  w.answer("Q2", "no");
  w.answer("q1", "PayPay");
  w.broadcast("Answer to Q2 (May we publish?): yes");
  assert.deepEqual([...answersByQuestion(w.emitted)], [["Q1", "PayPay"], ["Q2", "no"]]);
});

/** A one-iteration session in which e1 asks the human something during the build, run through to done. */
function finishedWithQuestion(answerEarly: boolean): World {
  const w = make(1);
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] ok\n[ASK_HUMAN] May we publish to GitHub Pages? Meanwhile we demo from a local server.");
  if (answerEarly) w.answer("Q1", "Yes, publish it.");
  w.record("e2", "[TASK_BLOCKED T2] only the owner can create the API key");
  w.record("e1", "lgtm");
  w.record("e2", "lgtm");
  w.record("pm", "ready");
  w.record("u1", "[VERDICT accept] ok");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "thanks");
  assert.equal(w.state.status, "done");
  return w;
}

test("a question can still be answered after the session is done, and the answer is logged", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = finishedWithQuestion(false);
  w.emitted.length = 0;
  w.answer("Q1", "Yes, publish it.");
  assert.equal(w.state.status, "done");
  assert.equal(w.emitted.length, 1);
  assert.deepEqual([w.emitted[0].from, w.emitted[0].kind, w.emitted[0].answers?.question], ["human", "say", "Q1"]);
  assert.match(section(buildPrompt(w.state, "pm", w.emitted, []).user, ANSWERED), /Yes, publish it\./);
  assert.deepEqual(w.next(), [], "the session stays done");
});

test("the end-of-session summary reports only questions still waiting for the human", () => {
  assert.match(finishedWithQuestion(false).emitted.at(-1)!.text, /1 question\(s\) for the human/);
  assert.doesNotMatch(finishedWithQuestion(true).emitted.at(-1)!.text, /question\(s\) for the human/);
});
