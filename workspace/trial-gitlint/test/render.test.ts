import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/render.ts";

const problems = [{ where: "メッセージ全体", why: "「fix」だけでは、何をしたのか後から分かりません" }];

test("free の警告(ok:true)は「!」で始まる", () => {
  const lines = render({ ok: true, problems, suggestions: ["fix: <説明>"] }, "(警告だけです。コミットは通ります)");
  assert.match(lines[0], /^! メッセージ全体: /);
  assert.ok(lines.every((l) => !l.startsWith("✗")));
  assert.ok(lines.length <= 5);
});

test("終了コード1のエラー(ok:false)は「✗」のまま", () => {
  const lines = render({ ok: false, problems, suggestions: ["fix: <説明>"] }, "[Enter] そのまま続ける");
  assert.match(lines[0], /^✗ メッセージ全体: /);
  assert.ok(lines.every((l) => !l.startsWith("!")));
  assert.ok(lines.length <= 5);
});
