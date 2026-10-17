import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAmount } from '../src/split.js';

const total = (s) => Object.values(s).reduce((a, b) => a + b, 0);

test('3人で1000円は 334/333/333（余りはID昇順の先頭から）', () => {
  assert.deepEqual(splitAmount(1000, ['c', 'a', 'b']), { a: 334, b: 333, c: 333 });
});

test('余りが2円なら先頭2人に1円ずつ', () => {
  assert.deepEqual(splitAmount(1001, ['a', 'b', 'c']), { a: 334, b: 334, c: 333 });
});

test('割り切れるときはそのまま', () => {
  assert.deepEqual(splitAmount(900, ['a', 'b', 'c']), { a: 300, b: 300, c: 300 });
});

test('1人負担なら全額', () => {
  assert.deepEqual(splitAmount(777, ['a']), { a: 777 });
});

test('どんな人数・金額でも合計は元の金額に一致', () => {
  for (let n = 1; n <= 8; n++) {
    const ids = Array.from({ length: n }, (_, i) => `m${i}`);
    for (const amount of [1, 2, 7, 100, 1001, 12345, 99999]) {
      assert.equal(total(splitAmount(amount, ids)), amount);
    }
  }
});

test('同じ入力は何度でも同じ結果', () => {
  assert.deepEqual(splitAmount(1000, ['b', 'a', 'c']), splitAmount(1000, ['c', 'b', 'a']));
});
