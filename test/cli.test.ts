import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { main } from "../src/cli.ts";
import { Store } from "../src/store.ts";
import { World } from "../src/world.ts";
import { artifactsDir } from "../src/prompt.ts";
import { runTrialIfDue } from "../src/verify.ts";
import { ReplyError } from "../src/usage.ts";
import { withEnv } from "./with-env.ts";

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
  execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", ...args], { stdio: "ignore" });
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

test("status and both transcripts show a task's checks and hand-off", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "c1", "--brief", "x");
  const file = path.join(dir, ".team/sessions/c1/state.json");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  const task = { acceptance: "", owner: "eng-backend", createdBy: "pm" };
  state.tasks = [
    { ...task, id: "T1", title: "Save entry", status: "done", summary: "built in app.js", checks: ["Enter saves on a real phone"] },
    { ...task, id: "T2", title: "Export", status: "done", summary: "built in export.js" },
    { ...task, id: "T3", title: "Publish", status: "blocked", summary: "works locally", handoff: "publishing needs the owner's account" },
    { ...task, id: "T4", title: "Print", status: "blocked", summary: "needs a printer" },
  ];
  fs.writeFileSync(file, JSON.stringify(state));

  const status = await run(dir, "status");
  assert.ok(status.includes("- T1 [done] owner=eng-backend Save entry\n    result: built in app.js\n    check by a person: Enter saves on a real phone\n- T2 [done]"));
  assert.ok(status.includes("- T3 [blocked] owner=eng-backend Publish\n    result: works locally\n    needs a person: publishing needs the owner's account\n- T4 [blocked]"));
  assert.ok(status.includes("- T4 [blocked] owner=eng-backend Print\n    needs a person: needs a printer"));
  const json = JSON.parse(await run(dir, "status", "--json"));
  assert.deepEqual([json.tasks[0].checks, json.tasks[2].handoff], [["Enter saves on a real phone"], "publishing needs the owner's account"]);

  await run(dir, "say", "hello"); // saving regenerates the transcripts
  const md = fs.readFileSync(path.join(dir, ".team/sessions/c1/transcript.md"), "utf8");
  assert.ok(md.includes("result: built in app.js\n    check by a person: Enter saves on a real phone"));
  assert.ok(md.includes("result: works locally\n    needs a person: publishing needs the owner's account"));
  const html = fs.readFileSync(path.join(dir, ".team/sessions/c1/transcript.html"), "utf8");
  const aside = html.split("<aside>")[1].split("</aside>")[0];
  assert.ok(aside.includes("Enter saves on a real phone"));
  assert.ok(aside.includes("publishing needs the owner's account"));
});

interface UsageLine {
  turn: number;
  member: string;
  role: string;
  phase: string;
  iteration: number;
  source: string;
  promptChars?: number;
  replyChars: number;
  tokens?: Record<string, number>;
  reportedTokens?: number;
  costUsd?: number;
  durationMs?: number;
  modelCalls?: number;
  skipped?: boolean;
}

function usageFile(dir: string, name: string): string {
  return path.join(dir, ".team/sessions", name, "usage.jsonl");
}

function usageLines(dir: string, name: string): UsageLine[] {
  const f = usageFile(dir, name);
  return fs.existsSync(f)
    ? fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as UsageLine)
    : [];
}

test("auto mode writes one usage line per turn, in the phase the member spoke in", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "u1", "--brief", "使用量");
  await run(dir, "run", "--backend", "mock");
  const state = JSON.parse(fs.readFileSync(path.join(dir, ".team/sessions/u1/state.json"), "utf8"));
  const lines = usageLines(dir, "u1");
  assert.equal(lines.length, state.turn);
  assert.deepEqual(lines.map((l) => l.turn), Array.from({ length: state.turn }, (_, i) => i + 1));
  for (const l of lines) {
    assert.equal(l.source, "mock");
    assert.ok(l.promptChars! > 0, `turn ${l.turn} has a prompt size`);
    assert.ok(l.replyChars > 0, `turn ${l.turn} has a reply size`);
    assert.equal(l.tokens, undefined, "the mock backend reports no tokens");
  }
  assert.deepEqual(
    { member: lines[0].member, role: lines[0].role, phase: lines[0].phase, iteration: lines[0].iteration },
    { member: "pm", role: "pm", phase: "discovery", iteration: 1 },
  );
  // a reply that moves the session on still belongs to the phase it was said in
  const transcript = fs.readFileSync(path.join(dir, ".team/sessions/u1/transcript.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const l of lines) {
    for (const e of transcript.filter((e) => e.turn === l.turn && e.from === l.member)) assert.equal(e.phase, l.phase, `turn ${l.turn}`);
  }
});

test("host mode: record --tokens writes a host usage line sized from the prompt that next wrote", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "u2", "--brief", "x");
  const pending = JSON.parse(await run(dir, "next", "--json")).pending[0];
  const promptChars = fs.readFileSync(path.join(dir, pending.promptFile), "utf8").length;
  const reply = writeReply(dir, "[SAY to=user-garcia] 最近いつ家計簿をつけましたか？");
  await run(dir, "record", "--as", "pm", "--file", reply, "--tokens", "1234", "--duration-ms", "500");
  const [line, ...rest] = usageLines(dir, "u2");
  assert.equal(rest.length, 0);
  assert.equal(line.source, "host");
  assert.equal(line.turn, 1);
  assert.equal(line.member, "pm");
  assert.equal(line.phase, "discovery");
  assert.equal(line.promptChars, promptChars);
  assert.equal(line.replyChars, "[SAY to=user-garcia] 最近いつ家計簿をつけましたか？".length);
  assert.equal(line.reportedTokens, 1234);
  assert.equal(line.tokens, undefined, "a number the orchestrator reported is not a measured part");
  assert.equal(line.durationMs, 500);

  // scheduling and reading the session again never add or change lines
  await run(dir, "next", "--json");
  await run(dir, "next", "--json");
  await run(dir, "status");
  assert.equal(usageLines(dir, "u2").length, 1);
  await run(dir, "record", "--as", "user-garcia", "--file", writeReply(dir, "[SAY to=pm] 先月です。"), "--json");
  const lines = usageLines(dir, "u2");
  assert.equal(lines.length, 2);
  assert.equal(lines[1].reportedTokens, undefined, "without --tokens nothing is claimed");
  assert.equal(lines[1].tokens, undefined);
  assert.equal(lines[1].durationMs, undefined);
});

test("host mode: the prompt size comes from the member's own newest prompt file", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "u3", "--brief", "x");
  const pending = JSON.parse(await run(dir, "next", "--json")).pending[0];
  const turns = path.dirname(path.join(dir, pending.promptFile));
  // another member whose id ends with "-pm", and an older prompt of pm's own
  fs.writeFileSync(path.join(turns, "0099-user-pm.prompt.md"), "z".repeat(777));
  const own = fs.readFileSync(path.join(dir, pending.promptFile), "utf8").length;
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, "[SAY to=all] hi"));
  assert.equal(usageLines(dir, "u3")[0].promptChars, own);
});

test("host mode: an interjection does not claim an old prompt's size", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "u4", "--brief", "x");
  const pending = JSON.parse(await run(dir, "next", "--json")).pending[0];
  fs.writeFileSync(path.join(path.dirname(path.join(dir, pending.promptFile)), "0042-user-garcia.prompt.md"), "z".repeat(777));
  await run(dir, "record", "--as", "user-garcia", "--force", "--file", writeReply(dir, "[SAY to=all] 割り込みです"));
  const [line] = usageLines(dir, "u4");
  assert.equal(line.member, "user-garcia");
  assert.equal(line.promptChars, undefined);
});

test("record rejects --tokens and --duration-ms that are not whole non-negative numbers, before using the turn", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "u5", "--brief", "x");
  await run(dir, "next", "--json");
  const reply = writeReply(dir, "[SAY to=all] hi");
  await assert.rejects(run(dir, "record", "--as", "pm", "--file", reply, "--tokens", "abc"), /--tokens/);
  await assert.rejects(run(dir, "record", "--as", "pm", "--file", reply, "--tokens", "-5"), /--tokens/);
  await assert.rejects(run(dir, "record", "--as", "pm", "--file", reply, "--tokens", "1.5"), /--tokens/);
  await assert.rejects(run(dir, "record", "--as", "pm", "--file", reply, "--duration-ms", "soon"), /--duration-ms/);
  assert.equal(usageLines(dir, "u5").length, 0);
  assert.equal(JSON.parse(await run(dir, "status", "--json")).turn, 0, "the turn was not recorded");
  await run(dir, "record", "--as", "pm", "--file", reply, "--tokens", "0");
  assert.equal(usageLines(dir, "u5")[0].reportedTokens, 0);
});

