import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { main } from "../src/cli.ts";
import { Store } from "../src/store.ts";

const repo = path.resolve(import.meta.dirname, "..");

function sandbox(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "team-"));
  fs.cpSync(path.join(repo, "personas"), path.join(dir, "personas"), { recursive: true });
  fs.copyFileSync(path.join(repo, "team.config.json"), path.join(dir, "team.config.json"));
  return dir;
}

async function run(dir: string, ...args: string[]): Promise<string> {
  const out: string[] = [];
  await main([...args, "--root", dir], (s) => out.push(s));
  return out.join("\n");
}

test("auto mode with the mock backend completes a full iteration", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "s1", "--brief", "テスト用プロダクト");
  const out = await run(dir, "run", "--backend", "mock");
  assert.match(out, /session is done/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, ".team/sessions/s1/state.json"), "utf8"));
  assert.equal(state.status, "done");
  assert.ok(state.tasks.length >= 2);
  assert.equal(state.workspace, "workspace/s1");
  assert.ok(fs.existsSync(path.join(dir, "workspace/s1")));
  const md = fs.readFileSync(path.join(dir, ".team/sessions/s1/transcript.md"), "utf8");
  assert.match(md, /## Transcript/);
  assert.match(md, /acceptance/);
  const html = fs.readFileSync(path.join(dir, ".team/sessions/s1/transcript.html"), "utf8");
  assert.match(html, /<title>s1<\/title>/);
  assert.match(html, /data-from="pm"/);
  // the runtime ran the verification command the mock engineer declared, once, before acceptance
  assert.equal(state.trials.length, 1);
  assert.equal(state.trials[0].exitCode, 0);
  assert.match(state.trials[0].output, /journey: ok/);
  assert.ok(fs.existsSync(path.join(dir, ".team/sessions/s1/artifacts/iteration-1/result.txt")));
  assert.ok(state.trials[0].artifacts.includes(".team/sessions/s1/artifacts/iteration-1/result.txt"));
});

test("host mode: next --json gives prompts, record advances the turn", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "h1", "--brief", "家計簿アプリ");
  const next = JSON.parse(await run(dir, "next", "--json", "--inline"));
  assert.equal(next.phase, "discovery");
  assert.equal(next.pending[0].member, "pm");
  assert.equal(next.pending[0].subagent, "team-pm");
  assert.match(next.pending[0].prompt, /家計簿アプリ/);
  assert.match(next.pending[0].prompt, /\[SAY to=all\]/);
  assert.equal(fs.readFileSync(path.join(dir, next.pending[0].promptFile), "utf8"), next.pending[0].prompt);

  const reply = path.join(dir, "reply.txt");
  fs.writeFileSync(reply, "[SAY to=user-garcia] 最近いつ家計簿をつけましたか？");
  const rec = await run(dir, "record", "--as", "pm", "--file", reply);
  assert.match(rec, /next: user-garcia/);

  const p2 = JSON.parse(await run(dir, "next", "--json")).pending[0];
  assert.equal(p2.subagent, "team-persona");
  assert.equal(p2.prompt, undefined);
  const text = fs.readFileSync(path.join(dir, p2.promptFile), "utf8");
  assert.match(text, /最近いつ家計簿をつけましたか/);
  assert.match(text, /Daniel García/);
});

test("say injects a human message into everyone's context", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "h2", "--brief", "x");
  await run(dir, "say", "予算は月1万円までです");
  const log = await run(dir, "log");
  assert.match(log, /human: 予算は月1万円までです/);
});

test("init --json starts the session and returns the first turn in one call", async () => {
  const dir = sandbox();
  const first = JSON.parse(await run(dir, "init", "家計簿アプリ", "--name", "q1", "--json"));
  assert.equal(first.phase, "discovery");
  assert.equal(first.pending[0].member, "pm");
  assert.match(fs.readFileSync(path.join(dir, first.pending[0].promptFile), "utf8"), /家計簿アプリ/);
  // a following `next` returns the same pending turn instead of scheduling another one
  assert.deepEqual(JSON.parse(await run(dir, "next", "--json")).pending, first.pending);
});

