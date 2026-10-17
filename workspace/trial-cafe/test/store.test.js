import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/store.js';

class MemStorage {
  constructor() { this.m = new Map(); this.failWrites = false; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (this.failWrites) throw new Error('QuotaExceededError'); this.m.set(k, String(v)); }
}
const clock = (iso) => { let t = new Date(iso); return { now: () => t, set: (i) => { t = new Date(i); } }; };

test('初期データ: 3社・LINE/電話・主要品目', () => {
  const s = createStore(new MemStorage());
  const sup = s.listSuppliers();
  assert.deepEqual(sup.map((x) => [x.name, x.channel]), [['北村商店', 'phone'], ['八百屋 みどり商店', 'line'], ['森田たまご', 'line']]);
  const items = s.listItems();
  const count = (id) => items.filter((i) => i.supplierId === id).length;
  assert.deepEqual([items.length, count('dairy'), count('veg'), count('eggs')], [16, 6, 7, 3]);
  const byName = (n) => items.find((i) => i.name === n);
  assert.ok(byName('バター(450g)') && byName('生クリーム(1L)').supplierId === 'dairy');
  assert.equal(byName('生クリーム(1L)').kind, 'count');
  assert.deepEqual([byName('卵(未開封)').kind, byName('卵(未開封)').unit, byName('卵(開封済み)').kind], ['count', 'パック', 'level']);
  assert.ok(!items.some((i) => i.name.includes('レタス')));
  assert.deepEqual(items.filter((i) => i.supplierId === 'dairy').slice(-2).map((i) => i.id), ['flour', 'sugar']);
  assert.ok(s.listItems().every((i) => sup.some((x) => x.id === i.supplierId)));
});

test('orderedAfter: 記録の後の最初の発注', () => {
  const c = clock('2026-10-16T12:00:00Z'); const s = createStore(new MemStorage(), c.now);
  const stockAt = s.recordStocks({ entries: [{ itemId: 'butter', value: 1 }], recorder: '蓮' })[0].at;
  assert.equal(s.orderedAfter(stockAt), null); // 発注なし
  c.set('2026-10-17T10:30:00Z'); s.recordOrders({ entries: [{ itemId: 'lemon', quantity: 3 }], supplierId: 'veg' });
  c.set('2026-10-17T11:00:00Z'); s.recordOrders({ entries: [{ itemId: 'egg', quantity: 2 }], supplierId: 'eggs' });
  assert.equal(s.orderedAfter(stockAt), '2026-10-17T10:30:00.000Z'); // 業者を問わず最初の1件
});

test('orderedAfter: 記録より前の発注だけなら null', () => {
  const c = clock('2026-10-16T10:00:00Z'); const s = createStore(new MemStorage(), c.now);
  s.recordOrders({ entries: [{ itemId: 'butter', quantity: 2 }], supplierId: 'dairy' });
  c.set('2026-10-16T12:30:00Z');
  const stockAt = s.recordStocks({ entries: [{ itemId: 'butter', value: 1 }], recorder: '蓮' })[0].at;
  assert.equal(s.orderedAfter(stockAt), null);
  assert.throws(() => s.orderedAfter('not-a-date'));
});

test('再読み込み後の復元', () => {
  const st = new MemStorage(); const c = clock('2026-10-16T19:00:00Z');
  const a = createStore(st, c.now);
  a.recordStocks({ entries: [{ itemId: 'butter', value: 1 }, { itemId: 'flour', value: 'low' }], recorder: '蓮' });
  a.recordOrders({ entries: [{ itemId: 'butter', quantity: 2 }], supplierId: 'dairy' });
  const b = createStore(st, c.now);
  assert.deepEqual(b.latestStock('butter'), { itemId: 'butter', value: 1, recorder: '蓮', at: '2026-10-16T19:00:00.000Z' });
  assert.equal(b.latestStock('flour').value, 'low');
  assert.equal(b.lastOrder('butter').quantity, 2);
  assert.equal(b.latestStock('egg'), null);
});

test('最終発注の取得: 最新が返る / 未発注は null', () => {
  const st = new MemStorage(); const c = clock('2026-10-10T18:00:00Z');
  const s = createStore(st, c.now);
  assert.equal(s.lastOrder('butter'), null);
  s.recordOrder({ itemId: 'butter', quantity: 2, supplierId: 'dairy' });
  c.set('2026-10-15T18:00:00Z');
  s.recordOrder({ itemId: 'butter', quantity: 3, supplierId: 'dairy' });
  assert.deepEqual(s.lastOrder('butter'), { itemId: 'butter', quantity: 3, supplierId: 'dairy', at: '2026-10-15T18:00:00.000Z' });
});

