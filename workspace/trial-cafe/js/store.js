// 在庫・発注の保存。依存なし。storage は localStorage 互換 (getItem/setItem) を注入する。
export const STORAGE_KEY = 'trial-cafe:v1';
export const LEVELS = ['none', 'low', 'half', 'high'];
const DAY_MS = 24 * 60 * 60 * 1000;

// 彩さんの一覧 (2026-10-17) どおり。使い始めた後は id を変えない (記録は id でつながる)。
export const SUPPLIERS = [
  { id: 'dairy', name: '北村商店', channel: 'phone' },
  { id: 'veg', name: '八百屋 みどり商店', channel: 'line' },
  { id: 'eggs', name: '森田たまご', channel: 'line' },
];

export const ITEMS = [
  { id: 'butter', name: 'バター(450g)', unit: '個', kind: 'count', supplierId: 'dairy' },
  { id: 'cream', name: '生クリーム(1L)', unit: 'パック', kind: 'count', supplierId: 'dairy' },
  { id: 'milk', name: '牛乳(1L)', unit: '本', kind: 'count', supplierId: 'dairy' },
  { id: 'cream-cheese', name: 'クリームチーズ(1kg)', unit: '箱', kind: 'count', supplierId: 'dairy' },
  { id: 'flour', name: '薄力粉(1kg)', unit: '袋', kind: 'level', supplierId: 'dairy' },
  { id: 'sugar', name: 'グラニュー糖(1kg)', unit: '袋', kind: 'level', supplierId: 'dairy' },
  { id: 'onion', name: '玉ねぎ', unit: '箱', kind: 'level', supplierId: 'veg' },
  { id: 'potato', name: 'じゃがいも', unit: '箱', kind: 'level', supplierId: 'veg' },
  { id: 'carrot', name: 'にんじん', unit: '箱', kind: 'level', supplierId: 'veg' },
  { id: 'mini-tomato', name: 'ミニトマト', unit: 'パック', kind: 'count', supplierId: 'veg' },
  { id: 'strawberry', name: 'いちご(ケーキ用)', unit: 'パック', kind: 'count', supplierId: 'veg' },
  { id: 'lemon', name: 'レモン', unit: '個', kind: 'count', supplierId: 'veg' },
  { id: 'baby-leaf', name: 'ベビーリーフ', unit: '袋', kind: 'level', supplierId: 'veg' },
  { id: 'egg', name: '卵(未開封)', unit: 'パック', kind: 'count', supplierId: 'eggs' },
  { id: 'egg-open', name: '卵(開封済み)', unit: 'パック', kind: 'level', supplierId: 'eggs' },
  { id: 'bacon', name: 'ベーコン', unit: 'パック', kind: 'count', supplierId: 'eggs' },
];

const isInt = (n) => Number.isInteger(n);

function emptyState() {
  return { stocks: [], orders: [] };
}

function load(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw == null) return emptyState();
  try {
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.stocks) || !Array.isArray(s.orders)) throw new Error('shape');
    return { stocks: s.stocks, orders: s.orders };
  } catch {
    // 壊れたデータは別キーに退避して空で起動する。退避できなくても起動は止めない。
    try {
      storage.setItem(`${STORAGE_KEY}:corrupt:${Date.now()}`, raw);
    } catch { /* 退避失敗は無視 (起動を優先) */ }
    return emptyState();
  }
}