test("record --json returns the next turn in the same call", async () => {
  const dir = sandbox();
  await run(dir, "init", "x", "--name", "r1");
  const reply = path.join(dir, "reply.txt");
  fs.writeFileSync(reply, "[SAY to=user-garcia] 最近いつ家計簿をつけましたか？");
  await run(dir, "next", "--json");
  const after = JSON.parse(await run(dir, "record", "--as", "pm", "--file", reply, "--json"));
  assert.equal(after.pending[0].member, "user-garcia");
  assert.match(fs.readFileSync(path.join(dir, after.pending[0].promptFile), "utf8"), /最近いつ家計簿をつけましたか/);
});

function git(dir: string, ...args: string[]) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
}

/** A repository with two worktrees inside the sandbox, like villa checked out for two issues. */
function repoWithWorktrees(dir: string): void {
  const origin = path.join(dir, "ext");
  fs.mkdirSync(path.join(origin, "migrations"), { recursive: true });
  fs.writeFileSync(path.join(origin, "migrations/0020_init.sql"), "-- init\n");
  git(origin, "init", "-q", "-b", "main");
  git(origin, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "root");
  git(origin, "add", ".");
  git(origin, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  git(origin, "worktree", "add", "-q", "-b", "a", path.join(dir, "wt-a"));
  git(origin, "worktree", "add", "-q", "-b", "b", path.join(dir, "wt-b"));
}

test("init --workspace uses an existing codebase and warns about clashing sessions", async () => {
  const dir = sandbox();
  repoWithWorktrees(dir);
  fs.writeFileSync(path.join(dir, "wt-a/migrations/0021_keys.sql"), "-- a\n");
  fs.writeFileSync(path.join(dir, "wt-b/migrations/0021_epochs.sql"), "-- b\n");
  await run(dir, "init", "--name", "a", "--brief", "issue A", "--workspace", "wt-a");
  await run(dir, "init", "--name", "b", "--brief", "issue B", "--workspace", "wt-b");

  const state = JSON.parse(fs.readFileSync(path.join(dir, ".team/sessions/b/state.json"), "utf8"));
  assert.equal(state.workspace, "wt-b");
  assert.equal(state.externalWorkspace, true);
  assert.ok(!fs.existsSync(path.join(dir, "workspace/b")));

  const overlaps = JSON.parse(await run(dir, "overlaps", "--json"));
  assert.deepEqual(overlaps.sessions.sort(), ["a", "b"]);
  assert.equal(overlaps.overlaps.length, 1);
  assert.equal(overlaps.overlaps[0].kind, "same-number");
  assert.equal(overlaps.overlaps[0].key, "migrations/0021_*");
  assert.match(await run(dir, "status"), /same number migrations\/0021_\*/);

  // Engineers see their own changes, the codebase's rules and the other session's files.
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, "[ADVANCE] ok"));
  const p = JSON.parse(await run(dir, "next", "--json", "--inline")).pending[0];
  assert.equal(p.role, "pm");
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, "[TASK owner=eng-backend] x\n- y"));
  const eng = JSON.parse(await run(dir, "next", "--json", "--inline")).pending[0];
  assert.equal(eng.role, "engineer");
  assert.match(eng.prompt, /- migrations\/0021_epochs\.sql/);
  assert.match(eng.prompt, /existing codebase/);
  assert.match(eng.prompt, /a: migrations\/0021_keys\.sql/);
});

test("init --workspace rejects a missing folder", async () => {
  const dir = sandbox();
  await assert.rejects(run(dir, "init", "--name", "x", "--brief", "b", "--workspace", "nope"), /workspace not found/);
});