test('recentOrder: 48時間ぴったりは含む、超えたら null、daysAgo は切り捨て', () => {
  const st = new MemStorage(); const c = clock('2026-10-10T18:00:00Z');
  const s = createStore(st, c.now);
  s.recordOrder({ itemId: 'cream', quantity: 2, supplierId: 'dairy' });
  c.set('2026-10-10T20:00:00Z');
  assert.equal(s.recentOrder('cream', 2).daysAgo, 0);
  c.set('2026-10-11T19:00:00Z');
  assert.deepEqual(s.recentOrder('cream', 2), { quantity: 2, at: '2026-10-10T18:00:00.000Z', daysAgo: 1 });
  c.set('2026-10-12T18:00:00Z');
  assert.equal(s.recentOrder('cream').daysAgo, 2);
  c.set('2026-10-12T18:00:01Z');
  assert.equal(s.recentOrder('cream', 2), null);
  assert.equal(s.recentOrder('butter', 2), null);
});

test('一括保存: 1件でも不正なら全体が例外で何も保存されない', () => {
  const st = new MemStorage(); const s = createStore(st);
  assert.throws(() => s.recordStocks({ entries: [{ itemId: 'butter', value: 2 }, { itemId: 'flour', value: 'lots' }], recorder: '蓮' }));
  assert.equal(s.latestStock('butter'), null);
  assert.equal(st.getItem(STORAGE_KEY), null);
  assert.throws(() => s.recordOrders({ entries: [{ itemId: 'butter', quantity: 2 }, { itemId: 'milk', quantity: 0 }], supplierId: 'dairy' }));
  assert.equal(s.lastOrder('butter'), null);
});

test('一括保存: 書き込み失敗は例外で、メモリにも残らない', () => {
  const st = new MemStorage(); const s = createStore(st);
  s.recordStocks({ entries: [{ itemId: 'butter', value: 5 }], recorder: '蓮' });
  st.failWrites = true;
  assert.throws(() => s.recordStocks({ entries: [{ itemId: 'butter', value: 1 }, { itemId: 'milk', value: 3 }], recorder: '蓮' }), /Quota/);
  assert.throws(() => s.recordOrders({ entries: [{ itemId: 'butter', quantity: 2 }], supplierId: 'dairy' }), /Quota/);
  assert.equal(s.latestStock('butter').value, 5);
  assert.equal(s.latestStock('milk'), null);
  assert.equal(s.lastOrder('butter'), null);
  assert.equal(createStore(st).latestStock('butter').value, 5);
});

test('不正値の拒否', () => {
  const s = createStore(new MemStorage());
  const bad = (e) => assert.throws(() => s.recordStock({ ...e, recorder: '蓮' }), undefined, JSON.stringify(e));
  bad({ itemId: 'butter', value: -1 });
  bad({ itemId: 'butter', value: 1.5 });
  bad({ itemId: 'butter', value: '2' });
  bad({ itemId: 'butter', value: 'low' });
  bad({ itemId: 'flour', value: 2 });
  bad({ itemId: 'flour', value: 'many' });
  bad({ itemId: 'cream', value: 'half' });
  bad({ itemId: 'nothing', value: 1 });
  assert.throws(() => s.recordStock({ itemId: 'butter', value: 1, recorder: ' ' }));
  const badO = (e, sup = 'dairy') => assert.throws(() => s.recordOrder({ ...e, supplierId: sup }), undefined, JSON.stringify(e));
  badO({ itemId: 'butter', quantity: 0 });
  badO({ itemId: 'butter', quantity: -2 });
  badO({ itemId: 'butter', quantity: 1.5 });
  badO({ itemId: 'cream', quantity: 'half' });
  badO({ itemId: 'butter', quantity: 1 }, 'veg');
  badO({ itemId: 'butter', quantity: 1 }, 'nope');
  s.recordStock({ itemId: 'butter', value: 0, recorder: '蓮' });
  s.recordStock({ itemId: 'egg-open', value: 'none', recorder: '蓮' });
});

test('壊れたデータでも起動し、別キーに退避する', () => {
  for (const raw of ['{not json', '{"stocks":1}', 'null']) {
    const st = new MemStorage(); st.setItem(STORAGE_KEY, raw);
    const s = createStore(st);
    assert.equal(s.latestStock('butter'), null);
    const backups = [...st.m.keys()].filter((k) => k.startsWith(`${STORAGE_KEY}:corrupt:`));
    assert.equal(backups.length, 1);
    assert.equal(st.getItem(backups[0]), raw);
    s.recordStock({ itemId: 'butter', value: 1, recorder: '蓮' });
    assert.equal(createStore(st).latestStock('butter').value, 1);
  }
});

test('history は日時の降順', () => {
  const st = new MemStorage(); const c = clock('2026-10-10T18:00:00Z');
  const s = createStore(st, c.now);
  s.recordStock({ itemId: 'butter', value: 1, recorder: '蓮' });
  c.set('2026-10-11T18:00:00Z');
  s.recordOrder({ itemId: 'butter', quantity: 2, supplierId: 'dairy' });
  assert.deepEqual(s.history('butter').map((r) => r.type), ['order', 'stock']);
});
