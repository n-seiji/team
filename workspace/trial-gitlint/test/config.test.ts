import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadStyle, ConfigError } from "../src/config.ts";

const MAIN = join(import.meta.dirname, "..", "src", "main.ts");

function repo(rules?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gitlint-"));
  mkdirSync(join(dir, ".git"));
  if (rules !== undefined) writeFileSync(join(dir, ".commitrules.json"), rules);
  return dir;
}
function run(cwd: string, ...args: string[]) {
  return spawnSync("node", [MAIN, ...args], { cwd, encoding: "utf8" });
}

test("設定なし → conventional", () => {
  assert.equal(loadStyle(repo()), "conventional");
});
test("free を読む / サブディレクトリからも見つかる", () => {
  const dir = repo('{"style":"free"}');
  mkdirSync(join(dir, "a", "b"), { recursive: true });
  assert.equal(loadStyle(join(dir, "a", "b")), "free");
});
test("壊れた JSON → ConfigError", () => {
  assert.throws(() => loadStyle(repo("{oops")), (e: Error) =>
    e instanceof ConfigError && e.message.startsWith(".commitrules.json を読めません: "));
});
test("不正な style → ConfigError", () => {
  assert.throws(() => loadStyle(repo('{"style":"strict"}')), ConfigError);
  assert.throws(() => loadStyle(repo("[]")), ConfigError);
});

test("CLI: 終了コード 0 / 1 / 2", () => {
  const dir = repo();
  assert.equal(run(dir, "check", "feat: a").status, 0);
  assert.equal(run(dir, "check", "fix").status, 1);
  assert.equal(run(dir, "check").status, 2);
  assert.equal(run(dir, "bogus").status, 2);
});
test("CLI: free は 1 語で警告、終了コード 0", () => {
  const dir = repo('{"style":"free"}');
  const ok = run(dir, "check", "ログイン画面を直した");
  assert.equal(ok.status, 0);
  const warn = run(dir, "check", "wip");
  assert.equal(warn.status, 0);
  assert.notEqual(warn.stderr, "");
});
test("CLI: 壊れた設定は終了コード 2 で理由を表示", () => {
  const r = run(repo("{oops"), "check", "feat: a");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^\.commitrules\.json を読めません: /);
  assert.equal(run(repo('{"style":"x"}'), "check", "--json", "feat: a").status, 2);
});
test("CLI: --json の形", () => {
  const r = run(repo(), "check", "--json", "fix");
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j), ["ok", "problems", "suggestions"]);
  assert.deepEqual(Object.keys(j.problems[0]), ["where", "why"]);
});
test("CLI: init で作れて、最後に共有の案内が出る", () => {
  const dir = repo();
  const r = run(dir, "init", "--style", "free");
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, ".commitrules.json"), "utf8")), { style: "free" });
  assert.match(r.stdout.trim().split("\n").at(-1)!, /このファイルをコミットすると、チーム全員に同じルールが伝わります/);
  assert.equal(run(dir, "init", "--style", "x").status, 2);
  assert.equal(run(dir, "init").status, 2);
});
test("CLI: init は既存の設定を上書きせず 1 で止まる", () => {
  const dir = repo('{"style":"conventional"}');
  const r = run(dir, "init", "--style", "free");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /すでに \.commitrules\.json があります。上書きするには --force を付けてください/);
  assert.equal(readFileSync(join(dir, ".commitrules.json"), "utf8"), '{"style":"conventional"}');
});
test("CLI: init --force なら上書きし、最後に共有の案内が出る", () => {
  const dir = repo('{"style":"conventional"}');
  const r = run(dir, "init", "--style", "free", "--force");
  assert.equal(r.status, 0);
  assert.equal(loadStyle(dir), "free");
  assert.match(r.stdout.trim().split("\n").at(-1)!, /このファイルをコミットすると、チーム全員に同じルールが伝わります/);
});
test("CLI: init は git リポジトリの外では 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "gitlint-nogit-"));
  assert.equal(run(dir, "init", "--style", "free").status, 2);
});
