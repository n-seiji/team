import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShift, buildShifts, ngWarnings, overLimitText, lineText, pct } from '../public/shift-logic.js';
import { formatReceived, daysOfMonth } from '../public/common.js';

test('受付表示は ISO 文字列の時刻をそのまま読む', () => {
  assert.equal(formatReceived('2026-10-28T09:05:12+09:00'), '10月28日 9時05分');
  assert.equal(formatReceived(undefined), '');
});

test('月の日数と曜日', () => {
  const d = daysOfMonth('2026-11');
  assert.equal(d.length, 30);
  assert.equal(d[0].wdLabel, '日'); // 2026-11-01 は日曜
});

test('シフト入力のパース', () => {
  assert.deepEqual(parseShift('9:00-14:00'), { start: '09:00', end: '14:00' });
  assert.deepEqual(parseShift('0900〜1400'), { start: '09:00', end: '14:00' });
  assert.equal(parseShift('  '), null);
  assert.ok(parseShift('14:00-9:00').error);
  assert.ok(parseShift('abc').error);
  assert.ok(parseShift('25:00-26:00').error);
});

test('入れない日にシフトを入れると警告', () => {
  const staff = [{ id: 's1', name: '陳', days: { '2026-11-07': { available: false } } }];
  const { shifts } = buildShifts({ '2026-11-07|s1': '17:00-21:00', '2026-11-08|s1': '9:00-12:00' });
  const w = ngWarnings(shifts, staff);
  assert.equal(w.length, 1);
  assert.match(w[0].text, /陳さんは11\/7/);
});

test('週超過の文と率の表示', () => {
  assert.equal(overLimitText({ name: '陳', weekStart: '2026-11-02', hours: 34, limit: 28 }), '陳さん 11/2〜11/8の週 34h / 上限 28h');
  assert.equal(pct(0.3216), '32.2%');
});

test('LINE 用テキスト', () => {
  const staff = [{ id: 's1', name: '陳' }, { id: 's2', name: '山田' }];
  const dates = daysOfMonth('2026-11');
  const { shifts } = buildShifts({ '2026-11-02|s1': '9:00-14:00', '2026-11-02|s2': '17:00-21:00' });
  assert.equal(lineText('2026-11', dates, staff, shifts), '【11月のシフト】\n2(月) 9:00-14:00 陳 / 17:00-21:00 山田');
});
