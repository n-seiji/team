// ローカルの tesseract CLI で読む読み取りアダプタ（T5）。npm の依存なし、画像は外に出さない。
// 起動: READER=tesseract node src/server.mjs（tesseract と日本語データ jpn が必要）
// 出す確からしさは tesseract の単語ごとの conf（0〜100）の最小値。閾値で要確認にするのは normalize() の仕事。
import { execFile } from 'node:child_process';
import { nullReader, isValidDate, isValidAmount } from './reader.mjs';

const TIMEOUT_MS = 60_000;

function run(args, input) {
  return new Promise((resolve, reject) => {
    const p = execFile('tesseract', args, { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, out, errOut) => {
      if (err) return reject(new Error(err.killed ? '読み取りが60秒を超えました' : (errOut || err.message).trim().split('\n').pop()));
      resolve(out);
    });
    if (input) p.stdin.end(input);
  });
}

// READER=tesseract のときだけ使う。入っていなければ、全項目要確認のアダプタに戻る。
export async function pickReader(name) {
  if (name !== 'tesseract') return nullReader;
  try {
    const langs = await run(['--list-langs']);
    if (!/^jpn$/m.test(langs)) throw new Error('日本語データ（jpn）がありません');
  } catch (e) {
    console.warn(`tesseract が使えません（${e.message}）。全項目を要確認で返します`);
    return nullReader;
  }
  return tesseractReader;
}

export async function tesseractReader(buffer) {
  if (isHeic(buffer)) throw new Error('HEIC の写真は読み取れません。写真を見て入力してください');
  const tsv = await run(['stdin', 'stdout', '-l', 'jpn+eng', '--psm', '6', 'tsv'], buffer);
  return extract(parseTsv(tsv));
}
tesseractReader.label = 'tesseract（ローカル）';

const isHeic = (b) => b.length > 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)$/.test(b.toString('latin1', 8, 12));

// TSV（level 5 = 単語）を行ごとにまとめる。text は空白を詰めた文字列、conf は単語の conf の最小値。
export function parseTsv(tsv) {
  const lines = new Map();
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5' || !c[11].trim()) continue;
    const key = `${c[2]}-${c[3]}-${c[4]}`;
    const l = lines.get(key) ?? { words: [] };
    l.words.push({ text: c[11].trim(), conf: Number(c[10]) });
    lines.set(key, l);
  }
  return [...lines.values()].map(({ words }) => ({
    text: words.map((w) => w.text).join(''),
    conf: Math.min(...words.map((w) => w.conf)) / 100,
  }));
}

const blank = (reason) => ({ value: '', confidence: 0, reason });
const toHalf = (s) => s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[，]/g, ',').replace(/[／]/g, '/');

// 合計の行の金額。候補が食い違えば要確認。小計・税・お預り・お釣りの行は見ない。
const TOTAL = /合計|お買上|お買い上げ|ご請求|領収金額|お支払|運賃|料金/;
const NOT_TOTAL = /小計|税|対象|預|釣|割引|ポイント/;
export function findAmount(lines) {
  const found = [];
  for (const l of lines) {
    const t = toHalf(l.text);
    if (!TOTAL.test(t) || NOT_TOTAL.test(t)) continue;
    const nums = t.match(/[¥￥\\]?\d[\d,.]*(?:円)?/g); // 「.」も拾ってから弾く（「\1.500」を 500 と読まない）
    if (!nums) continue;
    const raw = nums[nums.length - 1].replace(/[¥￥\\円]/g, '').replace(/[.,]$/, '');
    // 「1,2O0」「12.00」のような形は数にしない（確定に見える誤りを作らない）
    if (!/^\d{1,3}(,\d{3})+$|^\d+$/.test(raw)) { found.push({ bad: true }); continue; }
    found.push({ value: Number(raw.replace(/,/g, '')), conf: l.conf });
  }
  if (!found.length) return blank('合計の行に見つかりません');
  if (found.some((f) => f.bad)) return blank('はっきり読めません');
  const values = new Set(found.map((f) => f.value));
  if (values.size > 1) return blank('2つ以上の値に読めます');
  const v = found[0].value;
  if (!isValidAmount(v)) return blank('はっきり読めません');
  return { value: v, confidence: Math.min(...found.map((f) => f.conf)) };
}

// 西暦（2026年10月3日 / 2026/10/03 / 2026-10-3）と令和。候補が食い違えば要確認。
export function findDate(lines) {
  const found = [];
  for (const l of lines) {
    const t = toHalf(l.text);
    for (const m of t.matchAll(/(20\d{2})[年/.\-](\d{1,2})[月/.\-](\d{1,2})/g)) found.push({ y: +m[1], m: +m[2], d: +m[3], conf: l.conf });
    for (const m of t.matchAll(/(?:令和|R)(\d{1,2})[年/.](\d{1,2})[月/.](\d{1,2})/g)) found.push({ y: 2018 + +m[1], m: +m[2], d: +m[3], conf: l.conf });
  }
  if (!found.length) return blank('見つかりません');
  const iso = (f) => `${f.y}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`;
  const values = new Set(found.map(iso));
  if (values.size > 1) return blank('2つ以上の値に読めます');
  const v = iso(found[0]);
  if (!isValidDate(v)) return blank('はっきり読めません');
  return { value: v, confidence: Math.min(...found.map((f) => f.conf)) };
}

// 支払先は先頭の、数字や記号だけではない行。
export function findPayee(lines) {
  const l = lines.find((x) => (x.text.match(/[\p{L}]/gu) ?? []).length >= 2 && !/領収|レシート|receipt/i.test(x.text));
  return l ? { value: l.text.slice(0, 40), confidence: l.conf } : blank('見つかりません');
}

// カテゴリはキーワードで1つに決まるときだけ。決まらなければ空欄（→「その他」＋要確認）。
const CATEGORY_WORDS = [
  ['交通費', /タクシー|交通|乗車|運賃|迎車|JR|Suica|PASMO|駐車/i],
  ['会議費', /カフェ|珈琲|コーヒー|喫茶|COFFEE|CAFE|スターバックス|ドトール|タリーズ/i],
  ['通信費', /通信|携帯|インターネット|月額|プラン|サブスク|ソフトバンク|docomo|\bau\b/i],
  ['消耗品費', /文具|事務用品|コピー用紙|ボールペン|乾電池|ホームセンター/i],
];
export function findCategory(lines) {
  const text = lines.map((l) => l.text).join('\n');
  const hits = CATEGORY_WORDS.filter(([, re]) => re.test(text)).map(([c]) => c);
  if (hits.length !== 1) return blank(hits.length ? '1つに決まりません（候補が複数）' : '決まりません');
  return { value: hits[0], confidence: 0.85 }; // 仮の値。実サンプルで誤りが出たら下げる
}

export function extract(lines) {
  return { date: findDate(lines), amount: findAmount(lines), payee: findPayee(lines), category: findCategory(lines) };
}

