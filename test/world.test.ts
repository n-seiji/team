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

test("a dropped task stays closed: later start, done, blocked, check or drop reports are ignored", () => {
  const w = make();
  toBuild(w);
  w.record("pm", "[TASK_DROP T2] out of scope", { force: true });
  w.record("pm", "[TASK owner=e1 replaces=T1] A, smaller\n- a'", { force: true });
  const closed = () => w.state.tasks.slice(0, 2).map((t) => [t.status, t.summary, t.owner]);
  const before = closed();
  assert.deepEqual(before, [["dropped", "replaced by T3", "e1"], ["dropped", "out of scope", "e2"]]);

  const log = w.emitted.length;
  w.record("e1", "[TASK_START T1]\n[TASK_DONE T1] did A\n[TASK_BLOCKED T1] needs a phone\n[CHECK T1] try it");
  w.record("pm", "[TASK_DROP T1] again", { force: true });
  w.record("e2", "[TASK_START T2]");
  assert.deepEqual(closed(), before);
  const ignored = w.emitted.slice(log).filter((e) => e.kind === "system").map((e) => e.text);
  assert.deepEqual(ignored, [
    "Ignored [TASK_START] from e1: T1 is already dropped.",
    "Ignored [TASK_DONE] from e1: T1 is already dropped.",
    "Ignored [TASK_BLOCKED] from e1: T1 is already dropped.",
    "Ignored [CHECK] from e1: T1 is already dropped.",
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

const CHECK = "try it on a real phone: does Enter save the entry?";
const HANDOFF = "publishing needs a login only the owner has";

/** A one-iteration session in which both users accepted and the PM has not yet closed acceptance. */
function acceptedOnce(): World {
  const w = make(1);
  toAcceptance(w);
  w.record("u1", "[VERDICT accept] ok");
  w.record("u2", "[VERDICT accept] ok");
  return w;
}

/** In acceptance: T1 is built with a check for a person, T2 is built but handed over to one. */
function withCheckAndHandoff(): World {
  const w = make();
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] did A");
  w.record("e2", `[TASK_DONE T2] did B\n[TASK_BLOCKED T2] ${HANDOFF}`);
  w.record("e1", "lgtm");
  w.record("e2", "lgtm");
  w.record("pm", `ready\n[CHECK T1] ${CHECK}`);
  assert.equal(w.phase.id, "acceptance");
  return w;
}

/** The system lines of the log since entry number `from` that say a report was ignored. */
const ignoredSince = (w: World, from: number) =>
  w.emitted.slice(from).filter((e) => e.kind === "system" && e.text.startsWith("Ignored")).map((e) => e.text);

/** One task's block of lines in the Backlog section of a prompt. */
const backlogTask = (prompt: string, id: string) =>
  section(prompt, /^Backlog/).split(/\n(?=- T\d+ )/).find((t) => t.startsWith(`- ${id} `)) ?? "";

test("[CHECK] on a built task adds a check for a person and changes neither its status nor its summary", () => {
  const w = acceptedOnce();
  const log = w.emitted.length;
  w.record("pm", `[CHECK T1] ${CHECK}`);

  const t = w.state.tasks[0];
  assert.deepEqual([t.status, t.summary, t.handoff, t.checks], ["done", "ok", undefined, [CHECK]]);
  assert.deepEqual(w.emitted.slice(log).filter((e) => e.kind === "task_update").map((e) => e.text), [`T1 check by a person: ${CHECK}`]);
  assert.deepEqual(ignoredSince(w, log), []);
});

test("[CHECK] on a task that is not done is ignored and points to [TASK_BLOCKED]", () => {
  const w = make();
  toBuild(w);
  const log = w.emitted.length;
  w.record("e1", "[TASK_START T1]\n[CHECK T1] a\n[CHECK T2] b");
  w.record("e2", "[TASK_BLOCKED T2] needs the owner's key\n[CHECK T2] c");

  assert.deepEqual(w.state.tasks.map((t) => [t.status, t.checks]), [["doing", undefined], ["blocked", undefined]]);
  const ignored = ignoredSince(w, log);
  assert.equal(ignored.length, 3);
  for (const line of ignored) assert.match(line, /^Ignored \[CHECK\] from e[12]: T[12] is not done\. .*\[TASK_BLOCKED\]/);
});

test("[CHECK] ignores an exact duplicate and an empty text, and keeps different checks in order", () => {
  const w = acceptedOnce();
  const log = w.emitted.length;
  w.record("pm", `[CHECK T1] ${CHECK}\n[CHECK T1] ${CHECK}\n[CHECK T1] print the sheet and check that it fits A4\n[CHECK T1]`);

  assert.deepEqual(w.state.tasks[0].checks, [CHECK, "print the sheet and check that it fits A4"]);
  assert.deepEqual(ignoredSince(w, log), [
    "Ignored [CHECK] from pm: T1 already has that check.",
    "Ignored [CHECK] from pm: say what a person should check on T1.",
  ]);
});

test("the PM and engineers can add checks; users cannot", () => {
  const w = make();
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] did A\n[CHECK T1] not tried on a real phone");
  w.record("e2", "[TASK_DONE T2] did B");
  w.record("pm", "[CHECK T2] print it", { force: true });
  assert.deepEqual(w.state.tasks.map((t) => t.checks), [["not tried on a real phone"], ["print it"]]);

  const log = w.emitted.length;
  w.record("u1", "[CHECK T1] sneaky", { force: true });
  assert.deepEqual(ignoredSince(w, log), ['Ignored [CHECK] from u1: not allowed for role "user".']);
  assert.deepEqual(w.state.tasks[0].checks, ["not tried on a real phone"]);
});

test("[CHECK] on a dropped task is ignored like any other report", () => {
  const w = make();
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] did A");
  w.record("pm", "[TASK_DROP T1] out of scope", { force: true });
  const log = w.emitted.length;
  w.record("pm", "[CHECK T1] try it\n[CHECK T9] nothing", { force: true });
  assert.deepEqual(ignoredSince(w, log), [
    "Ignored [CHECK] from pm: T1 is already dropped.",
    'Ignored [CHECK] from pm: unknown task "T9".',
  ]);
  assert.equal(w.state.tasks[0].checks, undefined);
});

test("[TASK_BLOCKED] hands work to a person: the task is blocked and the hand-off is kept apart from the summary", () => {
  const w = make();
  toBuild(w);
  w.record("e1", "[TASK_START T1]\n[TASK_BLOCKED T1] needs a real phone to scan the QR");
  w.record("e2", "[TASK_BLOCKED T2] only the owner can create the API key");
  assert.deepEqual(
    w.state.tasks.map((t) => [t.status, t.summary, t.handoff, t.checks]),
    [
      ["blocked", undefined, "needs a real phone to scan the QR", undefined],
      ["blocked", undefined, "only the owner can create the API key", undefined],
    ],
  );
  assert.deepEqual(
    w.emitted.filter((e) => e.kind === "task_update").map((e) => e.text),
    ["T1 → doing", "T1 → blocked: needs a real phone to scan the QR", "T2 → blocked: only the owner can create the API key"],
  );
});

test("[TASK_DONE] then [TASK_BLOCKED] in one reply blocks the task, keeps what was done, and is reported as waiting on a person", async () => {
  const { formatTask } = await import("../src/render.ts");
  const w = make(1);
  toBuild(w);
  w.record("e1", `[TASK_DONE T1] works locally\n[TASK_BLOCKED T1] ${HANDOFF}`);
  w.record("e2", "[TASK_DONE T2] ok");

  const t = w.state.tasks[0];
  assert.deepEqual([t.status, t.summary, t.handoff, t.checks], ["blocked", "works locally", HANDOFF, undefined]);
  assert.equal(
    formatTask(t),
    `- T1 [blocked] owner=e1 A\n    acceptance: - a works\n    result: works locally\n    needs a person: ${HANDOFF}`,
  );

  w.record("e1", "lgtm");
  w.record("e2", "lgtm");
  w.record("pm", "ready");
  w.record("u1", "[VERDICT accept] ok");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", "thanks");
  assert.equal(w.emitted.at(-1)!.text, "Session finished after iteration 1. 2/2 users accepted. Waiting on a person: T1 (A).");
});

test("a blocked task that is started or finished again no longer has a hand-off", () => {
  const w = make();
  toBuild(w);
  const t = w.state.tasks[0];
  w.record("e1", "[TASK_BLOCKED T1] needs a phone");
  assert.deepEqual([t.status, t.handoff], ["blocked", "needs a phone"]);
  w.record("e1", "[TASK_START T1]", { force: true });
  assert.deepEqual([t.status, t.handoff], ["doing", undefined]);
  w.record("e1", "[TASK_BLOCKED T1] needs a phone again\n[TASK_DONE T1] built it without the phone", { force: true });
  assert.deepEqual([t.status, t.summary, t.handoff], ["done", "built it without the phone", undefined]);
});

test("a task keeps its checks when it is reopened and finished again, and further checks are added after them", () => {
  const w = make();
  toBuild(w);
  w.record("e1", "[TASK_DONE T1] did A");
  w.record("e2", "[TASK_DONE T2] did B");
  assert.equal(w.phase.id, "review");
  w.record("pm", `[CHECK T1] ${CHECK}`, { force: true });
  const t = w.state.tasks[0];
  assert.deepEqual([t.status, t.summary, t.checks], ["done", "did A", [CHECK]]);

  w.record("e1", "[TASK_START T1] fixing what e2 found");
  assert.deepEqual([t.status, t.summary, t.checks], ["doing", "did A", [CHECK]]);
  w.record("e1", "[TASK_DONE T1] did A and fixed the finding", { force: true });
  assert.deepEqual([t.status, t.summary, t.checks], ["done", "did A and fixed the finding", [CHECK]]);

  w.record("pm", "[CHECK T1] print the sheet and check that it fits A4", { force: true });
  assert.deepEqual(t.checks, [CHECK, "print the sheet and check that it fits A4"]);
});

test("a check survives a rejection into the next iteration and shows in the PM's planning prompt", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = make(2);
  toAcceptance(w);
  w.record("u1", "[VERDICT reject] I want it on my phone");
  w.record("u2", "[VERDICT accept] ok");
  w.record("pm", `[CHECK T1] ${CHECK}\n[DECISION] fix it`);

  assert.deepEqual([w.state.iteration, w.phase.id], [2, "planning"]);
  assert.deepEqual([w.state.tasks[0].status, w.state.tasks[0].checks], ["done", [CHECK]]);
  assert.ok(backlogTask(buildPrompt(w.state, "pm", w.emitted, []).user, "T1").includes(`\n    check by a person: ${CHECK}`));
});

