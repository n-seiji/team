import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItem } from "../src/items.ts";
import { renderConfirm, renderHtml, renderMarkdown, type Invoice } from "../src/render.ts";

const inv: Invoice = {
  number: "2026-0001", date: "2026-10-09", month: "2026-09", clientName: "山田商店", honorific: "御中",
  withholdingEnabled: true, issuer: { name: "山田 恵子", invoiceNo: "T1234567890123" },
  items: [{ name: "顧問料", amount: 50000, withholding: false }, { name: "記帳代行", amount: 60000, withholding: true }],
  subtotal: 110000, tax: 11000, withholdingBase: 60000, withholdingTax: 6126, total: 114874,
};

test("parseItem: 名称のみ/源泉/名称にコロン", () => {
  assert.deepEqual(parseItem("顧問料:50000"), { name: "顧問料", amount: 50000, withholding: false });
  assert.deepEqual(parseItem("記帳代行:60000:源泉"), { name: "記帳代行", amount: 60000, withholding: true });
  assert.deepEqual(parseItem("A:B案:1,200"), { name: "A:B案", amount: 1200, withholding: false });
  assert.throws(() => parseItem("顧問料"), /読めませんでした/);
  assert.throws(() => parseItem("顧問料:abc"), /読めませんでした/);
});
test("確認画面は 宛名→対象月→合計→源泉 の順", () => {
  const t = renderConfirm(inv);
  const idx = ["宛名", "対象月", "合計", "源泉"].map((k) => t.indexOf(k));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  assert.match(t, /円未満切り捨て/);
});
test("MD/HTML に必須項目がすべて出る", () => {
  for (const out of [renderMarkdown(inv), renderHtml(inv)]) {
    for (const s of ["山田商店", "御中", "2026-0001", "2026-10-09", "2026-09", "記帳代行", "¥11,000", "¥6,126", "¥114,874", "T1234567890123"]) {
      assert.ok(out.includes(s), s);
    }
  }
  assert.match(renderHtml(inv), /@page \{ size: A4/);
});
test("源泉なしなら源泉行を出さない / HTMLはエスケープ", () => {
  const i2 = { ...inv, withholdingEnabled: false, clientName: "<b>x</b>" };
  assert.ok(!renderMarkdown(i2).includes("源泉徴収税額"));
  assert.ok(!renderHtml(i2).includes("<b>x</b>"));
});
