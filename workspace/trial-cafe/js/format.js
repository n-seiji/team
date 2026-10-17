// 画面用の純粋関数(DOM なし)。test/format.test.js で確認する。

export const LEVELS = [
  { value: 'none', label: 'なし' },
  { value: 'low', label: '少ない' },
  { value: 'half', label: '半分' },
  { value: 'high', label: '多い' },
];

export function levelLabel(value) {
  const found = LEVELS.find((l) => l.value === value);
  return found ? found.label : String(value);
}

export function valueText(item, value) {
  return item.kind === 'level' ? levelLabel(value) : `${value}${item.unit}`;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// 暦日ベースの「今日 / 昨日 / ○日前」。
export function relativeDay(iso, now = new Date()) {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86400000);
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  return `${days}日前`;
}

// 「前回: 2個(昨日・蓮)」。記録がなければ「前回: 記録なし」。
export function prevText(item, stock, now = new Date()) {
  if (!stock) return '前回: 記録なし';
  return `前回: ${valueText(item, stock.value)}(${relativeDay(stock.at, now)}・${stock.recorder})`;
}

export function countUnfilled(items, values) {
  return items.filter((i) => !values.has(i.id)).length;
}

// 数える品目の +/-。未入力から + は 1、- は 0。0 未満にはしない。
export function stepCount(current, delta) {
  if (current === undefined) return delta > 0 ? 1 : 0;
  return Math.max(0, current + delta);
}

// 数える品目の直接入力。全角数字も読む。空は undefined(= 未入力)、0以上の整数以外は null(= 受け付けない)。
export function parseCount(text) {
  const t = String(text ?? '').trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (t === '') return undefined;
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

// 「10/17 19:30」(端末の時刻で)。
export function shortDateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 一番新しい在庫記録の日時と記録者。記録がなければ null。
export function latestRecord(items, latestStock) {
  let best = null;
  for (const i of items) {
    const s = latestStock(i.id);
    if (s && (!best || s.at > best.at)) best = s;
  }
  return best && { at: best.at, recorder: best.recorder };
}

// #/check 上部: 直近の記録のあとに発注があったか。orderedAt は store.orderedAfter の返り値。
export function orderedAfterText(orderedAt) {
  return orderedAt ? `この記録のあと、彩さんが ${shortDateTime(orderedAt)} に発注しました` : 'まだ発注されていません';
}

export function groupBySupplier(suppliers, items) {
  return suppliers
    .map((s) => ({ supplier: s, items: items.filter((i) => i.supplierId === s.id) }))
    .filter((g) => g.items.length > 0);
}

// ---- 発注画面(#/order)用 ----

// 「直近の在庫: 2個(昨日・蓮)」。記録がなければ「記録なし」。
export function stockLine(item, stock, now = new Date()) {
  if (!stock) return '直近の在庫: 記録なし';
  return `直近の在庫: ${valueText(item, stock.value)}(${relativeDay(stock.at, now)}・${stock.recorder})`;
}

// 「最後に頼んだ日と量: 昨日・3個」。
export function lastOrderText(item, order, now = new Date()) {
  if (!order) return '最後に頼んだ日と量: 記録なし';
  return `最後に頼んだ日と量: ${relativeDay(order.at, now)}・${order.quantity}${item.unit}`;
}

// 2日以内の発注の警告。止めない。recent は store.recentOrder の返り値。
// 日付は「最後に頼んだ日と量」と同じ暦日で出す(daysAgo は経過時間なので使わない)。
export function warnText(item, recent, now = new Date()) {
  if (!recent) return '';
  const day = relativeDay(recent.at, now);
  const when = day === '今日' || day === '昨日' ? day : `${day}に`;
  return `${when}${recent.quantity}${item.unit}頼み済み`;
}

// 入力欄の文字を発注量に直す。空・0・不正は null(= 頼まない)。
export function parseQuantity(text) {
  const t = String(text ?? '').trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

// 発注量が入っている品目だけ [{item, quantity}] にする。量は人が決めたものだけ。
export function orderEntries(items, quantities) {
  return items
    .map((item) => ({ item, quantity: parseQuantity(quantities.get(item.id)) }))
    .filter((e) => e.quantity !== null);
}

// LINE にそのまま貼れる文面。
export function lineMessage(supplier, entries) {
  return [`${supplier.name} ご担当者さま`, 'お世話になっております。発注をお願いします。', '',
    ...entries.map((e) => `・${e.item.name} ${e.quantity}${e.item.unit}`), '', 'よろしくお願いします。'].join('\n');
}

// 電話で読み上げる一覧。
export function phoneList(entries) {
  return entries.map((e) => `${e.item.name} ${e.quantity}${e.item.unit}`);
}
