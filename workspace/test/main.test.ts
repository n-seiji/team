import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, HELP } from "../src/main.ts";

function env(answers: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "inv-"));
  const out: string[] = [], err: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s), ask: async () => answers.shift() ?? "", cwd: dir };
  return { dir, out, err, io, home: join(dir, "home") };
}

test("ヘルプは1画面(24行)に収まり、最初は init と書いてある", () => {
  assert.ok(HELP.split("\n").length <= 24);
  assert.match(HELP.split("\n")[2], /invoice init/);
});

test("未登録クライアントは次の一手を案内する", async () => {
  const e = env(["事務所", ""]);
  await run(["init"], e.io, e.home);
  assert.equal(await run(["new", "X社", "--item", "a:100"], e.io, e.home), 1);
  assert.match(e.err[0], /client add X社/);
});

test("Enterだけなら保存せず番号も使わない。yで INV-0001", async () => {
  const e = env(["事務所", ""]);
  await run(["init"], e.io, e.home);
  await run(["client", "add", "A社"], e.io, e.home);
  const args = ["new", "A社", "--month", "2026-09", "--item", "顧問料:50000"];
  e.io.ask = async () => "";
  await run(args, e.io, e.home);
  assert.ok(!existsSync(join(e.dir, "INV-0001.md")));
  e.io.ask = async () => "y";
  await run(args, e.io, e.home);
  assert.match(readFileSync(join(e.dir, "INV-0001.md"), "utf8"), /ご請求額: ¥55,000/);
});

test("入力が閉じられても明細の対話は無限ループしない", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "inv-"));
  const out: string[] = [], err: string[] = [];
  const answers = ["me", "", "", "", ""];
  const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s), ask: async () => answers.shift() ?? "", cwd: home };
  await run(["init"], io, home);
  await run(["client", "add", "A"], io, home);
  const code = await run(["new", "A"], io, home);
  assert.equal(code, 1);
});
