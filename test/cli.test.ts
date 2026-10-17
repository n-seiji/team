import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { main } from "../src/cli.ts";

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
  for (let i = 0; next.phase !== "acceptance" && i < 20; i++) {
    await run(dir, "run", "--backend", "mock", "--turns", "1");
    next = JSON.parse(await run(dir, "next", "--json", "--inline"));
  }
  assert.equal(next.phase, "acceptance");
  assert.equal(next.pending[0].role, "user");
  assert.match(next.pending[0].prompt, /## Demos shown by the team/);
  assert.match(next.pending[0].prompt, /T1: README の手順で実行すると/);
  assert.equal(JSON.parse(await run(dir, "status", "--json")).phase, "acceptance");
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
