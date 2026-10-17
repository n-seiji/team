// 単語リスト解析・テストリンク符号化・結果コード。ブラウザ標準機能のみ・依存なし。
export const MAX_WORDS = 30;
export const MAX_NICK = 12;
const DEFAULT_NICK = '名無し';
const BROKEN_LINK = 'リンクが途中で切れているようです。先生にもう一度送ってもらってください';

// ---- 単語リスト ----

// 重複判定・「覚えた」の持ち方に使う key は、ここ1か所で作る
const makeKey = (en) => en.trim().toLowerCase();

export function parseWordList(text) {
  const words = [];
  const errors = [];
  const seen = new Map(); // key -> 最初の行番号
  let truncated = false;
  const lines = String(text).split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === '') continue;
    if (words.length >= MAX_WORDS) {
      truncated = true;
      break;
    }
    const line = i + 1;
    const m = raw.search(/[,，]/);
    if (m < 0) {
      errors.push({ line, reason: 'カンマがありません' });
      continue;
    }
    const en = raw.slice(0, m).trim();
    const ja = raw.slice(m + 1).trim();
    if (en === '') { errors.push({ line, reason: '英語が空です' }); continue; }
    if (ja === '') { errors.push({ line, reason: '日本語が空です' }); continue; }
    const key = makeKey(en);
    if (seen.has(key)) {
      errors.push({ line, reason: `「${en}」が${seen.get(key)}行目と重複しています` });
      continue;
    }
    seen.set(key, line);
    words.push({ en, ja, key });
  }
  return { words, errors, truncated };
}

// ---- ハッシュ (テストID・チェック) ----