// discovery: two measured turns. build: a host turn that only has an orchestrator's number, and a skipped turn whose failed attempts still cost.
// wrapup: a turn with no token data at all.
const FIXTURE_LINES = [
  { turn: 1, member: "pm", role: "pm", phase: "discovery", iteration: 1, at: "t", source: "claude-cli", promptChars: 1000, replyChars: 50, tokens: { input: 10, cacheWrite: 100, cacheRead: 1000, output: 20 }, costUsd: 0.5, durationMs: 4000, modelCalls: 2 },
  { turn: 2, member: "user-garcia", role: "user", phase: "discovery", iteration: 1, at: "t", source: "claude-cli", promptChars: 2000, replyChars: 70, tokens: { input: 5, cacheWrite: 0, cacheRead: 2000, output: 30 }, costUsd: 0.25, durationMs: 1500, modelCalls: 1 },
  { turn: 3, member: "eng-backend", role: "engineer", phase: "build", iteration: 1, at: "t", source: "host", promptChars: 3000, replyChars: 90, reportedTokens: 500, durationMs: 2000 },
  { turn: 4, member: "eng-frontend", role: "engineer", phase: "build", iteration: 1, at: "t", source: "claude-cli", promptChars: 400, replyChars: 30, tokens: { input: 2, cacheRead: 300 }, costUsd: 0.125, durationMs: 900, modelCalls: 1, skipped: true },
  { turn: 5, member: "pm", role: "pm", phase: "wrapup", iteration: 1, at: "t", source: "mock", promptChars: 10, replyChars: 5 },
];

test("stats --json totals match the usage lines, per phase and per role", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "s1", "--brief", "x");
  fs.writeFileSync(usageFile(dir, "s1"), FIXTURE_LINES.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const stats = JSON.parse(await run(dir, "stats", "--json"));
  assert.equal(stats.session, "s1");
  assert.equal(stats.recorded, true);
  assert.deepEqual(stats.total, {
    turns: 5,
    skippedTurns: 1,
    promptChars: 6410,
    replyChars: 245,
    tokens: { input: 17, cacheWrite: 100, cacheRead: 3300, output: 50 },
    reportedTokens: { total: 500, turns: 1 },
    costUsd: 0.875,
    durationMs: 8400,
    modelCalls: 4,
    turnsWithoutMeasuredTokens: 2,
    turnsWithoutCost: 2,
  });
  assert.deepEqual(Object.keys(stats.byPhase), ["discovery", "build", "wrapup"]);
  assert.deepEqual(stats.byPhase.discovery, {
    turns: 2,
    skippedTurns: 0,
    promptChars: 3000,
    replyChars: 120,
    tokens: { input: 15, cacheWrite: 100, cacheRead: 3000, output: 50 },
    costUsd: 0.75,
    durationMs: 5500,
    modelCalls: 3,
    turnsWithoutMeasuredTokens: 0,
    turnsWithoutCost: 0,
  });
  assert.deepEqual(stats.byPhase.build, {
    turns: 2,
    skippedTurns: 1,
    promptChars: 3400,
    replyChars: 120,
    tokens: { input: 2, cacheRead: 300 },
    reportedTokens: { total: 500, turns: 1 },
    costUsd: 0.125,
    durationMs: 2900,
    modelCalls: 1,
    turnsWithoutMeasuredTokens: 1,
    turnsWithoutCost: 1,
  });
  // nothing was measured, so nothing is claimed: no zeros that look like measurements
  assert.deepEqual(stats.byPhase.wrapup, { turns: 1, skippedTurns: 0, promptChars: 10, replyChars: 5, turnsWithoutMeasuredTokens: 1, turnsWithoutCost: 1 });
  assert.deepEqual(Object.keys(stats.byRole), ["pm", "user", "engineer"]);
  assert.equal(stats.byRole.engineer.turns, 2);
  assert.equal(stats.byRole.engineer.skippedTurns, 1);
  assert.deepEqual(stats.byRole.engineer.reportedTokens, { total: 500, turns: 1 });
});

test("stats prints measured parts and the orchestrator's number apart, with no grand total of tokens", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "s2", "--brief", "x");
  fs.writeFileSync(usageFile(dir, "s2"), FIXTURE_LINES.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = await run(dir, "stats");
  const line = (label: string) => out.split("\n").find((l) => l.trimStart().startsWith(`${label}:`)) ?? assert.fail(`no line for ${label} in\n${out}`);
  assert.match(line("session s2"), /5 turns \(1 skipped\)/);
  assert.match(out, /by phase/);
  assert.match(out, /by role/);
  const discovery = line("discovery");
  assert.match(discovery, /input 15, cache write 100, cache read 3,000, output 50/);
  assert.match(discovery, /\$0\.7500/);
  assert.match(discovery, /3 model calls/);
  assert.match(discovery, /5\.5s/);
  assert.doesNotMatch(discovery, /reported by orchestrator/);
  const build = line("build");
  assert.match(build, /2 turns \(1 skipped\)/);
  assert.match(build, /input 2, cache read 300 \(on 1 of 2 turns\)/);
  assert.match(build, /reported by orchestrator: 500 over 1 turn/);
  assert.match(build, /\$0\.1250 \(on 1 of 2 turns\)/);
  assert.match(line("wrapup"), /tokens -.*cost -/);
  assert.doesNotMatch(out, /3,467|3,967|3,665/, "no sum of cache reads with the other parts, or with the orchestrator's number");
});

test("stats on a real mock run counts every turn", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "s3", "--brief", "x");
  await run(dir, "run", "--backend", "mock");
  const lines = usageLines(dir, "s3");
  const stats = JSON.parse(await run(dir, "stats", "--json"));
  assert.equal(stats.total.turns, lines.length);
  assert.equal(stats.total.turnsWithoutMeasuredTokens, lines.length);
  assert.equal(stats.total.turnsWithoutCost, lines.length);
  for (const key of ["tokens", "reportedTokens", "costUsd", "durationMs", "modelCalls"]) assert.ok(!(key in stats.total), `${key} is left out when nothing reported it`);
  assert.equal(stats.total.promptChars, lines.reduce((n, l) => n + l.promptChars!, 0));
  assert.equal(stats.total.replyChars, lines.reduce((n, l) => n + l.replyChars, 0));
  assert.equal(Object.values<{ turns: number }>(stats.byPhase).reduce((n, p) => n + p.turns, 0), lines.length);
  assert.equal(Object.values<{ turns: number }>(stats.byRole).reduce((n, r) => n + r.turns, 0), lines.length);
});

test("stats on a session saved before usage was recorded says so", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "old", "--brief", "x");
  assert.match(await run(dir, "stats"), /no usage recorded/i);
  assert.deepEqual(JSON.parse(await run(dir, "stats", "--json")), { session: "old", recorded: false });
});

/** Runs the mock backend with `respond` wrapped, so a test can add usage to a reply or fail an attempt. */
async function runWithBackend(
  dir: string,
  wrap: (
    p: { member: string },
    original: () => Promise<{ text: string; usage?: object }>,
    ctx: { state: { turn: number; phase?: string } },
  ) => Promise<{ text: string; usage?: object }>,
): Promise<string> {
  const { MockBackend } = await import("../src/backends/mock.ts");
  const orig = MockBackend.prototype.respond;
  MockBackend.prototype.respond = function (p, ctx) {
    return wrap(p, () => orig.call(this, p, ctx), ctx);
  };
  try {
    return await run(dir, "run", "--backend", "mock");
  } finally {
    MockBackend.prototype.respond = orig;
  }
}

test("auto mode records the usage a backend reports for each turn", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "r1", "--brief", "x");
  await runWithBackend(dir, async (_p, original) => ({
    ...(await original()),
    usage: { tokens: { input: 10, cacheRead: 100, output: 5 }, costUsd: 0.5, durationMs: 1000, modelCalls: 2 },
  }));
  const lines = usageLines(dir, "r1");
  assert.ok(lines.length > 0);
  for (const l of lines) {
    assert.deepEqual(l.tokens, { input: 10, cacheRead: 100, output: 5 }, `turn ${l.turn}`);
    assert.equal(l.costUsd, 0.5);
    assert.equal(l.durationMs, 1000);
    assert.equal(l.modelCalls, 2);
    assert.equal(l.skipped, undefined);
  }
  const { total } = JSON.parse(await run(dir, "stats", "--json"));
  const n = lines.length;
  assert.deepEqual(total.tokens, { input: 10 * n, cacheRead: 100 * n, output: 5 * n });
  assert.equal(total.costUsd, 0.5 * n);
  assert.equal(total.durationMs, 1000 * n);
  assert.equal(total.modelCalls, 2 * n);
  assert.equal(total.turnsWithoutCost, 0);
});

