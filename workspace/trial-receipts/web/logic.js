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

// 失敗した行も、写真を見てその場で入力できるように空欄の4項目を用意する。
export const FAILED_REASON = '読み取り失敗';
// サーバーが空欄の fields を付けて返す場合も、未修正の項目は「読み取れなかった」と伝える。
export function fieldsFor(r) {
  if (r.status !== 'failed') return r.fields;
  return Object.fromEntries(FIELD_KEYS.map((k) => {
    const f = r.fields?.[k];
    if (f && !f.needs_review) return [k, f];
    return [k, { value: f?.value ?? '', confidence: 0, needs_review: true, reason: FAILED_REASON }];
  }));
}

export const flaggedKeys = (r) =>
  r.status === 'reading' ? [] : FIELD_KEYS.filter((k) => fieldsFor(r)?.[k]?.needs_review);

// サーバーと同じ数え方（d9f3796）: 読み取り中は数えない。失敗した行も項目の要確認だけで決める。
export const needsReview = (r) => flaggedKeys(r).length > 0;

// 画面の並び順。日付がまだない行（撮ったばかり・読み取り中・失敗）を先頭に新しい順で出し、
// その下は API の順（日付順）のまま。撮った直後の行が一覧の末尾に消えないようにする。
export function orderForScreen(list) {
  const undated = list.filter((r) => !r.fields?.date?.value).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return [...undated, ...list.filter((r) => r.fields?.date?.value)];
}

// 月の選択肢。日付のある行から YYYY-MM を集め、新しい月が上。
export function monthOptions(list) {
  return [...new Set(list.map((r) => r.fields?.date?.value?.slice(0, 7)).filter(Boolean))].sort().reverse();
}

export const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;

export function monthLabel(m) {
  const [y, mo] = m.split('-');
  return `${y}年${Number(mo)}月`;
}

// 合計の行。未確認があるときは「確定ではない」をはっきり出す（total_note はサーバーの文言）。
export function totalText({ month, total, total_note }) {
  const head = `${month ? monthLabel(month) : 'すべて'}の合計 ${yen(total)}`;
  return total_note ? `${head}（${total_note}）` : head;
}

export function visibleReceipts(list, onlyReview) {
  return onlyReview ? list.filter(needsReview) : list;
}

// 「要確認：金額が薄くて読めません」。reason は述語の形（「空です」「不正な形式です」「不確かです」）で受け取る。
// 「未読み取り」（最初のアダプタの固定語）と画面側の「読み取り失敗」だけは、自然な文にする。
export function flagText(key, field) {
  const label = FIELD_LABELS[key];
  const reason = field?.reason;
  if (!reason) return `要確認：${label}を確認してください`;
  if (reason === '未読み取り') return `要確認：${label}はまだ読み取られていません`;
  if (reason === FAILED_REASON) return `要確認：読み取れませんでした。写真を見て${label}を入力してください`;
  return `要確認：${label}が${reason}`;
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