// FNV-1a 32bit。暗号ではない。内容が同じなら同じ値になるだけでよい
function fnv(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(str)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
const base36 = (n, len) => (n % 36 ** len).toString(36).padStart(len, '0');

export function testId(words) {
  return base36(fnv(words.map((w) => `${w.en}\t${w.ja}`).join('\n')), 6);
}

// ---- Google フォームの URL ----

export const MAX_FORM_URL = 300;
const FORM_REASON = 'Google フォームの URL (https://docs.google.com/forms/… か https://forms.gle/…) を入れてください';

// 空ならフォームなし。Google フォームの https URL だけを通す
export function checkFormUrl(v) {
  const t = String(v ?? '').trim();
  if (t === '') return { ok: true, value: '', reason: '' };
  if (t.length > MAX_FORM_URL) return { ok: false, value: '', reason: `${FORM_REASON}。長すぎます (${MAX_FORM_URL}文字まで)` };
  let u;
  try { u = new URL(t); } catch { return { ok: false, value: '', reason: FORM_REASON }; }
  const google = (u.hostname === 'docs.google.com' && u.pathname.startsWith('/forms/')) || u.hostname === 'forms.gle';
  if (u.protocol !== 'https:' || !google || u.username || u.password || u.port) {
    return { ok: false, value: '', reason: FORM_REASON };
  }
  return { ok: true, value: u.href, reason: '' };
}

// ---- テストリンク ----

const toB64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64Url = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipeBytes(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// フォームの URL があるときだけ {w, f} の形にする。ないときは iteration 1 と同じ配列のまま
export async function encodeTest(words, form = '') {
  const w = words.map((x) => [x.en, x.ja]);
  const json = JSON.stringify(form ? { w, f: form } : w);
  const packed = await pipeBytes(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return toB64Url(packed);
}

export async function decodeTest(s) {
  const body = String(s).trim().replace(/^#/, '');
  if (body === '') return { ok: false, reason: 'テストのデータがありません。先生から届いたリンクをそのまま開いてください' };
  try {
    const raw = await pipeBytes(fromB64Url(body), new DecompressionStream('deflate-raw'));
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    const rows = Array.isArray(data) ? data : data?.w;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_WORDS) throw new Error('shape');
    const words = rows.map((r) => {
      if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[1] !== 'string') throw new Error('shape');
      return { en: r[0], ja: r[1], key: makeKey(r[0]) };
    });
    // リンクを書き換えて別のサイトへ誘導されないよう、開く側でも確かめる。だめなら捨てる
    const f = checkFormUrl(typeof data?.f === 'string' ? data.f : '');
    return { ok: true, words, id: testId(words), form: f.ok ? f.value : '' };
  } catch {
    return { ok: false, reason: BROKEN_LINK };
  }
}

// ---- 結果コード ----
// 形式: テストID-組-番号-点数-問題数-ニックネーム-チェック4文字
// チェックはコピーミス・切れの検出用。改ざんは防げない。

export function cleanNick(nick) {
  const t = [...String(nick ?? '').replace(/[-\t\r\n]/g, '').trim()].slice(0, MAX_NICK).join('').trim();
  return t === '' ? DEFAULT_NICK : t;
}

// 全角の英数字を半角にする
const toHalf = (v) => String(v ?? '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();

// 組と番号の入力チェック。生徒の開始画面と先生の集計で同じ文言を出す
export function checkKumi(v) {
  const t = toHalf(v).toUpperCase();
  if (t === '') return { ok: false, value: '', reason: '組を入れてください' };
  if (!/^[0-9A-Z]{1,3}$/.test(t)) return { ok: false, value: '', reason: '組は3文字までの数字か英字にしてください（例: 3、2B）' };
  return { ok: true, value: t, reason: '' };
}

export function checkNo(v) {
  const t = toHalf(v);
  if (t === '') return { ok: false, value: 0, reason: '出席番号を入れてください' };
  const n = Number(t);
  if (!/^\d+$/.test(t) || n < 1 || n > 99) return { ok: false, value: 0, reason: '出席番号は1〜99の数字にしてください' };
  return { ok: true, value: n, reason: '' };
}

const check = (...parts) => base36(fnv(parts.join('-')), 4);

export function makeResultCode({ id, kumi, no, score, total, nick }) {
  if (!/^[0-9a-z]{6}$/.test(id)) throw new RangeError('id は6文字の英数字');
  if (!Number.isInteger(score) || !Number.isInteger(total) || score < 0 || total < 1 || score > total) {
    throw new RangeError('score は 0 以上 total 以下の整数');
  }
  const k = checkKumi(kumi);
  if (!k.ok) throw new RangeError(k.reason);
  const b = checkNo(no);
  if (!b.ok) throw new RangeError(b.reason);
  const n = cleanNick(nick);
  return `${id}-${k.value}-${b.value}-${score}-${total}-${n}-${check(id, k.value, b.value, score, total, n)}`;
}

export function parseResultCode(text) {
  const t = String(text).trim();
  if (t === '') return { ok: false, reason: '空の行です' };
  const parts = t.split('-');
  if (parts.length !== 7) {
    return { ok: false, reason: '形式が違います (テストID-組-番号-点数-問題数-ニックネーム-チェック の7つに分かれていません)' };
  }
  const [id, kumiRaw, noRaw, s, n, nick, chk] = parts;
  if (!/^[0-9a-z]{6}$/.test(id)) return { ok: false, reason: 'テストIDが6文字の英数字ではありません' };
  const k = checkKumi(kumiRaw);
  if (!k.ok) return { ok: false, reason: k.reason };
  const b = checkNo(noRaw);
  if (!b.ok) return { ok: false, reason: b.reason };
  if (!/^\d{1,2}$/.test(s) || !/^\d{1,2}$/.test(n)) return { ok: false, reason: '点数か問題数が数字ではありません' };
  const score = Number(s);
  const total = Number(n);
  if (total < 1 || score > total) return { ok: false, reason: '点数が問題数を超えています' };
  if (nick === '') return { ok: false, reason: 'ニックネームが空です' };
  if (chk.toLowerCase() !== check(id, k.value, b.value, score, total, nick)) {
    return { ok: false, reason: 'コピーミスか、途中で切れているようです。もう一度送ってもらってください' };
  }
  return { ok: true, id, kumi: k.value, no: b.value, score, total, nick };
}
