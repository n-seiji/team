import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";

const tmp = () => join(mkdtempSync(join(tmpdir(), "care-")), "records.json");

test("記録がなければ undefined", () => {
  assert.equal(openStore(tmp()).get("2026-10-17"), undefined);
});

test("記録すると時刻が残る", () => {
  const s = openStore(tmp());
  assert.deepEqual(s.record("2026-10-17", "06:42"), { at: "06:42" });
  assert.deepEqual(s.get("2026-10-17"), { at: "06:42" });
});

test("同じ日の2回目は最初の時刻を保持する", () => {
  const s = openStore(tmp());
  s.record("2026-10-17", "06:42");
  assert.deepEqual(s.record("2026-10-17", "06:50"), { at: "06:42" });
  assert.deepEqual(s.get("2026-10-17"), { at: "06:42" });
});

test("開き直しても記録が残る (再起動)", () => {
  const f = tmp();
  openStore(f).record("2026-10-17", "06:42");
  assert.deepEqual(openStore(f).get("2026-10-17"), { at: "06:42" });
});

test("日付が違えば別の記録", () => {
  const s = openStore(tmp());
  s.record("2026-10-17", "06:42");
  assert.equal(s.get("2026-10-18"), undefined);
});

test("壊れたファイルは黙って空にせず、起動時に例外", () => {
  const f = tmp();
  writeFileSync(f, "{not json");
  assert.throws(() => openStore(f));
});

test("保存ファイルは JSON で、一時ファイルが残らない", () => {
  const f = tmp();
  openStore(f).record("2026-10-17", "06:42");
  assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { "2026-10-17": { at: "06:42" } });
});