test("a turn that works on the retry records what both attempts cost", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "r2", "--brief", "x");
  let failed = false;
  const out = await runWithBackend(dir, async (p, original) => {
    if (p.member !== "pm") return original();
    if (!failed) {
      failed = true;
      throw new ReplyError("API Error: overloaded", { tokens: { input: 100, cacheRead: 1000 }, costUsd: 0.5, durationMs: 700, modelCalls: 1 });
    }
    return { ...(await original()), usage: { tokens: { input: 10, output: 5 }, costUsd: 0.25, durationMs: 300, modelCalls: 2 } };
  });
  assert.match(out, /retrying once/);
  const first = usageLines(dir, "r2")[0];
  assert.equal(first.member, "pm");
  assert.deepEqual(first.tokens, { input: 110, cacheRead: 1000, output: 5 });
  assert.equal(first.costUsd, 0.75);
  assert.equal(first.durationMs, 1000);
  assert.equal(first.modelCalls, 3);
  assert.equal(first.skipped, undefined);
  assert.ok(first.replyChars > "[SAY to=all] (could not attend this turn)".length, "the reply is the retry's, not the skip notice");
});

test("a skipped turn is marked, and keeps what its failed attempts cost", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "r3", "--brief", "x");
  const attempts = [
    { tokens: { input: 100, cacheRead: 1000 }, costUsd: 0.5, durationMs: 700, modelCalls: 1 },
    { tokens: { input: 50, output: 3 }, costUsd: 0.25, durationMs: 200, modelCalls: 2 },
  ];
  const out = await runWithBackend(dir, async (p, original) => {
    const usage = p.member === "user-yamada" ? attempts.shift() : undefined;
    if (usage) throw new ReplyError("API Error: flagged", usage);
    return original();
  });
  assert.match(out, /user-yamada skips this turn: API Error: flagged/);
  const lines = usageLines(dir, "r3");
  const skipped = lines.filter((l) => l.skipped);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].member, "user-yamada");
  assert.deepEqual(skipped[0].tokens, { input: 150, cacheRead: 1000, output: 3 });
  assert.equal(skipped[0].costUsd, 0.75);
  assert.equal(skipped[0].durationMs, 900);
  assert.equal(skipped[0].modelCalls, 3);
  const { total, byRole } = JSON.parse(await run(dir, "stats", "--json"));
  assert.equal(total.turns, lines.length);
  assert.equal(total.skippedTurns, 1);
  assert.equal(total.costUsd, 0.75, "the skipped turn's cost is in the total");
  assert.equal(byRole.user.skippedTurns, 1);
  assert.match(await run(dir, "stats"), /1 skipped/);
});

// A claude that never answers, so every turn runs into TEAM_TURN_TIMEOUT. `starts` gets one byte per start. TEAM_FAKE_FAIL_FIRST makes
// its first start fail the way an overloaded API does, with what that call cost.
const API_ERROR = JSON.stringify({
  type: "result",
  is_error: true,
  result: "API Error: overloaded",
  num_turns: 1,
  duration_ms: 700,
  total_cost_usd: 0.5,
  usage: { input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 0 },
});
const HANGING_CLAUDE = `#!/usr/bin/env node
if (process.argv[2] === "--warm") process.exit(0);
const fs = require("node:fs");
const starts = __dirname + "/starts";
const earlier = fs.existsSync(starts) ? fs.statSync(starts).size : 0;
fs.appendFileSync(starts, "x");
process.stdin.resume();
if (process.env.TEAM_FAKE_FAIL_FIRST && earlier === 0) {
  process.stdin.on("end", () => {
    process.stdout.write(${JSON.stringify(API_ERROR)});
    process.exitCode = 1;
  });
} else {
  setTimeout(() => {}, 30000); // ends by itself if a test is abandoned
}
`;
const timeoutTest = { skip: process.platform === "win32" && "the fake claude is a shebang script", timeout: 30_000 };

/** Runs the first turn of a new session (the PM's) against a claude that hangs, with a two second limit per turn. */
async function runWithHangingClaude(name: string, failFirst: boolean) {
  const dir = sandbox();
  await run(dir, "init", "--name", name, "--brief", "x");
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, HANGING_CLAUDE);
  fs.chmodSync(bin, 0o755);
  // The first run of a new executable is slow (macOS checks it first). Take that before the clock of a turn's timeout starts.
  execFileSync(bin, ["--warm"]);
  const env: Record<string, string | undefined> = {
    TEAM_CLAUDE_BIN: bin,
    TEAM_TURN_TIMEOUT: "2",
    CLAUDE_CONFIG_DIR: dir,
    TEAM_FAKE_FAIL_FIRST: failFirst ? "1" : undefined,
  };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const setEnv = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  setEnv(env);
  try {
    const out = await run(dir, "run", "--backend", "claude-cli", "--turns", "1");
    const starts = fs.existsSync(path.join(dir, "starts")) ? fs.statSync(path.join(dir, "starts")).size : 0;
    return { out, starts, lines: usageLines(dir, name) };
  } finally {
    setEnv(saved);
  }
}

test("a turn that times out is skipped without a retry, and its line keeps the time it took", timeoutTest, async () => {
  const { out, starts, lines } = await runWithHangingClaude("to1", false);
  assert.equal(starts, 1, "claude was started once: a hang is not tried again");
  assert.match(out, /pm skips this turn without a retry: claude turn timed out after 2 seconds/);
  assert.doesNotMatch(out, /retrying once/);
  assert.match(out, /could not attend this turn/);
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.equal(line.member, "pm");
  assert.equal(line.skipped, true);
  assert.ok(line.durationMs! >= 1900 && line.durationMs! < 10_000, `durationMs ${line.durationMs}`);
  assert.equal(line.tokens, undefined);
  assert.equal(line.costUsd, undefined);
  assert.equal(line.modelCalls, undefined);
});

test("a retry that times out is skipped with what the first attempt cost plus the time spent", timeoutTest, async () => {
  const { out, starts, lines } = await runWithHangingClaude("to2", true);
  assert.equal(starts, 2);
  assert.match(out, /pm's turn failed, retrying once: claude exited with 1: API Error: overloaded/);
  assert.match(out, /pm skips this turn: claude turn timed out after 2 seconds/);
  const [line] = lines;
  assert.equal(line.skipped, true);
  assert.deepEqual(line.tokens, { input: 100, cacheRead: 1000, output: 0 });
  assert.equal(line.costUsd, 0.5);
  assert.equal(line.modelCalls, 1);
  assert.ok(line.durationMs! >= 2600 && line.durationMs! < 10_000, `durationMs ${line.durationMs}: 700 ms of the first attempt, two seconds of the second`);
});

test("stats ignores a half-written last line of usage.jsonl, but not a damaged line before it", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "t1", "--brief", "x");
  const whole = JSON.stringify(FIXTURE_LINES[0]);
  fs.writeFileSync(usageFile(dir, "t1"), `${whole}\n{"turn":2,"member":"user-gar`);
  assert.equal(JSON.parse(await run(dir, "stats", "--json")).total.turns, 1);
  fs.writeFileSync(usageFile(dir, "t1"), `{"turn":1,"mem\n${whole}\n`);
  await assert.rejects(run(dir, "stats", "--json"), SyntaxError);
});

test("the transcript is still read strictly: a half-written last line is an error", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "t2", "--brief", "x");
  await run(dir, "next", "--json");
  fs.appendFileSync(path.join(dir, ".team/sessions/t2/transcript.jsonl"), '{"turn":1,"at":"t');
  await assert.rejects(run(dir, "log"), SyntaxError);
});

const stateOf = (dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, ".team/sessions", name, "state.json"), "utf8"));