test("users see this iteration's demos in acceptance; status --json names the phase", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "d1", "--brief", "デモ確認");
  await run(dir, "run", "--backend", "mock", "--turns", "14");
  let next = JSON.parse(await run(dir, "next", "--json", "--inline"));
  for (let i = 0; next.phase !== "acceptance" && i < 40; i++) {
    await run(dir, "run", "--backend", "mock", "--turns", "1");
    next = JSON.parse(await run(dir, "next", "--json", "--inline"));
  }
  assert.equal(next.phase, "acceptance");
  assert.equal(next.pending[0].role, "user");
  assert.match(next.pending[0].prompt, /## Demos shown by the team/);
  assert.match(next.pending[0].prompt, /T1: README の手順で実行すると/);
  assert.equal(JSON.parse(await run(dir, "status", "--json")).phase, "acceptance");
});

test("transcript shows task updates without an action-like tag", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "r1", "--brief", "表示");
  await run(dir, "run", "--backend", "mock");
  const log = await run(dir, "log");
  assert.match(log, /\(task update\) T1 → done/);
  assert.doesNotMatch(log, /\[TASK_UPDATE\]/);
});

test("a mock run goes through wrap-up after the PM's acceptance decision", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "w1", "--brief", "まとめ");
  const out = await run(dir, "run", "--backend", "mock");
  assert.match(out, /Wrap-up before finishing/);
  assert.match(out, /\[wrapup\]/);
  assert.match(out, /session is done/);
});

function writeReply(dir: string, text: string): string {
  const f = path.join(dir, `reply-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(f, text);
  return f;
}

test("run keeps going when a member's turn fails twice", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "f1", "--brief", "失敗");
  const { MockBackend } = await import("../src/backends/mock.ts");
  const orig = MockBackend.prototype.respond;
  let calls = 0;
  MockBackend.prototype.respond = function (p, ctx) {
    if (p.member === "user-yamada" && calls++ < 2) return Promise.reject(new Error("API Error: flagged"));
    return orig.call(this, p, ctx);
  };
  try {
    const out = await run(dir, "run", "--backend", "mock");
    assert.match(out, /user-yamada skips this turn: API Error: flagged/);
    assert.match(out, /could not attend this turn/);
    assert.match(out, /session is done/);
  } finally {
    MockBackend.prototype.respond = orig;
  }
});

/** The body of the prompt section whose heading matches `title`. */
const section = (prompt: string, title: RegExp) => prompt.split("\n## ").find((s) => title.test(s.split("\n")[0])) ?? "";
const OPEN = /^Open questions/;
const ANSWERED = /^Answered by the human/;

const ASK = "[SAY to=all] hi\n[ASK_HUMAN] Which payment provider? Default: Stripe.\n[ASK_HUMAN] May we publish? Default: no.\n[ADVANCE]";

/** The entries of a session's transcript.jsonl, as written. */
const logged = (dir: string, name: string) =>
  fs
    .readFileSync(path.join(dir, `.team/sessions/${name}/transcript.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

/** Put a question from an engineer into a session's state.json, as if it had been asked in the build. */
function askInState(dir: string, name: string): void {
  const file = path.join(dir, `.team/sessions/${name}/state.json`);
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.questions = [{ by: "eng-backend", text: "May we publish? Default: no.", phase: "build", iteration: 1 }];
  fs.writeFileSync(file, JSON.stringify(state));
}

test("answer settles one question: status lists open and answered ones with ids and the next prompt carries the answer", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "a1", "--brief", "x");
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, ASK));

  const before = await run(dir, "status");
  assert.match(before, /Q1 .*Which payment provider/);
  assert.match(before, /Q2 .*May we publish/);
  assert.doesNotMatch(before, /answered questions/);
  assert.deepEqual(JSON.parse(await run(dir, "next", "--json")).openQuestions, [
    { id: "Q1", by: "pm", text: "Which payment provider? Default: Stripe." },
    { id: "Q2", by: "pm", text: "May we publish? Default: no." },
  ]);

  assert.equal(await run(dir, "answer", "q2", "Yes,", "publish it."), "ok");
  const [open, answered] = (await run(dir, "status")).split("answered questions:");
  assert.match(open, /Q1 .*Which payment provider/);
  assert.doesNotMatch(open, /Q2/);
  assert.match(answered, /Q2 .*May we publish[\s\S]*answer: Yes, publish it\./);
  assert.doesNotMatch(answered, /Q1/);
  assert.match(await run(dir, "log"), /human: Answer to Q2 \(May we publish\? Default: no\.\): Yes, publish it\./);
  assert.deepEqual(
    JSON.parse(await run(dir, "next", "--json")).openQuestions.map((q: { id: string }) => q.id),
    ["Q1"],
  );

  const entry = logged(dir, "a1").at(-1);
  assert.deepEqual([entry.from, entry.kind, entry.to], ["human", "say", ["all"]]);
  assert.deepEqual(entry.answers, { question: "Q2", text: "Yes, publish it." });

  const pm = JSON.parse(await run(dir, "next", "--json", "--inline")).pending[0];
  assert.equal(pm.member, "pm");
  assert.match(section(pm.prompt, OPEN), /Q1/);
  assert.doesNotMatch(section(pm.prompt, OPEN), /Q2/);
  assert.match(section(pm.prompt, ANSWERED), /Q2[\s\S]*Yes, publish it\./);
});

