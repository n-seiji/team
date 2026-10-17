// 画面の純粋なロジック（DOM に触れない。node:test で検証する）
export const FIELD_KEYS = ['date', 'amount', 'payee', 'category'];
export const FIELD_LABELS = { date: '日付', amount: '金額', payee: '支払先', category: 'カテゴリ' };
export const CATEGORIES = ['交通費', '会議費', '消耗品費', '通信費', 'その他'];
export const MAX_SIDE = 2000;

// 長辺が max を超えるときだけ縮小したサイズを返す。拡大はしない。
export function fitSize(w, h, max = MAX_SIDE) {
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h, scaled: false };
  const r = max / long;
  return { width: Math.round(w * r), height: Math.round(h * r), scaled: true };
}

export const flaggedKeys = (r) =>
  r.status === 'done' ? FIELD_KEYS.filter((k) => r.fields?.[k]?.needs_review) : [];

export const needsReview = (r) => flaggedKeys(r).length > 0;

export function visibleReceipts(list, onlyReview) {
  return onlyReview ? list.filter(needsReview) : list;
}

// 「要確認：金額が薄くて読めません」のように、項目名と理由を文言にする
export function flagText(key, field) {
  const reason = field?.reason ? `${FIELD_LABELS[key]}：${field.reason}` : `${FIELD_LABELS[key]}を確認してください`;
  return `要確認：${reason}`;
}

export function countText(n) {
  return n === 0 ? '要確認 0件（すべて確認済み）' : `要確認 ${n}件`;
}

// 日付 YYYY-MM-DD / 金額は整数の文字列だけを通す（サーバーも検証するが、入力ミスをその場で返す）
export function validateInput(key, text) {
  const v = text.trim();
  if (key === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return '日付は 2026-03-05 の形で入力してください';
    const d = new Date(`${v}T00:00:00Z`);
    if (d.getUTCMonth() + 1 !== +m[2] || d.getUTCDate() !== +m[3]) return 'その日付は存在しません';
  }
  if (key === 'amount' && !/^\d{1,9}$/.test(v)) return '金額は数字だけで入力してください（例: 1200）';
  if (key === 'category' && !CATEGORIES.includes(v)) return 'カテゴリを選んでください';
  return '';
}