/** Every file in a session's folder, by name, so a test can tell that a command left the session exactly as it was. */
function sessionFiles(dir: string, name: string): Record<string, string | null> {
  const folder = path.join(dir, ".team/sessions", name);
  return Object.fromEntries(fs.readdirSync(folder).map((n) => [n, fs.statSync(path.join(folder, n)).isFile() ? fs.readFileSync(path.join(folder, n), "utf8") : null]));
}

test("run stops before the first turn when the claude command is missing, and the session stays as it was", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "p1", "--brief", "x");
  const before = sessionFiles(dir, "p1");
  await withEnv({ TEAM_CLAUDE_BIN: path.join(dir, "no-such-claude") }, async () => {
    await assert.rejects(run(dir, "run", "--backend", "claude-cli"), (e: Error) => /no-such-claude/.test(e.message) && /TEAM_CLAUDE_BIN/.test(e.message) && /--backend mock/.test(e.message));
  });
  assert.deepEqual(sessionFiles(dir, "p1"), before);
  assert.equal(stateOf(dir, "p1").status, "running");
  assert.match(await run(dir, "run", "--backend", "mock"), /session is done/, "the same session runs once the backend works");
});

test("run stops before the first turn when ANTHROPIC_API_KEY is not set, and the session stays as it was", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "p2", "--brief", "x");
  const before = sessionFiles(dir, "p2");
  await withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
    await assert.rejects(run(dir, "run", "--backend", "anthropic"), /ANTHROPIC_API_KEY.*--backend claude-cli.*mock/s);
  });
  assert.deepEqual(sessionFiles(dir, "p2"), before);
});

test("run begins with the backend and the model it applies, and a finished session needs no working backend", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "m1", "--brief", "x");
  await withEnv({ TEAM_MODEL: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
    const first = (await run(dir, "run", "--backend", "mock")).split("\n")[0];
    assert.equal(first, "backend=mock model=default");
    const done = await run(dir, "run", "--backend", "anthropic", "--model", "m2");
    assert.equal(done.split("\n")[0], "backend=anthropic model=m2");
    assert.match(done, /session is done/);
  });
  // the environment variable wins over --model, as it does in the backend: the line shows what is really used
  await withEnv({ TEAM_MODEL: "m3", ANTHROPIC_API_KEY: undefined }, async () => {
    assert.equal((await run(dir, "run", "--backend", "anthropic", "--model", "m2")).split("\n")[0], "backend=anthropic model=m3");
  });
});

const flagged = (costUsd = 0.25) => Promise.reject(new ReplyError("API Error: flagged", { costUsd }));

test("three steps in a row in which everyone skips stop the run; the third is only counted in usage.jsonl", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "k1", "--brief", "x");
  await assert.rejects(runWithBackend(dir, () => flagged()), /last 3 turns.*API Error: flagged.*not recorded.*team run/s);

  const state = stateOf(dir, "k1");
  assert.equal(state.status, "running", "a stopped session can still be continued");
  assert.equal(state.turn, 2, "two skipped turns were recorded, the third step was not");
  assert.equal(state.pending.length, 1);
  assert.equal(logged(dir, "k1").filter((e) => /could not attend this turn/.test(e.text)).length, 2);

  const lines = usageLines(dir, "k1");
  assert.equal(lines.length, 3);
  for (const l of lines) {
    assert.equal(l.skipped, true);
    assert.equal(l.costUsd, 0.5, "both attempts of every skipped turn are paid for in usage.jsonl");
  }
  assert.equal(lines[2].member, state.pending[0], "the unrecorded turn is the one still pending");
  assert.deepEqual(lines.map((l) => l.turn), [1, 2, 3], "the unrecorded turn is numbered as it will be once it is recorded");
  const { total } = JSON.parse(await run(dir, "stats", "--json"));
  assert.equal(total.skippedTurns, 3);
  assert.equal(total.costUsd, 1.5);
  const status = JSON.parse(await run(dir, "status", "--json"));
  assert.equal(status.status, "running");
  assert.deepEqual(status.pending, state.pending);

  assert.match(await run(dir, "run", "--backend", "mock"), /session is done/, "run goes on from where it stopped");
  assert.equal(stateOf(dir, "k1").status, "done");
});

/** Gives the sandbox one phase in which all five members speak at once, for `maxRounds` steps. */
function useOneParallelPhase(dir: string, maxRounds: number, extra: object = {}): void {
  const config = JSON.parse(fs.readFileSync(path.join(dir, "team.config.json"), "utf8"));
  config.phases = [{ id: "discovery", goal: "g", speakers: ["pm", "engineer", "user"], mode: "parallel", maxRounds, ...extra }];
  fs.writeFileSync(path.join(dir, "team.config.json"), JSON.stringify(config));
}

test("a step where everyone skips counts one per member, and stopping on the first step still saves what ran before it", async () => {
  const dir = sandbox();
  useOneParallelPhase(dir, 2, { trial: true }); // the runtime's trial run comes before the step
  await run(dir, "init", "--name", "k2", "--brief", "x");
  await assert.rejects(runWithBackend(dir, () => flagged()), /last 5 turns/);

  const state = stateOf(dir, "k2");
  assert.equal(state.turn, 0, "nothing of the step was recorded");
  assert.deepEqual([...state.pending].sort(), ["eng-backend", "eng-frontend", "pm", "user-garcia", "user-yamada"]);
  assert.equal(state.trials.length, 1, "the trial that ran just before the step was saved");
  assert.ok(logged(dir, "k2").some((e) => /No verification command/.test(e.text)));
  assert.ok(!logged(dir, "k2").some((e) => /could not attend/.test(e.text)));
  const lines = usageLines(dir, "k2");
  assert.deepEqual(lines.map((l) => [l.member, l.turn]), state.pending.map((member: string, i: number) => [member, i + 1]), "numbered as they will be once recorded");
  assert.ok(lines.every((l) => l.skipped && l.phase === "discovery" && l.iteration === 1));
});

test("a step with any reply that is not a skip clears the count, so skips that are not in a row never stop the run", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "k3", "--brief", "x");
  // steps 0 and 1 skip, 2 answers, 3 and 4 skip, 5 answers: four skips, never three in a row
  const failing = new Set([0, 1, 3, 4]);
  const out = await runWithBackend(dir, (_p, original, ctx) => (failing.has(ctx.state.turn) ? flagged() : original()));
  assert.match(out, /session is done/);
  assert.equal(usageLines(dir, "k3").filter((l) => l.skipped).length, 4);
});

test("a member who fails every time never stops the run: steps in which the others answer clear the count", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "k4", "--brief", "x");
  const out = await runWithBackend(dir, (p, original) => (p.member === "eng-backend" ? flagged() : original()));
  assert.match(out, /eng-backend skips this turn/);
  assert.match(out, /session is done/);
  const skipped = usageLines(dir, "k4").filter((l) => l.skipped);
  assert.ok(skipped.length > 0);
  assert.ok(skipped.every((l) => l.member === "eng-backend"));
  assert.ok(usageLines(dir, "k4").some((l) => l.phase === "build" && l.member === "eng-frontend" && !l.skipped), "the other engineer's build turn was recorded as usual");
});

test("a step in which only some members are skipped is recorded in full and adds nothing to the count", async () => {
  const dir = sandbox();
  useOneParallelPhase(dir, 3);
  await run(dir, "init", "--name", "k5", "--brief", "x");
  const out = await runWithBackend(dir, (p, original) => (p.member === "eng-backend" ? flagged() : original()));
  assert.match(out, /session is done/);
  const lines = usageLines(dir, "k5");
  const skipped = lines.filter((l) => l.skipped);
  assert.ok(skipped.length >= 3, "more skips than the limit, each in a step where the other members answered");
  assert.ok(skipped.every((l) => l.member === "eng-backend"));
  assert.equal(stateOf(dir, "k5").turn, lines.length, "every reply of every step was recorded");
  assert.equal(logged(dir, "k5").filter((e) => /could not attend this turn/.test(e.text)).length, skipped.length, "the skips were recorded like any reply");
});

// Input validation and `init --force`

const mainFile = path.join(repo, "src/main.ts");

/** The real command line, for what only a process has: stdin that is empty, the exit code and what goes to stderr. */
function cli(dir: string, input: string, ...args: string[]) {
  return spawnSync(process.execPath, [mainFile, ...args, "--root", dir], { input, encoding: "utf8" });
}

/** Like `run`, but also returns what the command warned about (stderr), which `main` hands to its third argument. */
async function runWarn(dir: string, ...args: string[]): Promise<{ out: string; warnings: string[] }> {
  const out: string[] = [];
  const warnings: string[] = [];
  await main([...args, "--root", dir], (s) => out.push(s), (s) => warnings.push(s));
  return { out: out.join("\n"), warnings };
}