test("the finish summary lists built tasks that need a check, apart from tasks waiting on a person and still open", () => {
  const w = acceptedOnce();
  w.record("pm", `[CHECK T1] ${CHECK}`);
  assert.equal(w.state.status, "done");
  assert.equal(w.emitted.at(-1)!.text, "Session finished after iteration 1. 2/2 users accepted. Built, a person should check: T1 (A).");

  const mixed = make(1);
  toBuild(mixed);
  mixed.record("e1", "[TASK_DONE T1] ok");
  mixed.record("e2", "[TASK_BLOCKED T2] only the owner can create the API key");
  mixed.record("e1", "lgtm");
  mixed.record("e2", "lgtm");
  mixed.record("pm", "ready");
  mixed.record("u1", "[VERDICT accept] ok");
  mixed.record("u2", "[VERDICT accept] ok");
  mixed.record("pm", `[CHECK T1] ${CHECK}\n[TASK owner=e1] later\n- x`);
  assert.equal(mixed.phase.id, "wrapup");
  for (const id of ["e1", "e2", "pm"]) mixed.record(id, "noted");
  assert.equal(mixed.state.status, "done");
  assert.equal(
    mixed.emitted.at(-1)!.text,
    "Session finished after iteration 1. 2/2 users accepted. Built, a person should check: T1 (A). Still open: T3 (later). Waiting on a person: T2 (B).",
  );
});

