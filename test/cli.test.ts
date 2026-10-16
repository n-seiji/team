import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