/** A copy of the sandbox's config with `patch` applied, written to `file` inside the sandbox. */
function writeConfig(dir: string, file: string, patch: Record<string, unknown>): string {
  const cfg = { ...JSON.parse(fs.readFileSync(path.join(dir, "team.config.json"), "utf8")), ...patch };
  fs.writeFileSync(path.join(dir, file), JSON.stringify(cfg));
  return file;
}

const SKIP_REPLY = "[SAY to=all] (could not attend this turn)";

test("run --turns and log --tail reject anything but a whole number, with the reason, before touching the session", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "v1", "--brief", "x");
  const before = sessionFiles(dir, "v1");
  // the `=` form, because parseArgs would take "-1" for another option
  for (const bad of ["abc", "-1", "1.5", "", "1e3"]) {
    await assert.rejects(run(dir, "run", "--backend", "mock", `--turns=${bad}`), /--turns must be a whole number of 0 or more/);
    await assert.rejects(run(dir, "log", `--tail=${bad}`), /--tail must be a whole number of 0 or more/);
  }
  assert.deepEqual(sessionFiles(dir, "v1"), before);
  assert.equal((await run(dir, "log", "--tail", "1")).split("\n").length, 1);
  assert.ok((await run(dir, "log", "--tail", "0")).split("\n").length > 1, "0 still means the whole log");
});

test("record refuses an empty or whitespace-only reply, even with --force, and records nothing", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "e1", "--brief", "x");
  await run(dir, "next", "--json");
  const before = sessionFiles(dir, "e1");
  for (const text of ["", "  \n\t\n"]) {
    for (const extra of [[], ["--force"]]) {
      await assert.rejects(
        run(dir, "record", "--as", "pm", "--file", writeReply(dir, text), ...extra),
        (e: Error) => /empty/.test(e.message) && /stdin or with --file/.test(e.message) && e.message.includes(SKIP_REPLY),
        `${JSON.stringify(text)} ${extra.join(" ")}`,
      );
    }
  }
  assert.deepEqual(sessionFiles(dir, "e1"), before);
  assert.equal(usageLines(dir, "e1").length, 0);
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, SKIP_REPLY));
  assert.equal(stateOf(dir, "e1").turn, 1, "the skip notice the error asks for can be recorded");
});

test("record and say with nothing on stdin exit 1 with a reason and change nothing", () => {
  const dir = sandbox();
  cli(dir, "", "init", "--name", "e2", "--brief", "x");
  const before = sessionFiles(dir, "e2");
  const recorded = cli(dir, "", "record", "--as", "pm");
  assert.equal(recorded.status, 1);
  assert.match(recorded.stderr, /empty.*stdin or with --file.*could not attend this turn/s);
  assert.equal(cli(dir, " \n", "record", "--as", "pm").status, 1);
  for (const input of ["", " \n"]) {
    const said = cli(dir, input, "say");
    assert.equal(said.status, 1);
    assert.match(said.stderr, /no text given/);
  }
  assert.equal(cli(dir, "", "say", "  ").status, 1);
  assert.deepEqual(sessionFiles(dir, "e2"), before);
  assert.equal(JSON.parse(cli(dir, "", "status", "--json").stdout).turn, 0);

  assert.equal(cli(dir, "予算は月1万円です", "say").status, 0, "text on stdin is still accepted");
  assert.match(cli(dir, "", "log").stdout, /human: 予算は月1万円です/);
});

test("run treats an empty reply from the backend as a failed attempt: it is retried, then skipped, and never recorded as a reply", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "e3", "--brief", "x");
  const out = await runWithBackend(dir, (p, original) => (p.member === "user-yamada" ? Promise.resolve({ text: " \n\t", usage: { costUsd: 0.25 } }) : original()));
  assert.match(out, /user-yamada's turn failed, retrying once: .*empty reply/);
  assert.match(out, /user-yamada skips this turn: .*empty reply/);
  assert.match(out, /session is done/);
  const skipped = usageLines(dir, "e3").filter((l) => l.skipped);
  assert.ok(skipped.length > 0);
  for (const l of skipped) {
    assert.equal(l.member, "user-yamada");
    assert.equal(l.costUsd, 0.5, "both empty attempts are paid for");
    assert.equal(l.replyChars, SKIP_REPLY.length, "the turn holds the skip notice, not the empty text");
  }
  assert.equal(logged(dir, "e3").filter((e) => e.from === "user-yamada" && e.text.includes("could not attend this turn")).length, skipped.length);
});

test("an empty reply followed by a real one on the retry is recorded, and both attempts are paid for", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "e4", "--brief", "x");
  let first = true;
  const out = await runWithBackend(dir, async (p, original) => {
    if (p.member === "pm" && first) {
      first = false;
      return { text: "", usage: { tokens: { input: 100 }, costUsd: 0.5 } };
    }
    return original();
  });
  assert.match(out, /retrying once: .*empty reply/);
  assert.doesNotMatch(out, /skips this turn/);
  const [line] = usageLines(dir, "e4");
  assert.equal(line.member, "pm");
  assert.equal(line.skipped, undefined);
  assert.equal(line.costUsd, 0.5);
  assert.deepEqual(line.tokens, { input: 100 });
  assert.ok(line.replyChars > SKIP_REPLY.length, "the reply is the retry's");
});

test("a backend that only returns empty replies stops the run like any other failure, naming the empty reply", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "e5", "--brief", "x");
  await assert.rejects(runWithBackend(dir, () => Promise.resolve({ text: "" })), /last 3 turns.*empty reply.*not recorded.*team run/s);
  const state = stateOf(dir, "e5");
  assert.equal(state.status, "running");
  assert.equal(state.turn, 2, "two skipped turns were recorded, the third step was not");
  assert.equal(usageLines(dir, "e5").length, 3);
  assert.match(await run(dir, "run", "--backend", "mock"), /session is done/);
});

test("init --force with input that cannot be read leaves the existing session exactly as it was", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "b1", "--brief", "first");
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, "[SAY to=all] 前の会話です"));
  const before = sessionFiles(dir, "b1");
  const current = fs.readFileSync(path.join(dir, ".team/current"), "utf8");
  fs.writeFileSync(path.join(dir, "personas/broken.json"), "{ not json");
  fs.writeFileSync(path.join(dir, "personas/nameless.json"), JSON.stringify({ id: "x", role: "pm", persona: {} }));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "team.config.json"), "utf8"));
  const withMember = (file: string) => ({ members: [...cfg.members, file] });
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["a persona that is not JSON", withMember("personas/broken.json"), /broken\.json: .*JSON/],
    ["a persona without a name", withMember("personas/nameless.json"), /needs "id", "role" and "persona.name"/],
    ["a persona file that is missing", withMember("personas/missing.json"), /persona not found/],
    ["the same member twice", { members: [cfg.members[0], cfg.members[0]] }, /duplicate member id/],
    ["no phases", { phases: [] }, /at least one phase/],
  ];
  for (const [label, patch, error] of cases) {
    const config = writeConfig(dir, "broken.config.json", patch);
    await assert.rejects(run(dir, "init", "--name", "b1", "--brief", "second", "--force", "--config", config), error, label);
    assert.deepEqual(sessionFiles(dir, "b1"), before, label);
    assert.equal(fs.readFileSync(path.join(dir, ".team/current"), "utf8"), current, label);
  }
  assert.equal(stateOf(dir, "b1").brief, "first");
  assert.match(await run(dir, "log"), /前の会話です/);
});

test("init --force replaces the session once everything has been read: the old transcript and usage are gone", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "n1", "--brief", "first");
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, "[SAY to=all] 前の会話です"));
  assert.equal(usageLines(dir, "n1").length, 1);
  await run(dir, "init", "--name", "n1", "--brief", "second", "--force");
  const state = stateOf(dir, "n1");
  assert.equal(state.brief, "second");
  assert.equal(state.turn, 0);
  assert.equal(usageLines(dir, "n1").length, 0);
  assert.doesNotMatch(await run(dir, "log"), /前の会話です/);
});