test("a task handed over after its check counts as waiting on a person, not as built", () => {
  const w = acceptedOnce();
  w.record("pm", `[CHECK T1] ${CHECK}\n[CHECK T2] ${CHECK}\n[TASK_BLOCKED T1] ${HANDOFF}`);
  assert.equal(
    w.emitted.at(-1)!.text,
    "Session finished after iteration 1. 2/2 users accepted. Built, a person should check: T2 (B). Waiting on a person: T1 (A).",
  );
});

test("a session without checks ends with no built-with-checks line", () => {
  assert.doesNotMatch(finishedWithQuestion(false).emitted.at(-1)!.text, /Built/);
});

test("tasks without a hand-off or checks render as before, whatever their status", async () => {
  const { formatTask } = await import("../src/render.ts");
  const base = { id: "T1", title: "A", acceptance: "- a works", owner: "e1", createdBy: "pm" };
  const acc = "\n    acceptance: - a works";
  const summary = "did A\nsecond line";
  assert.equal(formatTask({ ...base, status: "todo" }), `- T1 [todo] owner=e1 A${acc}`);
  assert.equal(formatTask({ ...base, status: "done", summary }), `- T1 [done] owner=e1 A${acc}\n    result: did A\n    second line`);
  assert.equal(formatTask({ ...base, status: "dropped", summary }), `- T1 [dropped] owner=e1 A${acc}\n    dropped: did A\n    second line`);
  // Sessions saved before hand-offs kept a blocked task's hand-off in its summary.
  assert.equal(formatTask({ ...base, status: "blocked", summary }), `- T1 [blocked] owner=e1 A${acc}\n    needs a person: did A\n    second line`);
  assert.equal(formatTask({ id: "T2", title: "B", acceptance: "", status: "todo", createdBy: "pm" }), "- T2 [todo] owner=- B");
});

