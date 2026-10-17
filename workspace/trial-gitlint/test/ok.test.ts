import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hookScript } from "../src/install-hook.ts";

const MAIN = resolve(import.meta.dirname, "../src/main.ts");

function repo(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "cc-ok-")), "repo");
  spawnSync("git", ["init", "-q", dir]);
  return dir;
}

test("手で check を打って OK のときは ✓ を1行出す", () => {
  const r = spawnSync("node", [MAIN, "check", "fix: x"], { cwd: repo(), encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "✓ 問題ありません\n");
  assert.equal(r.stderr, "");
  // --json は今までどおり
  const j = spawnSync("node", [MAIN, "check", "--json", "fix: x"], { cwd: repo(), encoding: "utf8" });
  assert.equal(j.stdout.trim(), JSON.stringify({ ok: true, problems: [], suggestions: [] }));
});

test("フック経由で OK のときは何も出さない", () => {
  const dir = repo();
  const file = join(dir, ".git/hooks/commit-msg");
  writeFileSync(file, hookScript(MAIN));
  chmodSync(file, 0o755);
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-q", "-m", "fix: x"], {
    encoding: "utf8",
    env: { ...process.env, COMMITCHECK_TTY: "/nonexistent" },
    stdin: "ignore",
  } as never);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout + r.stderr, /✓|問題ありません/);
});