test("answer rejects an unknown question id and a missing id", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "a2", "--brief", "x");
  await assert.rejects(run(dir, "answer", "Q1", "yes"), /unknown question "Q1"/);
  await assert.rejects(run(dir, "answer"), /usage: team answer <Qn> <text>/);
  assert.doesNotMatch(await run(dir, "log"), /Answer to/);
});

test("answer works on a finished session and shows in status and both transcripts", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "a3", "--brief", "x");
  await run(dir, "run", "--backend", "mock");
  const file = path.join(dir, ".team/sessions/a3/state.json");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).status, "done");
  askInState(dir, "a3");

  await run(dir, "answer", "Q1", "Yes, publish it.");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).status, "done");
  assert.match(await run(dir, "status"), /answered questions:\n- Q1 .*May we publish[\s\S]*answer: Yes, publish it\./);
  assert.deepEqual(logged(dir, "a3").at(-1).answers, { question: "Q1", text: "Yes, publish it." });
  const md = fs.readFileSync(path.join(dir, ".team/sessions/a3/transcript.md"), "utf8");
  assert.match(md, /Q1 .*May we publish[\s\S]*answer: Yes, publish it\./);
  const html = fs.readFileSync(path.join(dir, ".team/sessions/a3/transcript.html"), "utf8");
  assert.match(html, /<b>Q1<\/b>[\s\S]*Yes, publish it\./);
});

test("an answer given while an older world is held in memory survives that world's save", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "l1", "--brief", "x");
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, ASK));
  const store = new Store(dir);
  const stale = store.load("l1"); // like `next` waiting out the 10-minute trial, or `run` between two turns
  await run(dir, "answer", "Q2", "Yes, publish it.");
  stale.record(stale.next()[0], "[SAY to=all] going on");
  store.save(stale);

  const [open, answered] = (await run(dir, "status")).split("answered questions:");
  assert.doesNotMatch(open, /Q2/);
  assert.match(answered, /Q2 .*May we publish[\s\S]*answer: Yes, publish it\./);
  const { buildPrompt } = await import("../src/prompt.ts");
  const prompt = buildPrompt(store.load("l1").state, "pm", store.transcript("l1"), []).user;
  assert.doesNotMatch(section(prompt, OPEN), /Q2/);
  assert.match(section(prompt, ANSWERED), /Yes, publish it\./);
});

test("the finish summary counts only questions that were not answered before the session ended", async () => {
  for (const [name, answer] of [["g1", false], ["g2", true]] as const) {
    const dir = sandbox();
    await run(dir, "init", "--name", name, "--brief", "x");
    askInState(dir, name);
    if (answer) await run(dir, "answer", "Q1", "Yes, publish it.");
    await run(dir, "run", "--backend", "mock");
    const log = await run(dir, "log");
    assert.match(log, /Session finished/);
    if (answer) assert.doesNotMatch(log, /Session finished.*question\(s\) for the human/);
    else assert.match(log, /Session finished.*1 question\(s\) for the human/);
  }
});
