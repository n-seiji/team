// 読み取りアダプタ。read(buffer, meta) が生の候補 {date, amount, vendor, category} を返す。
// 各候補は {value, confidence, reason?}。実エンジンに替えても normalize() の規則は変わらない。
export const CATEGORIES = ['交通費', '会議費', '消耗品費', '通信費', 'その他'];
export const THRESHOLD = 0.8;

export async function nullReader() {
  const blank = { value: '', confidence: 0, reason: '未読み取り' };
  return { date: blank, amount: blank, vendor: blank, category: blank };
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function isValidAmount(v) {
  return Number.isInteger(v) && v > 0 && v < 100_000_000;
}

const checks = {
  date: (v) => (isValidDate(v) ? null : '日付の形式が不正です'),
  amount: (v) => (isValidAmount(v) ? null : '金額の形式が不正です'),
  vendor: (v) => (typeof v === 'string' && v.trim() ? null : '支払先が空です'),
  category: (v) => (CATEGORIES.includes(v) ? null : 'カテゴリが候補にありません'),
};
export const FIELDS = Object.keys(checks);

const empty = (v) => v === '' || v === null || v === undefined;

// 生の候補 → 保存形式。空欄・閾値未満・形式NGは要確認。推測で埋めない。
export function normalizeField(name, raw) {
  const r = raw ?? {};
  let value = empty(r.value) ? '' : r.value;
  let confidence = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0;
  let reason = '';
  if (value === '') {
    if (name === 'category') value = 'その他';
    reason = r.reason || '未読み取り';
    return { value, confidence: 0, needs_review: true, reason };
  }
  const bad = checks[name](value);
  if (bad) {
    if (name === 'category') return { value: 'その他', confidence: 0, needs_review: true, reason: bad };
    return { value: '', confidence: 0, needs_review: true, reason: bad };
  }
  if (confidence < THRESHOLD) reason = r.reason || '確からしさが低いです';
  return { value, confidence, needs_review: confidence < THRESHOLD, reason };
}

export function normalize(raw) {
  return Object.fromEntries(FIELDS.map((f) => [f, normalizeField(f, raw?.[f])]));
}

// ユーザーが手で直した値。形式NGなら例外（reasonつき）。
export function editedField(name, value) {
  if (name === 'amount' && typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
  if (typeof value === 'string') value = value.trim();
  const bad = checks[name](value);
  if (bad) throw new Error(bad);
  return { value, confidence: 1, needs_review: false, reason: '' };
}
