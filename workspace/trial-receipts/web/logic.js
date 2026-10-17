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

// 受け入れテストで縮小前後を比べるための切り替え（?maxside=0 で縮小しない、?maxside=3000 など）。
// 数字でない・小さすぎる値は既定の MAX_SIDE に戻す。0 は「縮小しない」= Infinity。
export function maxSideFrom(param) {
  if (param == null || param === '') return MAX_SIDE;
  const n = Number(param);
  if (n === 0) return Infinity;
  return Number.isInteger(n) && n >= 500 ? n : MAX_SIDE;
}

// 失敗した行も、写真を見てその場で入力できるように空欄の4項目を用意する。
export const FAILED_REASON = '読み取り失敗';
// サーバーが空欄の fields を付けて返す場合も、未修正の項目は「読み取れなかった」と伝える。
export function fieldsFor(r) {
  if (isPending(r)) return pendingFields(r);
  if (r.status !== 'failed') return r.fields;
  return Object.fromEntries(FIELD_KEYS.map((k) => {
    const f = r.fields?.[k];
    if (f && !f.needs_review) return [k, f];
    return [k, { value: f?.value ?? '', confidence: 0, needs_review: true, reason: FAILED_REASON }];
  }));
}

// 順番待ち・読み取り中の行。読み取りを待たずに手で入れられるよう空欄を出すが、⚠ はまだ出さない。
// 手で直した欄（edited）はそのまま。読み取り結果が届いても上書きされない（サーバー側の約束）。
export const isPending = (r) => r.status === 'queued' || r.status === 'reading';
function pendingFields(r) {
  return Object.fromEntries(FIELD_KEYS.map((k) => {
    const f = r.fields?.[k];
    return [k, f?.edited ? f : { value: '', confidence: 0, needs_review: false, reason: '' }];
  }));
}

// 「順番待ち（前に2枚）」「読み取り中…」。queue_position は前にある枚数（読み取り中の1枚を含む）。
export function statusText(r) {
  if (r.status === 'reading') return '読み取り中…';
  if (r.status !== 'queued') return '';
  const n = r.queue_position;
  return Number.isInteger(n) && n > 0 ? `順番待ち（前に${n}枚）` : '順番待ち';
}

export const flaggedKeys = (r) =>
  isPending(r) ? [] : FIELD_KEYS.filter((k) => fieldsFor(r)?.[k]?.needs_review);

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

