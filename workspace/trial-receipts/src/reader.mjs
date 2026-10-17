import fs from 'node:fs';

// 読み取りアダプタ。read(buffer, meta) が生の候補 {date, amount, payee, category} を返す。
// 各候補は {value, confidence, reason?}。実エンジンに替えても normalize() の規則は変わらない。
export const CATEGORIES = ['交通費', '会議費', '消耗品費', '通信費', 'その他'];
export const THRESHOLD = 0.8;

export async function nullReader() {
  const blank = { value: '', confidence: 0, reason: '未読み取り' };
  return { date: blank, amount: blank, payee: blank, category: blank };
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function isValidAmount(v) {
  return Number.isInteger(v) && v > 0 && v < 100_000_000;
}

// reason は述語の形（画面で「要確認：金額が○○」と組み立てる）
const checks = {
  date: (v) => (isValidDate(v) ? null : '不正な形式です'),
  amount: (v) => (isValidAmount(v) ? null : '不正な形式です'),
  payee: (v) => (typeof v === 'string' && v.trim() ? null : '空です'),
  category: (v) => (CATEGORIES.includes(v) ? null : '候補にありません'),
};
export const LABELS = { date: '日付', amount: '金額', payee: '支払先', category: 'カテゴリ' };
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
  if (confidence < THRESHOLD) reason = r.reason || '不確かです';
  return { value, confidence, needs_review: confidence < THRESHOLD, reason };
}

// 支払先の語 → カテゴリの候補（T12）。対応は src/category-words.json の1か所。
const WORDS = Object.entries(JSON.parse(fs.readFileSync(new URL('./category-words.json', import.meta.url), 'utf8')))
  .filter(([c]) => CATEGORIES.includes(c));
const fold = (s) => s.normalize('NFKC').toLowerCase();

// 要確認でない支払先にだけ語を当てる。当たらない・2つ以上当たる・支払先が要確認なら「その他」＋要確認。
export function suggestCategory(payee) {
  const review = (reason) => ({ value: 'その他', confidence: 0, needs_review: true, reason });
  if (!payee || payee.needs_review || payee.value === '') return review('決まりません（支払先が要確認です）');
  const name = fold(payee.value);
  const hits = WORDS.filter(([, words]) => words.some((w) => name.includes(fold(w)))).map(([c]) => c);
  if (hits.length > 1) return review('1つに決まりません（候補が複数）');
  if (!hits.length) return review('決まりません');
  return { value: hits[0], confidence: payee.confidence, needs_review: false, reason: '' };
}

export function normalize(raw) {
  const out = Object.fromEntries(FIELDS.map((f) => [f, normalizeField(f, raw?.[f])]));
  // 読み取り側がカテゴリを確定できなかったときだけ、支払先の語から候補を出す。支払先が要確認なら確定させない。
  // 何も読んでいない（未読み取り）ときは、その理由のまま残す。
  const unread = out.category.needs_review && out.category.reason === '未読み取り';
  if (!unread && (out.payee.needs_review || out.category.needs_review)) out.category = suggestCategory(out.payee);
  return out;
}

// ユーザーが手で直した値。形式NGなら例外（reasonつき）。
export function editedField(name, value) {
  if (name === 'amount' && typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
  if (typeof value === 'string') value = value.trim();
  const bad = checks[name](value);
  if (bad) throw new Error(`${LABELS[name]}が${bad}`);
  return { value, confidence: 1, needs_review: false, reason: '', edited: true };
}
