// check.js が使う store の関数と format.js の結合確認(DOM なし)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { prevText, groupBySupplier, countUnfilled } from '../js/format.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('記録 → 再読み込み → 「前回」に出る', () => {
  const storage = memory();
  const t = new Date('2026-10-16T19:00:00+09:00');
  const s1 = createStore(storage, () => t);
  const items = s1.listItems();
  const count = items.find((i) => i.kind === 'count');
  const level = items.find((i) => i.kind === 'level');
  s1.recordStocks({ entries: [{ itemId: count.id, value: 2 }, { itemId: level.id, value: 'half' }], recorder: '蓮' });
  const now = new Date('2026-10-17T19:00:00+09:00');
  const s2 = createStore(storage, () => now);
  assert.equal(prevText(count, s2.latestStock(count.id), now), `前回: 2${count.unit}(昨日・蓮)`);
  assert.equal(prevText(level, s2.latestStock(level.id), now), '前回: 半分(昨日・蓮)');
  const other = items.find((i) => i.id !== count.id && i.id !== level.id);
  assert.equal(prevText(other, s2.latestStock(other.id), now), '前回: 記録なし');
});

test('全品目が業者ごとに並び、未入力数が数えられる', () => {
  const s = createStore(memory());
  const groups = groupBySupplier(s.listSuppliers(), s.listItems());
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), s.listItems().length);
  assert.equal(countUnfilled(s.listItems(), new Map()), s.listItems().length);
});

test('不正な値で保存が失敗しても、前回は変わらない', () => {
  const s = createStore(memory());
  const [a, b] = s.listItems();
  assert.throws(() => s.recordStocks({ entries: [{ itemId: a.id, value: -1 }, { itemId: b.id, value: 1 }], recorder: '蓮' }));
  assert.equal(s.latestStock(a.id), null);
});

test('直近の記録のあとに発注があれば、上部に日時つきで出る', async () => {
  const { latestRecord, orderedAfterText } = await import('../js/format.js');
  const storage = memory();
  let t = new Date(2026, 9, 16, 21, 30);
  const s = createStore(storage, () => t);
  const items = s.listItems();
  assert.equal(latestRecord(items, s.latestStock), null);
  const count = items.find((i) => i.kind === 'count');
  s.recordStocks({ entries: [{ itemId: count.id, value: 2 }], recorder: '蓮' });
  let rec = latestRecord(items, s.latestStock);
  assert.equal(rec.recorder, '蓮');
  assert.equal(orderedAfterText(s.orderedAfter(rec.at)), 'まだ発注されていません');
  t = new Date(2026, 9, 17, 19, 30);
  s.recordOrders({ entries: [{ itemId: count.id, quantity: 3 }], supplierId: count.supplierId });
  rec = latestRecord(items, createStore(storage).latestStock);
  assert.equal(orderedAfterText(s.orderedAfter(rec.at)), 'この記録のあと、彩さんが 10/17 19:30 に発注しました');
});
