import { test } from "node:test";
import assert from "node:assert/strict";
import { tokyoDate, tokyoTime, daysBefore } from "../src/dates.ts";

test("UTC 21:30 は日本時間では翌日 06:30", () => {
  const d = new Date("2026-10-16T21:30:00Z");
  assert.equal(tokyoDate(d), "2026-10-17");
  assert.equal(tokyoTime(d), "06:30");
});

test("時刻はゼロ埋め", () => {
  assert.equal(tokyoTime(new Date("2026-10-16T20:05:00Z")), "05:05");
});

test("日付が変わる境界 (日本時間 0:00)", () => {
  assert.equal(tokyoDate(new Date("2026-10-16T14:59:59Z")), "2026-10-16");
  assert.equal(tokyoDate(new Date("2026-10-16T15:00:00Z")), "2026-10-17");
});

test("daysBefore は月・年をまたぐ", () => {
  assert.equal(daysBefore("2026-03-02", 3), "2026-02-27");
  assert.equal(daysBefore("2026-01-01", 1), "2025-12-31");
});
