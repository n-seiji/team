// 画面共通: 日付ヘルパーと API 呼び出し。ビルド不要の素の ES module。
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function nextMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "2026-11" -> [{date:'2026-11-01', day:1, wd:0, wdLabel:'日'}, ...]
export function daysOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => {
    const wd = new Date(y, m - 1, i + 1).getDay();
    return { date: `${month}-${String(i + 1).padStart(2, '0')}`, day: i + 1, wd, wdLabel: WD[wd] };
  });
}

// ISO 8601 の文字列に書かれた時刻をそのまま読む(ブラウザのタイムゾーンに左右されない)。
export function formatReceived(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(iso || '');
  if (!m) return '';
  return `${Number(m[2])}月${Number(m[3])}日 ${Number(m[4])}時${m[5]}分`;
}

export function mdLabel(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, ownerKey } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ownerKey) headers['X-Owner-Pass'] = ownerKey;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('サーバーに届きませんでした', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* 本文なし */ }
  if (!res.ok) throw new ApiError((data && data.error) || `エラー(${res.status})`, res.status);
  return data;
}
