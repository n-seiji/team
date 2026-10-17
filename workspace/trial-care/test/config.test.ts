import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTokens } from "../src/config.ts";

const tmp = () => join(mkdtempSync(join(tmpdir(), "care-cfg-")), "tokens.json");

test("環境変数があればそれを使う", () => {
  const t = loadTokens({ CARE_MOTHER_TOKEN: "a".repeat(20), CARE_FAMILY_TOKEN: "b".repeat(20) }, tmp());
  assert.deepEqual(t, { mother: "a".repeat(20), family: "b".repeat(20) });
});

test("未設定なら生成して保存し、次回も同じ", () => {
  const f = tmp();
  const t1 = loadTokens({}, f);
  assert.ok(t1.mother.length >= 32 && t1.family.length >= 32);
  assert.notEqual(t1.mother, t1.family);
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), t1);
  assert.deepEqual(loadTokens({}, f), t1);
});

test("短すぎるトークンと、本人用=家族用は拒否", () => {
  assert.throws(() => loadTokens({ CARE_MOTHER_TOKEN: "abc", CARE_FAMILY_TOKEN: "b".repeat(20) }, tmp()));
  assert.throws(() => loadTokens({ CARE_MOTHER_TOKEN: "a".repeat(20), CARE_FAMILY_TOKEN: "a".repeat(20) }, tmp()));
});

test("トークンは URL で安全な文字だけ", () => {
  assert.throws(() => loadTokens({ CARE_MOTHER_TOKEN: "a/b".padEnd(20, "x"), CARE_FAMILY_TOKEN: "b".repeat(20) }, tmp()));
});