test("init --force warns about files left in workspace/<name>/, and deletes none of them", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "w1", "--brief", "x");
  const old = path.join(dir, "workspace/w1/old.txt");
  fs.writeFileSync(old, "old");
  const { out, warnings } = await runWarn(dir, "init", "--name", "w1", "--brief", "x", "--force");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /workspace\/w1/);
  assert.match(warnings[0], /new team will see them/);
  assert.match(warnings[0], /delete .* yourself/i);
  assert.doesNotMatch(out, /warning/, "warnings are not part of stdout");
  assert.equal(fs.readFileSync(old, "utf8"), "old");

  fs.rmSync(old);
  assert.deepEqual((await runWarn(dir, "init", "--name", "w1", "--brief", "x", "--force")).warnings, [], "an empty folder is nothing to warn about");
  assert.deepEqual((await runWarn(dir, "init", "--name", "w9", "--brief", "x", "--force")).warnings, [], "no folder yet");
});

test("init --force with --workspace does not warn about the files already in the codebase", async () => {
  const dir = sandbox();
  fs.mkdirSync(path.join(dir, "app"));
  fs.writeFileSync(path.join(dir, "app/index.ts"), "// existing code");
  await run(dir, "init", "--name", "w2", "--brief", "x", "--workspace", "app");
  assert.deepEqual((await runWarn(dir, "init", "--name", "w2", "--brief", "x", "--workspace", "app", "--force")).warnings, []);
  assert.equal(fs.readFileSync(path.join(dir, "app/index.ts"), "utf8"), "// existing code");
});

test("init --force --json keeps stdout parseable when it has something to warn about", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "w3", "--brief", "x");
  fs.writeFileSync(path.join(dir, "workspace/w3/old.txt"), "old");
  const { out, warnings } = await runWarn(dir, "init", "--name", "w3", "--brief", "x", "--force", "--json");
  assert.equal(JSON.parse(out).pending[0].member, "pm");
  assert.equal(warnings.length, 1);
});

test("init warns, but still creates the session, when a phase lists a role that no member has", async () => {
  const dir = sandbox();
  const config = writeConfig(dir, "tiny.config.json", {
    members: ["personas/pm-sato.json", "personas/user-yamada.json"],
    phases: [
      { id: "discovery", goal: "g", speakers: ["pm", "user"], mode: "round-robin", maxRounds: 1 },
      { id: "build", goal: "g", speakers: ["engineer", "designer", "pm"], mode: "parallel", maxRounds: 1 },
      { id: "review", goal: "g", speakers: ["engineer", "pm"], mode: "round-robin", maxRounds: 1 },
    ],
  });
  const { warnings } = await runWarn(dir, "init", "--name", "p1", "--brief", "x", "--config", config);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /no member has the role "engineer".*: build, review\./, "one warning per role, naming every phase");
  assert.match(warnings[1], /no member has the role "designer".*: build\./);
  assert.equal(stateOf(dir, "p1").status, "running");
  assert.deepEqual((await runWarn(dir, "init", "--name", "p2", "--brief", "x")).warnings, [], "the default team has every role");
});

test("a phase without speakers does not make init fail on the way to its warnings", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "p3", "--brief", "first");
  const config = writeConfig(dir, "nospeakers.config.json", {
    phases: [
      { id: "discovery", goal: "g", speakers: ["pm"], mode: "round-robin", maxRounds: 1 },
      { id: "later", goal: "g", mode: "round-robin", maxRounds: 1 },
    ],
  });
  const { warnings } = await runWarn(dir, "init", "--name", "p3", "--brief", "second", "--force", "--config", config);
  assert.deepEqual(warnings, []);
  assert.equal(stateOf(dir, "p3").brief, "second");
});

test("init on a name that exists says how to go on without deleting anything", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "d1", "--brief", "x");
  const before = sessionFiles(dir, "d1");
  await assert.rejects(
    run(dir, "init", "--name", "d1", "--brief", "again"),
    (e: Error) =>
      /session "d1" already exists/.test(e.message) &&
      /another --name/.test(e.message) &&
      /team use d1/.test(e.message) &&
      /--force.*everything saved.*\.team\/sessions\/d1\//.test(e.message),
  );
  assert.deepEqual(sessionFiles(dir, "d1"), before);
});

test("a folder without .team says which folder it looked in and what to do, and does not look further up", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "m1", "--brief", "x");
  const sub = path.join(dir, "sub");
  fs.mkdirSync(sub);
  const commands = [["status"], ["next", "--json"], ["log"], ["say", "hi"], ["status", "--session", "m1"], ["use", "m1"], ["sessions"]];
  for (const args of commands) {
    await assert.rejects(
      run(sub, ...args),
      (e: Error) => e.message.includes(sub) && /\.team/.test(e.message) && /--root/.test(e.message) && /team init/.test(e.message) && !/no session yet/.test(e.message),
      args.join(" "),
    );
  }
  assert.ok(!fs.existsSync(path.join(sub, ".team")), "nothing was created there");

  const fresh = sandbox();
  await assert.rejects(run(fresh, "status"), /no \.team folder/);
  await run(fresh, "init", "--name", "m2", "--brief", "x");
  assert.ok(fs.existsSync(path.join(fresh, ".team/sessions/m2/state.json")), "init still starts a new .team");
  assert.match(await run(fresh, "status"), /session: m2/);
});

test("errors name the next step: unknown session, use without a name, a name that is not allowed", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "n2", "--brief", "x");
  await assert.rejects(run(dir, "use", "nope"), /session not found: nope.*team sessions.*team init/s);
  await assert.rejects(run(dir, "status", "--session", "nope"), /session not found: nope.*team sessions.*team init/s);
  await assert.rejects(run(dir, "use"), /usage: team use <name>.*team sessions/s);
  assert.equal(fs.readFileSync(path.join(dir, ".team/current"), "utf8").trim(), "n2");

  await assert.rejects(
    run(dir, "init", "--name", "請求書", "--brief", "x"),
    /invalid session name: "請求書" \(use ASCII letters, digits, "_" and "-", which may be joined by single dots; not a Windows device name such as con, nul or com1\)/,
  );
});

/** Every file and folder under `dir`, with its content: equal before and after means a command changed nothing at all. */
function tree(dir: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, ent.name);
      const rel = path.relative(dir, f).split(path.sep).join("/");
      if (ent.isDirectory()) {
        out[rel + "/"] = null;
        walk(f);
      } else out[rel] = fs.readFileSync(f, "utf8");
    }
  };
  walk(dir);
  return out;
}

test("init refuses a session name that is not one plain folder name, and writes and deletes nothing", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "keep", "--brief", "x");
  const before = tree(dir);
  const bad = [".", "..", ".x", "x.", "a..b", "con", "NUL.txt", "Com1", "lpt9.x", "a b", "a/b", "請求書", ""];
  for (const name of bad) {
    for (const extra of [[], ["--force"]]) {
      await assert.rejects(run(dir, "init", "--name", name, "--brief", "x", ...extra), /invalid session name/, `${JSON.stringify(name)} ${extra.join(" ")}`);
      assert.deepEqual(tree(dir), before, `${JSON.stringify(name)} ${extra.join(" ")}`);
    }
  }
  for (const name of ["a.b", "villa-57", "abcXYZ019_-", "com10", "console", "a.con"]) {
    assert.match(await run(dir, "init", "--name", name, "--brief", "x"), new RegExp(`created session "${name.replace(".", "\\.")}"`), name);
    assert.ok(fs.existsSync(path.join(dir, ".team/sessions", name, "state.json")), name);
  }
});

test("a session name is checked wherever it becomes a path, including the folder trial runs delete", () => {
  assert.equal(artifactsDir("a.b"), ".team/sessions/a.b/artifacts");
  for (const bad of ["..", ".", "a/b", "x."]) assert.throws(() => artifactsDir(bad), /invalid session name/, bad);

  const dir = sandbox();
  fs.mkdirSync(path.join(dir, ".team"));
  fs.writeFileSync(path.join(dir, ".team/keep.txt"), "keep");
  const members = [{ id: "pm", role: "pm", persona: { name: "P" } }];
  const phases = [{ id: "acceptance", goal: "g", speakers: ["pm"], mode: "round-robin" as const, maxRounds: 1, trial: true }];
  const w = World.create({ name: "..", brief: "x", members, phases });
  w.state.verify = { command: "echo hi", by: "pm" };
  const before = tree(dir);
  assert.throws(() => runTrialIfDue(w, dir), /invalid session name/);
  assert.deepEqual(tree(dir), before);
});