test("a task shows its result, then what a person must do, then each check on its own line", async () => {
  const { formatTask } = await import("../src/render.ts");
  const base = { id: "T5", title: "Save entry", acceptance: "- Enter saves", owner: "e1", createdBy: "pm" };
  const head = "- T5 [blocked] owner=e1 Save entry\n    acceptance: - Enter saves";
  assert.equal(
    formatTask({ ...base, status: "blocked", summary: "built in app.js", handoff: "publish it\nwith the org login" }),
    `${head}\n    result: built in app.js\n    needs a person: publish it\n    with the org login`,
  );
  assert.equal(formatTask({ ...base, status: "blocked", handoff: "publish it" }), `${head}\n    needs a person: publish it`);
  assert.equal(
    formatTask({ ...base, status: "done", summary: "built in app.js", checks: ["Enter saves on a real phone", "print it\nand check A4"] }),
    "- T5 [done] owner=e1 Save entry\n    acceptance: - Enter saves\n    result: built in app.js\n" +
      "    check by a person: Enter saves on a real phone\n    check by a person: print it\n    and check A4",
  );
});

test("prompts show a task's checks and hand-off in the backlog to every role", async () => {
  const { buildPrompt } = await import("../src/prompt.ts");
  const w = withCheckAndHandoff();
  for (const id of ["u1", "pm", "e1"]) {
    const prompt = buildPrompt(w.state, id, w.emitted, []).user;
    const t1 = backlogTask(prompt, "T1");
    const t2 = backlogTask(prompt, "T2");
    assert.ok(t1.includes(`\n    result: did A\n    check by a person: ${CHECK}`), `${id}: T1 has its result and check`);
    assert.ok(!t1.includes("needs a person"), `${id}: T1 is not handed over`);
    assert.ok(t2.includes(`\n    result: did B\n    needs a person: ${HANDOFF}`), `${id}: T2 has its result and hand-off`);
    assert.ok(!t2.includes("check by a person"), `${id}: T2 has no check`);
  }
});

test("the markdown and HTML transcripts list checks and hand-offs in the backlog", async () => {
  const { renderMarkdown } = await import("../src/render.ts");
  const { renderHtml } = await import("../src/html.ts");
  const w = withCheckAndHandoff();

  const md = renderMarkdown(w.state, w.emitted).split("## Decisions")[0];
  assert.ok(md.includes(`result: did A\n    check by a person: ${CHECK}`));
  assert.ok(md.includes(`result: did B\n    needs a person: ${HANDOFF}`));

  const side = (html: string) => html.split("<aside>")[1].split("</aside>")[0];
  const ja = side(renderHtml(w.state, w.emitted));
  assert.ok(ja.includes(`人が確認:</span> ${CHECK}`));
  assert.ok(side(renderHtml({ ...w.state, language: "en" }, w.emitted)).includes(`check by a person:</span> ${CHECK}`));
  assert.ok(ja.includes(`<summary>result</summary><div class="muted small text">did B</div></details><details class="sub"><summary>blocked</summary><div class="muted small text">${HANDOFF}</div>`));

  const legacy = { ...w.state, tasks: [{ ...w.state.tasks[1], handoff: undefined, summary: HANDOFF }] };
  const old = side(renderHtml(legacy, w.emitted));
  assert.ok(old.includes(`<summary>blocked</summary><div class="muted small text">${HANDOFF}</div>`));
  assert.ok(!old.includes("<summary>result</summary>"));
});
