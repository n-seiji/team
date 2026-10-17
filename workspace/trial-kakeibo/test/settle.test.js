import test from 'node:test';
import assert from 'node:assert/strict';
import { settle, computeBalances } from '../src/settle.js';

const net = (transfers) => {
  const b = {};
  for (const t of transfers) {
    b[t.from] = (b[t.from] ?? 0) - t.amount;
    b[t.to] = (b[t.to] ?? 0) + t.amount;
  }
  return b;
};

test('AがBに5000円払った（2人で折半）→ BがAに2500円', () => {
  const bal = computeBalances([{ amount: 5000, payerId: 'a', participantIds: ['a', 'b'] }]);
  assert.deepEqual(bal, { a: 2500, b: -2500 });
  assert.deepEqual(settle(bal), { transfers: [{ from: 'b', to: 'a', amount: 2500 }], approximate: false });
});

test('収支の合計は常に0', () => {
  const bal = computeBalances([
    { amount: 1000, payerId: 'a', participantIds: ['a', 'b', 'c'] },
    { amount: 333, payerId: 'b', participantIds: ['b', 'c'] },
  ]);
  assert.equal(Object.values(bal).reduce((x, y) => x + y, 0), 0);
});

test('渡す回数が最小: 合計0の組に分けられるなら回数が減る', () => {
  // {b,c} と {a,d,e} に分けて 1 + 2 = 3回。大きい順に貪欲に繋ぐと 4回になる
  const bal = { a: 4, b: 3, c: -3, d: -2, e: -2 };
  const { transfers, approximate } = settle(bal);
  assert.equal(approximate, false);
  assert.equal(transfers.length, 3);
  assert.deepEqual(net(transfers), bal);
});

test('組に分けられないときは人数-1回', () => {
  const bal = { a: 5, b: 4, c: -3, d: -6 };
  const { transfers } = settle(bal);
  assert.equal(transfers.length, 3);
  assert.deepEqual(net(transfers), bal);
});

test('全員0なら渡すものなし', () => {
  assert.deepEqual(settle({ a: 0, b: 0 }), { transfers: [], approximate: false });
});

test('7人以上は近似フラグが付き、収支は必ず合う', () => {
  const bal = { a: 10, b: 20, c: 30, d: -15, e: -15, f: -20, g: -10 };
  const { transfers, approximate } = settle(bal);
  assert.equal(approximate, true);
  assert.deepEqual(net(transfers), bal);
});

test('6人ちょうどは厳密（近似フラグなし）', () => {
  const bal = { a: 10, b: 20, c: -5, d: -5, e: -10, f: -10 };
  const { approximate } = settle(bal);
  assert.equal(approximate, false);
});
