// 発注画面が使う store と format の結合確認(DOM なし)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { orderEntries, lineMessage, phoneList, warnText, lastOrderText, stockLine, parseQuantity } from '../js/format.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('parseQuantity: 空・0・不正は頼まない、全角は読む', () => {
  assert.equal(parseQuantity(''), null);
  assert.equal(parseQuantity('0'), null);
  assert.equal(parseQuantity('-1'), null);
  assert.equal(parseQuantity('1.5'), null);
  assert.equal(parseQuantity('３'), 3);
});

test('発注 → 再読み込み → 最後に頼んだ量と警告に出る。未入力は含めない', () => {
  const storage = memory();
  const t = new Date('2026-10-16T19:00:00+09:00');
  const s1 = createStore(storage, () => t);
  const sup = s1.listSuppliers().find((s) => s.channel === 'line');
  const items = s1.listItems().filter((i) => i.supplierId === sup.id);
  const q = new Map([[items[0].id, '3'], [items[1]?.id, '']]);
  const entries = orderEntries(items, q);
  assert.equal(entries.length, 1);
  s1.recordOrders({ entries: entries.map((e) => ({ itemId: e.item.id, quantity: e.quantity })), supplierId: sup.id });

  const now = new Date('2026-10-17T19:00:00+09:00');
  const s2 = createStore(storage, () => now);
  const it = items[0];
  assert.equal(lastOrderText(it, s2.lastOrder(it.id), now), `最後に頼んだ日と量: 昨日・3${it.unit}`);
  assert.equal(warnText(it, s2.recentOrder(it.id, 2), now), `昨日3${it.unit}頼み済み`);
  assert.equal(warnText(items[1], s2.recentOrder(items[1].id, 2)), '');
  assert.match(lineMessage(sup, entries), new RegExp(`・${it.name} 3${it.unit}`));
  assert.deepEqual(phoneList(entries), [`${it.name} 3${it.unit}`]);
});

test('在庫記録がなければ「記録なし」、あれば記録者つき', () => {
  const t = new Date('2026-10-16T19:00:00+09:00');
  const s = createStore(memory(), () => t);
  const it = s.listItems().find((i) => i.kind === 'count');
  assert.equal(stockLine(it, s.latestStock(it.id), t), '直近の在庫: 記録なし');
  s.recordStocks({ entries: [{ itemId: it.id, value: 2 }], recorder: '蓮' });
  assert.equal(stockLine(it, s.latestStock(it.id), t), `直近の在庫: 2${it.unit}(今日・蓮)`);
});

test('他の業者の品目を混ぜると全体が失敗し、最後の発注は変わらない', () => {
  const s = createStore(memory());
  const [a, b] = s.listSuppliers();
  const other = s.listItems().find((i) => i.supplierId === b.id);
  assert.throws(() => s.recordOrders({ entries: [{ itemId: other.id, quantity: 1 }], supplierId: a.id }));
  assert.equal(s.lastOrder(other.id), null);
});

test('警告の日付は「最後に頼んだ日」と同じ暦日で出す(24時間未満でも昨日は昨日)', () => {
  const storage = memory();
  const s1 = createStore(storage, () => new Date('2026-10-16T19:30:00+09:00'));
  const sup = s1.listSuppliers().find((s) => s.channel === 'line');
  const it = s1.listItems().find((i) => i.supplierId === sup.id);
  s1.recordOrders({ entries: [{ itemId: it.id, quantity: 2 }], supplierId: sup.id });

  const now = new Date('2026-10-17T19:00:00+09:00'); // 23.5 時間後
  const s2 = createStore(storage, () => now);
  assert.equal(lastOrderText(it, s2.lastOrder(it.id), now), `最後に頼んだ日と量: 昨日・2${it.unit}`);
  assert.equal(warnText(it, s2.recentOrder(it.id, 2), now), `昨日2${it.unit}頼み済み`);
  const later = new Date('2026-10-18T09:00:00+09:00'); // 37.5 時間後、暦日で2日前
  assert.equal(warnText(it, createStore(storage, () => later).recentOrder(it.id, 2), later), `2日前に2${it.unit}頼み済み`);
});
