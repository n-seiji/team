import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { main } from "../src/cli.ts";
import { Store } from "../src/store.ts";
import { ReplyError } from "../src/usage.ts";

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
  wrap: (p: { member: string }, original: () => Promise<{ text: string; usage?: object }>) => Promise<{ text: string; usage?: object }>,
): Promise<string> {
  const { MockBackend } = await import("../src/backends/mock.ts");
  const orig = MockBackend.prototype.respond;
  MockBackend.prototype.respond = function (p, ctx) {
    return wrap(p, () => orig.call(this, p, ctx));
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
