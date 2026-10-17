import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prevText, relativeDay, stepCount, countUnfilled, groupBySupplier } from '../js/format.js';

const now = new Date(2026, 9, 17, 19, 0);
const butter = { id: 'butter', name: 'バター', unit: '個', kind: 'count', supplierId: 's1' };
const cream = { id: 'cream', name: '生クリーム', unit: 'パック', kind: 'level', supplierId: 's1' };

test('前回の添え文字', () => {
  const yesterday = new Date(2026, 9, 16, 18, 45).toISOString();
  assert.equal(prevText(butter, { value: 2, at: yesterday, recorder: '蓮' }, now), '前回: 2個(昨日・蓮)');
  assert.equal(prevText(cream, { value: 'low', at: now.toISOString(), recorder: '蓮' }, now), '前回: 少ない(今日・蓮)');
  assert.equal(prevText(butter, null, now), '前回: 記録なし');
});

test('暦日で数える(23時間前でも日をまたげば昨日)', () => {
  assert.equal(relativeDay(new Date(2026, 9, 16, 23, 59).toISOString(), new Date(2026, 9, 17, 0, 5)), '昨日');
  assert.equal(relativeDay(new Date(2026, 9, 14, 12).toISOString(), now), '3日前');
});

test('+/- は未入力から始まり 0 未満にならない', () => {
  assert.equal(stepCount(undefined, 1), 1);
  assert.equal(stepCount(undefined, -1), 0);
  assert.equal(stepCount(0, -1), 0);
  assert.equal(stepCount(2, 1), 3);
});

test('未入力の数と業者ごとの並び', () => {
  assert.equal(countUnfilled([butter, cream], new Map([['butter', 0]])), 1);
  const g = groupBySupplier([{ id: 's1' }, { id: 's2' }], [butter, cream]);
  assert.equal(g.length, 1);
  assert.equal(g[0].items.length, 2);
});

test('parseCount: 0以上の整数だけ。空は未入力、全角も読む', async () => {
  const { parseCount } = await import('../js/format.js');
  assert.equal(parseCount('10'), 10);
  assert.equal(parseCount('0'), 0);
  assert.equal(parseCount('１２'), 12);
  assert.equal(parseCount(''), undefined);
  assert.equal(parseCount('-1'), null);
  assert.equal(parseCount('1.5'), null);
  assert.equal(parseCount('a'), null);
});

test('orderedAfterText: 発注ありは日時つき、なしは「まだ発注されていません」', async () => {
  const { orderedAfterText } = await import('../js/format.js');
  assert.equal(orderedAfterText(new Date(2026, 9, 17, 19, 30).toISOString()), 'この記録のあと、彩さんが 10/17 19:30 に発注しました');
  assert.equal(orderedAfterText(null), 'まだ発注されていません');
});