export function createStore(storage, now = () => new Date()) {
  let state = load(storage);
  const items = new Map(ITEMS.map((i) => [i.id, i]));

  const item = (id) => {
    const it = items.get(id);
    if (!it) throw new Error(`unknown item: ${id}`);
    return it;
  };

  function validateStock(e) {
    const it = item(e.itemId);
    if (it.kind === 'count') {
      if (!isInt(e.value) || e.value < 0) throw new Error(`invalid count for ${it.id}: ${e.value}`);
    } else if (!LEVELS.includes(e.value)) {
      throw new Error(`invalid level for ${it.id}: ${e.value}`);
    }
  }

  function validateOrder(e, supplierId) {
    const it = item(e.itemId);
    if (it.supplierId !== supplierId) throw new Error(`item ${it.id} is not from supplier ${supplierId}`);
    if (!isInt(e.quantity) || e.quantity < 1) throw new Error(`invalid quantity for ${it.id}: ${e.quantity}`);
  }

  // 新しい状態を作り、1回の setItem で書く。失敗したら state は変えず例外を投げる。
  function commit(next) {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next;
  }

  const requireList = (entries) => {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('entries is empty');
  };

  function recordStocks({ entries, recorder }) {
    requireList(entries);
    if (typeof recorder !== 'string' || recorder.trim() === '') throw new Error('recorder is required');
    entries.forEach(validateStock);
    const at = now().toISOString();
    const added = entries.map((e) => ({ itemId: e.itemId, value: e.value, recorder: recorder.trim(), at }));
    commit({ ...state, stocks: [...state.stocks, ...added] });
    return added;
  }

  function recordOrders({ entries, supplierId }) {
    requireList(entries);
    if (!SUPPLIERS.some((s) => s.id === supplierId)) throw new Error(`unknown supplier: ${supplierId}`);
    entries.forEach((e) => validateOrder(e, supplierId));
    const at = now().toISOString();
    const added = entries.map((e) => ({ itemId: e.itemId, quantity: e.quantity, supplierId, at }));
    commit({ ...state, orders: [...state.orders, ...added] });
    return added;
  }

  // 同時刻は後から追加した方を新しいとみなす (配列は追加順)。
  const latest = (list, itemId) => {
    let best = null;
    for (const r of list) {
      if (r.itemId === itemId && (!best || r.at >= best.at)) best = r;
    }
    return best ? { ...best } : null;
  };

  return {
    listSuppliers: () => SUPPLIERS.map((s) => ({ ...s })),
    listItems: () => ITEMS.map((i) => ({ ...i })),
    recordStock: ({ itemId, value, recorder }) => recordStocks({ entries: [{ itemId, value }], recorder })[0],
    recordOrder: ({ itemId, quantity, supplierId }) =>
      recordOrders({ entries: [{ itemId, quantity }], supplierId })[0],
    recordStocks,
    recordOrders,
    latestStock: (itemId) => latest(state.stocks, itemId),
    lastOrder: (itemId) => latest(state.orders, itemId),
    // days 日 (= days*24 時間) 以内の発注。daysAgo は経過時間の切り捨て。
    recentOrder(itemId, days = 2) {
      const o = latest(state.orders, itemId);
      if (!o) return null;
      const elapsed = now().getTime() - new Date(o.at).getTime();
      if (elapsed > days * DAY_MS) return null;
      return { quantity: o.quantity, at: o.at, daysAgo: Math.max(0, Math.floor(elapsed / DAY_MS)) };
    },
    // 在庫記録の日時 stockAt より後の、最初の発注の日時。業者・品目は問わない。なければ null。
    orderedAfter(stockAt) {
      const t = new Date(stockAt).getTime();
      if (Number.isNaN(t)) throw new Error(`invalid stockAt: ${stockAt}`);
      let first = null;
      for (const o of state.orders) {
        const ot = new Date(o.at).getTime();
        if (ot > t && (first === null || ot < first)) first = ot;
      }
      return first === null ? null : new Date(first).toISOString();
    },
    history(itemId) {
      const rows = [
        ...state.stocks.filter((r) => r.itemId === itemId).map((r) => ({ type: 'stock', ...r })),
        ...state.orders.filter((r) => r.itemId === itemId).map((r) => ({ type: 'order', ...r })),
      ];
      return rows.map((r, i) => [r, i]).sort((a, b) => (a[0].at < b[0].at ? 1 : a[0].at > b[0].at ? -1 : b[1] - a[1])).map((x) => x[0]);
    },
  };
}