// waiting: 順番待ち・読み取り中の枚数。待ちがあるのに「すべて確認済み」とは言わない。
export function countText(n, waiting = 0) {
  if (n === 0) return waiting ? `要確認 0件（読み取り待ち ${waiting}枚）` : '要確認 0件（すべて確認済み）';
  return `要確認 ${n}件`;
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

// /start で QR にする URL を選ぶ。?url= の指定が最優先。スマホから開いているならその URL。
// LAN の候補が複数あるときは家庭・事務所の Wi-Fi でよく使う 192.168.* → 10.* → 172.* の順。
export function pickStartUrl({ override, urls = [], origin, hostname }) {
  const rank = (u) => { const h = new URL(u).hostname; return h.startsWith('192.168.') ? 0 : h.startsWith('10.') ? 1 : h.startsWith('172.') ? 2 : 3; };
  const lan = [...urls].sort((a, b) => rank(a) - rank(b));
  const local = /^(localhost|127\.|\[?::1)/.test(hostname);
  const url = override || (!local ? `${origin}/` : lan[0] ?? `${origin}/`);
  return { url, others: lan.filter((u) => u !== url) };
}

// 合計に入っていない行（金額が空欄）。先生は合計の数字だけを見るので、合計の横に枚数を出す（T11）。
// 読み取り待ちの行もまだ金額がなく、合計に入っていないので数える。
const hasAmount = (r) => { const v = r.fields?.amount?.value; return v !== '' && v != null; };
export const noAmountCount = (receipts = []) => receipts.filter((r) => !hasAmount(r)).length;
export const noAmountText = (n) => (n ? `金額が入っていない領収書 ${n}枚（合計に入っていません）` : '');

// 紙の「要確認」の列に出す項目名。カテゴリは先生に通じる「分類」と書く。
export const PRINT_FLAG_LABELS = { date: '日付', amount: '金額', payee: '支払先', category: '分類' };
// カテゴリが要確認のままなら「その他」と書かない。決まった分類に見えてしまうため（CSV も同じ文言）。
export const UNCLASSIFIED = '未分類（要確認）';

// 印刷用の表（先生が綴じる紙）。日付・金額・支払先・カテゴリ・要確認の5列と合計だけ。id や画像のパスは出さない。
export const PRINT_HEAD = ['日付', '金額', '支払先', 'カテゴリ', '要確認'];
export function printSheet({ month, receipts = [], total = 0, total_note = '' }) {
  const rows = receipts.map((r) => {
    const f = fieldsFor(r) ?? {};
    const amount = f.amount?.value;
    const flags = flaggedKeys(r);
    return [
      f.date?.value || '（日付なし）',
      amount ? yen(amount) : '',
      f.payee?.value || '',
      flags.includes('category') ? UNCLASSIFIED : f.category?.value || '',
      isPending(r) ? '読み取り中' : flags.map((k) => PRINT_FLAG_LABELS[k]).join('・'),
    ];
  });
  return {
    title: `${month ? monthLabel(month) : 'すべて'}の経費（領収書 ${rows.length}枚）`,
    head: PRINT_HEAD,
    rows,
    total: `合計 ${yen(total)}`,
    no_amount: noAmountText(noAmountCount(receipts)),
    note: total_note,
  };
}

// ---- T9: 日付か金額で元の写真を探す ----
// 「5000」「5,000円」「¥5000」は金額、「10/3」「10月3日」「2026-10-03」は日付として読む。
// 年を書かなければ、どの年の 10/3 でも当てる。読めない文字列は null（全件表示のまま）。
export function parseQuery(text) {
  const s = String(text ?? '').normalize('NFKC').trim().replace(/\s+/g, '');
  if (!s) return null;
  let m = s.match(/^(?:(\d{4})[-/年.])?(\d{1,2})[-/月.](\d{1,2})日?$/);
  if (m) {
    const [, y, mo, d] = m.map((x) => (x === undefined ? null : Number(x)));
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { kind: 'date', year: y, month: mo, day: d };
    return null;
  }
  m = s.match(/^[¥\\]?(\d{1,3}(?:,\d{3})+|\d+)円?$/);
  if (m) return { kind: 'amount', amount: Number(m[1].replace(/,/g, '')) };
  return null;
}

export function queryLabel(q) {
  if (!q) return '';
  if (q.kind === 'amount') return yen(q.amount);
  return `${q.year ? `${q.year}年` : ''}${q.month}月${q.day}日`;
}

export function matchesQuery(r, q) {
  const f = fieldsFor(r) || {};
  if (q.kind === 'amount') {
    const v = String(f.amount?.value ?? '').replace(/,/g, '');
    return v !== '' && Number(v) === q.amount;
  }
  const d = String(f.date?.value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) return false;
  return Number(d[2]) === q.month && Number(d[3]) === q.day && (!q.year || Number(d[1]) === q.year);
}

export const isUndated = (r) => !fieldsFor(r)?.date?.value;

// 探すときは月や「要確認だけ」に関係なく、全件から探す（先生に聞かれる月は今見ている月とは限らない）。
export function searchReceipts(all, text) {
  const q = parseQuery(text);
  if (!q) return { query: null, rows: all, undated: 0 };
  const rows = all.filter((r) => matchesQuery(r, q));
  return { query: q, rows, undated: all.filter(isUndated).length };
}

export function searchText({ query, rows, undated }) {
  if (!query) return '';
  if (rows.length) return `${queryLabel(query)}：${rows.length}枚見つかりました。写真をタップすると原寸で開きます`;
  return undated ? `見つかりません。日付が入っていない領収書が${undated}枚あります` : `見つかりません（${queryLabel(query)}）`;
}
