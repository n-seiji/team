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

test("list --csv: BOM付きで出力し、--out ならファイルに書く", async () => {
  const e = env(["事務所", "", "y"]);
  await run(["init"], e.io, e.home);
  await run(["client", "add", "A社"], e.io, e.home);
  await run(["new", "A社", "--month", "2026-09", "--item", "顧問料:50000"], e.io, e.home);
  e.out.length = 0;
  assert.equal(await run(["list", "--csv"], e.io, e.home), 0);
  assert.equal(e.out[0].charCodeAt(0), 0xfeff);
  assert.match(e.out[0], /^\ufeff番号,日付,クライアント,対象月,小計,消費税,源泉,請求額\r\nINV-0001,\d{4}-\d\d-\d\d,A社,2026-09,50000,5000,0,55000$/);
  assert.equal(await run(["list", "--csv", "--out", "一覧.csv"], e.io, e.home), 0);
  assert.ok(readFileSync(join(e.dir, "一覧.csv"), "utf8").startsWith("\ufeff番号,"));
});

test("引数なしの init / client add / new は日本語で1つずつ質問して進む", async () => {
  const e = env(["山田会計", "", "山田商店", "", "y"]);
  assert.equal(await run(["init"], e.io, e.home), 0);
  assert.equal(await run(["client", "add"], e.io, e.home), 0);
  assert.match(e.out.join("\n"), /山田商店 御中 \(源泉あり\)/);
  e.io.ask = (() => { const a = ["1", "2026-09", "報酬", "100000", "y", "実費", "10000", "n", "", "y"]; return async () => a.shift() ?? ""; })();
  assert.equal(await run(["new"], e.io, e.home), 0);
  assert.match(readFileSync(join(e.dir, "INV-0001.md"), "utf8"), /ご請求額: ¥110,790/);
});

test("エラー文に英語の引数名を出さない", async () => {
  const e = env(["事務所", ""]);
  await run(["init"], e.io, e.home);
  await run(["new", "A", "--format", "pdf"], e.io, e.home);
  await run(["new", "A", "--bogus"], e.io, e.home);
  assert.doesNotMatch(e.err.join("\n"), /--format|--bogus/);
});

test("定番: client add でy→保存、new で下書きが出て、Enterで採用。確認でNなら定番は変わらない", async () => {
  const e = env(["事務所", ""]);
  await run(["init"], e.io, e.home);
  // 名前・敬称・源泉・定番登録y・明細名・金額
  e.io.ask = (() => { const a = ["A社", "", "", "y", "顧問料", "50000", ""]; return async () => a.shift() ?? ""; })();
  await run(["client", "add"], e.io, e.home);
  const { openStore, getTemplate } = await import("../src/core.js");
  assert.equal(getTemplate(openStore(e.home), "A社").length, 1);
  e.out.length = 0;
  // 取引先・月(Enter)・採用(Enter)・確認N
  e.io.ask = (() => { const a = ["", "", "N"]; return async () => a.shift() ?? ""; })();
  await run(["new", "A社"], e.io, e.home);
  assert.ok(e.out.some((l) => /顧問料/.test(l) && /50,000/.test(l)));
  assert.ok(!existsSync(join(e.dir, "INV-0001.md")));
});

test("定番: 修正して発行→y で定番を更新。同じ内容なら聞かない", async () => {
  const e = env(["事務所", ""]);
  await run(["init"], e.io, e.home);
  await run(["client", "add", "A社"], e.io, e.home);
  const { openStore, getTemplate, setTemplate } = await import("../src/core.js");
  setTemplate(openStore(e.home), "A社", [{ name: "顧問料", amount: 50000, withholding: false }]);
  const asked: string[] = [];
  const seq = (a: string[]) => async (q: string) => { asked.push(q); return a.shift() ?? ""; };
  // 月, 2=直す, 名称そのまま, 金額60000, 追加しない, 発行y, 定番にするy
  e.io.ask = seq(["", "2", "", "60000", "", "y", "y"]);
  await run(["new", "A社"], e.io, e.home);
  assert.equal(getTemplate(openStore(e.home), "A社")[0].amount, 60000);
  asked.length = 0;
  e.io.ask = seq(["", "", "y"]); // 採用のまま発行
  await run(["new", "A社"], e.io, e.home);
  assert.ok(!asked.some((q) => /定番にしますか/.test(q)));
});