test("sessions and the commands that compare sessions skip what is in .team/sessions but is not a session", async () => {
  const dir = sandbox();
  repoWithWorktrees(dir);
  await run(dir, "init", "--name", "a", "--brief", "A", "--workspace", "wt-a");
  await run(dir, "init", "--name", "b", "--brief", "B", "--workspace", "wt-b");
  const sessions = path.join(dir, ".team/sessions");
  fs.writeFileSync(path.join(sessions, ".DS_Store"), "x");
  for (const stray of ["a b", ".new-abc", "con", "x."]) fs.mkdirSync(path.join(sessions, stray));
  assert.deepEqual((await run(dir, "sessions")).split("\n").map((l) => l.trim().replace(/^\* /, "")).sort(), ["a", "b"]);
  assert.match(await run(dir, "status", "--session", "a"), /session: a/);
  assert.deepEqual(JSON.parse(await run(dir, "overlaps", "--json")).sessions.sort(), ["a", "b"]);
  assert.equal(JSON.parse(await run(dir, "next", "--json")).pending[0].member, "pm");
});

test("init --force whose new session cannot be written leaves the old one as it was, and nothing behind", async () => {
  const dir = sandbox();
  await run(dir, "init", "--name", "z1", "--brief", "first");
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, "[SAY to=all] 前の会話です"));
  const team = path.join(dir, ".team");
  const before = tree(team);
  // nothing checks a phase without an id, but the transcript cannot be rendered from it
  const config = writeConfig(dir, "noid.config.json", { phases: [{ speakers: ["pm"], mode: "round-robin", maxRounds: 1, goal: "g" }] });
  await assert.rejects(run(dir, "init", "--name", "z1", "--brief", "second", "--force", "--config", config));
  assert.deepEqual(tree(team), before, "the old session, current and the sessions folder are as they were");
  await assert.rejects(run(dir, "init", "--name", "z2", "--brief", "new", "--config", config));
  assert.deepEqual(tree(team), before, "a new name leaves nothing half written either");
  assert.match(await run(dir, "log"), /前の会話です/);
});

test("the verification command's start goes to the warning channel, so next --json and record --json stay parseable", async () => {
  const dir = sandbox();
  const config = writeConfig(dir, "trial.config.json", {
    phases: [
      { id: "review", goal: "g", speakers: ["engineer"], mode: "round-robin", maxRounds: 1 },
      { id: "acceptance", goal: "g", speakers: ["user"], mode: "round-robin", maxRounds: 1, trial: true },
    ],
  });
  await run(dir, "init", "--name", "t1", "--brief", "x", "--config", config);
  await run(dir, "record", "--as", "eng-backend", "--file", writeReply(dir, "[VERIFY] echo hi"));
  const { out, warnings } = await runWarn(dir, "record", "--as", "eng-frontend", "--file", writeReply(dir, "[SAY to=all] ok"), "--json");
  assert.deepEqual(warnings, ["running the team's verification command: echo hi"]);
  assert.equal(JSON.parse(out).phase, "acceptance");
});

test("a file that is not JSON is reported with its path, and the parser's error is kept as the cause", async () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, "personas/broken.json"), "{ not json");
  const config = writeConfig(dir, "broken.config.json", { members: ["personas/broken.json"] });
  await assert.rejects(
    run(dir, "init", "--name", "c1", "--brief", "x", "--config", config),
    (e: Error) => e.message.includes(path.join(dir, "personas/broken.json")) && e.cause instanceof SyntaxError,
  );
});

// continue: a finished session goes on for another iteration

/** A session the mock team has run to the end. */
async function finishedSession(dir: string, name: string): Promise<void> {
  await run(dir, "init", "割り勘CLI", "--name", name);
  await run(dir, "run", "--backend", "mock");
  assert.equal(stateOf(dir, name).status, "done");
}

const CONTINUE_HINT = /team continue/;

/** Puts the session's workspace in a known state, so a test does not depend on whether the mock team wrote files. */
function setWorkspace(dir: string, name: string, files: Record<string, string> | "missing"): string {
  const workspace = path.join(dir, "workspace", name);
  fs.rmSync(workspace, { recursive: true, force: true });
  if (files === "missing") return workspace;
  fs.mkdirSync(workspace, { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(workspace, file), text);
  return workspace;
}

test("a finished session refuses say, and continue with the words as an argument starts one more iteration in which the PM reads them", async () => {
  const dir = sandbox();
  await finishedSession(dir, "c1");
  setWorkspace(dir, "c1", { "app.js": "// built before\n" });
  const before = sessionFiles(dir, "c1");

  const said = cli(dir, "", "say", "x");
  assert.equal(said.status, 1);
  assert.match(said.stderr, /done.*team continue --say/s);
  assert.deepEqual(sessionFiles(dir, "c1"), before, "nothing was added to the transcript");

  const { out, warnings } = await runWarn(dir, "continue", "CSV 出力も欲しい");
  assert.match(out, /continued session "c1": iteration 2\/2 begins at phase "planning"/);
  assert.match(out, /next: .*\(pm\)/);
  assert.deepEqual(warnings, [], "the workspace has files");
  const state = stateOf(dir, "c1");
  assert.deepEqual([state.status, state.iteration, state.maxIterations], ["running", 2, 2]);
  const status = JSON.parse(await run(dir, "status", "--json"));
  assert.deepEqual([status.status, status.iteration, status.maxIterations, status.phase], ["running", 2, 2, "planning"]);

  const log = (await run(dir, "log")).split("\n");
  assert.match(log.at(-1)!, /^\[2:planning#\d+\] human: CSV 出力も欲しい$/);
  assert.match(log.at(-3)!, /^\[2:planning#\d+\] — Iteration 2 begins: the human continued the finished session\. PM: .*\[DECISION\]/);

  const pm = JSON.parse(await run(dir, "next", "--json", "--inline")).pending[0];
  assert.equal(pm.member, "pm");
  assert.match(pm.prompt, /CSV 出力も欲しい/);

  const ran = await run(dir, "run", "--backend", "mock");
  assert.match(ran, /session is done/);
  assert.match((await run(dir, "log", "--tail", "1")), /Session finished after iteration 2/);
  const after = stateOf(dir, "c1");
  assert.deepEqual(after.trials.map((t: { iteration: number }) => t.iteration), [1, 2]);
  const users = after.members.filter((m: { role: string }) => m.role === "user").length;
  assert.equal(after.verdicts.filter((v: { iteration: number }) => v.iteration === 2).length, users);
});

test("continue --json prints what next --json prints, and the warning stays out of it", async () => {
  const dir = sandbox();
  await finishedSession(dir, "c2");
  setWorkspace(dir, "c2", {});
  const { out, warnings } = await runWarn(dir, "continue", "--say", "CSV 出力も欲しい", "--json");
  const first = JSON.parse(out);
  assert.deepEqual(Object.keys(first), ["status", "phase", "iteration", "round", "openQuestions", "pending"]);
  assert.deepEqual([first.status, first.phase, first.iteration, first.round], ["running", "planning", 2, 1]);
  assert.equal(first.pending[0].member, "pm");
  assert.match(fs.readFileSync(path.join(dir, first.pending[0].promptFile), "utf8"), /CSV 出力も欲しい/);
  assert.equal(warnings.length, 1, "the empty workspace is warned about, on stderr");
  assert.deepEqual(JSON.parse(await run(dir, "next", "--json")), first, "a following next returns the same turn");
});

test("continue allows one more iteration by default, N more with --iterations, counted from the iteration it was on", async () => {
  const dir = sandbox();
  await finishedSession(dir, "c3");
  await runWarn(dir, "continue");
  assert.deepEqual([stateOf(dir, "c3").iteration, stateOf(dir, "c3").maxIterations], [2, 2]);
  assert.doesNotMatch(await run(dir, "log"), /human:/, "no words, no human message");
  await run(dir, "run", "--backend", "mock");
  assert.equal(stateOf(dir, "c3").status, "done");

  await runWarn(dir, "continue");
  assert.deepEqual([stateOf(dir, "c3").iteration, stateOf(dir, "c3").maxIterations], [3, 3]);
  await run(dir, "run", "--backend", "mock");
  await runWarn(dir, "continue", "--iterations", "2");
  assert.deepEqual([stateOf(dir, "c3").iteration, stateOf(dir, "c3").maxIterations], [4, 5], "iterations 4 and 5 were asked for");
});

test("continue on a session that is still running exits 1, says how to go on, and changes nothing", () => {
  const dir = sandbox();
  cli(dir, "", "init", "x", "--name", "c4");
  const before = sessionFiles(dir, "c4");
  const r = cli(dir, "", "continue");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not finished.*team next.*team run/s);
  assert.deepEqual(sessionFiles(dir, "c4"), before);
});

test("continue rejects a bad --iterations or an empty message before touching the finished session", async () => {
  const dir = sandbox();
  await finishedSession(dir, "c5");
  const before = sessionFiles(dir, "c5");
  // the `=` form, because parseArgs would take "-1" for another option
  for (const bad of ["0", "abc", "-1", "1.5", "", "1e3"]) {
    await assert.rejects(run(dir, "continue", `--iterations=${bad}`), /--iterations must be a whole number of 1 or more/, JSON.stringify(bad));
  }
  assert.equal(cli(dir, "", "continue", "--iterations=0").status, 1);
  for (const blank of ["", " ", " \n\t"]) {
    await assert.rejects(run(dir, "continue", `--say=${blank}`), /message for the team is empty/, JSON.stringify(blank));
    await assert.rejects(run(dir, "continue", blank), /message for the team is empty/, JSON.stringify(blank));
  }
  assert.deepEqual(sessionFiles(dir, "c5"), before);
  assert.equal(stateOf(dir, "c5").status, "done");
});

test("continue warns when the workspace is missing or empty and goes on, and stays quiet when it has files", async () => {
  const dir = sandbox();
  await finishedSession(dir, "c6");

  setWorkspace(dir, "c6", "missing");
  const missing = await runWarn(dir, "continue");
  assert.equal(missing.warnings.length, 1);
  assert.match(missing.warnings[0], /^warning: workspace\/c6 .*(does not exist|is empty).*will not see.*trial run.*fail/);
  assert.equal(stateOf(dir, "c6").status, "running", "it goes on regardless");

  await run(dir, "run", "--backend", "mock");
  setWorkspace(dir, "c6", {});
  assert.equal((await runWarn(dir, "continue")).warnings.length, 1, "an empty folder warns too");

  await run(dir, "run", "--backend", "mock");
  setWorkspace(dir, "c6", { "app.js": "// built before\n" });
  assert.deepEqual((await runWarn(dir, "continue")).warnings, []);
});

test("continue restarts at the iterationStart phase the session saved, or at the first one for an older session, and keeps the saved phases", async () => {
  const dir = sandbox();
  await finishedSession(dir, "c7");
  const file = path.join(dir, ".team/sessions/c7/state.json");
  const state = stateOf(dir, "c7");
  state.phases = state.phases.map((phase: Record<string, unknown>) => {
    const { iterationStart: _, ...rest } = phase;
    return rest.id === "discovery" ? { ...rest, maxRounds: 1 } : rest;
  });
  fs.writeFileSync(file, JSON.stringify(state));

  await runWarn(dir, "continue");
  const after = stateOf(dir, "c7");
  assert.equal(after.phases[after.phaseIndex].id, "discovery");
  assert.deepEqual(after.phases, state.phases, "the phases saved with the session are used as they are");
  assert.equal(after.phases[0].maxRounds, 1);
});

test("answer on a finished session says that continue is what makes the team act on it; on a running one it only says ok", async () => {
  const dir = sandbox();
  await finishedSession(dir, "c8");
  askInState(dir, "c8");
  const out = await run(dir, "answer", "Q1", "Yes, publish it.");
  assert.match(out, /^ok\n/);
  assert.match(out, CONTINUE_HINT);
  assert.equal(out.split("\n").length, 2, "one added line");

  await run(dir, "init", "x", "--name", "c9");
  await run(dir, "record", "--as", "pm", "--file", writeReply(dir, "[ASK_HUMAN] Which one? Default: A."));
  assert.equal(await run(dir, "answer", "Q1", "B"), "ok");
});

test("run, next and the record that ends a session point to continue, in text output only", async () => {
  const dir = sandbox();
  await finishedSession(dir, "d1");
  const total = stateOf(dir, "d1").turn;

  const again = await run(dir, "run", "--backend", "mock");
  assert.match(again, /session is done\./);
  assert.match(again.split("\n").slice(-2).join("\n"), CONTINUE_HINT);
  assert.match(await run(dir, "next"), /^session is done\. See: team log \/ team status\n.*team continue/);
  assert.doesNotMatch(await run(dir, "next", "--json"), /continue/);

  await run(dir, "init", "割り勘CLI", "--name", "d2");
  await run(dir, "run", "--backend", "mock", "--turns", String(total - 1));
  assert.equal(stateOf(dir, "d2").status, "running");
  const last = JSON.parse(await run(dir, "next", "--json")).pending[0].member;
  const recorded = await run(dir, "record", "--as", last, "--file", writeReply(dir, "[SAY to=all] done"));
  assert.match(recorded, /session is done\./);
  assert.match(recorded, CONTINUE_HINT);
});

test("the help lists continue with its options", async () => {
  const help = await run(sandbox(), "help");
  assert.match(help, /continue \[<text> \| --say <text>\] \[--iterations N\] \[--json\]/);
});

test("continue takes the words as arguments or with --say, and refuses both without touching the session", async () => {
  const dir = sandbox();
  await finishedSession(dir, "p1");
  setWorkspace(dir, "p1", { "app.js": "// built before\n" });
  const before = sessionFiles(dir, "p1");

  const both = cli(dir, "", "continue", "a", "--say", "b");
  assert.equal(both.status, 1);
  assert.match(both.stderr, /either as arguments or with --say, not both/);
  assert.deepEqual(sessionFiles(dir, "p1"), before);

  // the command's words are not dropped, whichever side of --session they are on, and several arguments make one message
  const noted = await runWarn(dir, "continue", "--session", "p1", "CSV", "も欲しい");
  assert.deepEqual(noted.warnings, []);
  assert.match(await run(dir, "log", "--tail", "1"), /^\[2:planning#\d+\] human: CSV も欲しい$/);

  await run(dir, "run", "--backend", "mock");
  await runWarn(dir, "continue", "--say", "CSV も欲しい");
  assert.match(await run(dir, "log", "--tail", "1"), /^\[3:planning#\d+\] human: CSV も欲しい$/, "--say says the same thing");
});

test("continue without words says in the log that the human did not say what to change", async () => {
  const dir = sandbox();
  await finishedSession(dir, "n1");
  setWorkspace(dir, "n1", { "app.js": "// built before\n" });
  await runWarn(dir, "continue");
  const log = (await run(dir, "log", "--tail", "3")).split("\n");
  assert.match(log[1], /Iteration 2 begins: the human continued the finished session without saying what to change\. PM: choose the next improvement yourself/);
  assert.doesNotMatch(log.join("\n"), /human:/);
});

test("continue names the session in what to run next when it is not the current one, and only then", async () => {
  const dir = sandbox();
  await finishedSession(dir, "s1");
  await finishedSession(dir, "s2"); // init makes the newest session current
  for (const name of ["s1", "s2"]) setWorkspace(dir, name, { "app.js": "// built before\n" });

  const other = await runWarn(dir, "continue", "--session", "s1");
  assert.match(other.out, /Go on with: team next --session s1 \(host mode\) or team run --session s1 \(auto mode\)/);
  const finishedOther = await run(dir, "run", "--session", "s1", "--backend", "mock");
  assert.match(finishedOther, /team continue --session s1 \[--iterations N\]/, "the done hint reaches s1, not the current session");

  const current = await runWarn(dir, "continue");
  assert.doesNotMatch(current.out, /--session/);
  const finishedCurrent = await run(dir, "run", "--backend", "mock");
  assert.doesNotMatch(finishedCurrent, /--session/);
  assert.match(finishedCurrent, CONTINUE_HINT);
  const named = await runWarn(dir, "continue", "--session", "s2");
  assert.doesNotMatch(named.out, /--session/, "naming the current session adds nothing");
});

test("an answer given after the session ended is in the answered section of the PM's prompt once the session is continued", async () => {
  const dir = sandbox();
  await finishedSession(dir, "a9");
  setWorkspace(dir, "a9", { "app.js": "// built before\n" });
  askInState(dir, "a9");
  await run(dir, "answer", "Q1", "Yes, publish it.");
  await runWarn(dir, "continue");
  const pm = JSON.parse(await run(dir, "next", "--json", "--inline")).pending[0];
  assert.equal(pm.member, "pm");
  assert.match(section(pm.prompt, ANSWERED), /- Q1 .*May we publish[\s\S]*Yes, publish it\./);
  assert.equal(section(pm.prompt, OPEN), "");
});
