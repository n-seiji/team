// 先生用の関数 (T2 リンク作成 / T4 集計・CSV)。画面なしで Node でも動く。通信はしない。
import { parseWordList, encodeTest, testId, parseResultCode, checkFormUrl } from './tango.js';

export const CSV_BOM = '﻿';

// ---- T2: テストリンク ----

// 貼られた単語リストからテストリンクを作る。有効な行が0か、フォームの URL がだめならリンクは作らない。
export async function buildTestLink(text, baseUrl, formUrl = '') {
  const { words, errors, truncated } = parseWordList(text);
  if (words.length === 0) {
    return { ok: false, reason: '有効な行がありません。「英語,日本語」の形で1行ずつ書いてください', errors, truncated, words };
  }
  const f = checkFormUrl(formUrl);
  if (!f.ok) return { ok: false, reason: f.reason, errors, truncated, words };
  const packed = await encodeTest(words, f.value);
  return { ok: true, url: `${baseUrl}#${packed}`, id: testId(words), form: f.value, words, errors, truncated };
}

// ---- T4: 結果コードの集計 ----

// 1行から結果コードを探す。Google フォームの回答をコピーした行はタブ区切りなので、セルごとに試す。
// looksLike: コードらしいセルがあったか (見出し行の判定に使う)
// at: 同じ行にフォームのタイムスタンプがあれば、その文字列 (なければ '')
export function findResultCode(raw) {
  let found = null;
  let code = null;
  let at = '';
  for (const cell of String(raw).split('\t')) {
    const t = cell.trim().replace(/^"(.*)"$/, '$1').trim();
    if (t === '') continue;
    if (!at && TIME.test(t)) { at = t; continue; }
    if (code) continue;
    const r = parseResultCode(t);
    if (r.ok) code = { ...r, code: t, looksLike: true };
    else if (!found && /^[0-9a-z]{6}-/i.test(t)) found = { ok: false, reason: r.reason, looksLike: true };
  }
  if (code) return { ...code, at };
  return found ?? { ok: false, reason: '結果コードが見つかりません', looksLike: false };
}

// Google フォームのタイムスタンプ (例: 2026/10/19 8:01:02)。年月日と時刻があるものだけ。
const TIME = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

// 並べ替え用に桁をそろえる (8:01 と 13:02 を正しく比べるため)
function timeKey(at) {
  const m = TIME.exec(at);
  return m ? m.slice(1).map((x) => (x ?? '00').padStart(2, '0')).join('') : '';
}

// 組→番号の順。同じ組・番号の中は、時刻があれば先に出した順、なければ貼った順
const byKumiNo = (a, b) =>
  a.kumi.localeCompare(b.kumi, 'en', { numeric: true }) || a.no - b.no ||
  (a.at && b.at ? timeKey(a.at).localeCompare(timeKey(b.at)) : 0) || a.line - b.line;

// 貼られた複数行を集計する。idを省略すると、いちばん多いテストIDを使う (同数なら先に出た方)。
export function aggregateResults(text, wantedId) {
  const parsed = [];
  const skipped = [];
  let first = true;
  String(text).split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    const r = findResultCode(raw);
    // 1行目にコードらしいものがなければ、フォームの見出しとみなして黙って飛ばす
    const header = first && !r.looksLike;
    first = false;
    if (r.ok) parsed.push({ line, ...r });
    else if (!header) skipped.push({ line, text: raw.trim(), reason: r.reason });
  });

  const counts = new Map();
  for (const p of parsed) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  const ids = [...counts.keys()];
  const id = wantedId ?? ids.reduce((best, k) => (best === null || counts.get(k) > counts.get(best) ? k : best), null);

  const rows = [];
  const seen = new Set();
  let total = null;
  for (const p of parsed) {
    if (p.id !== id) {
      skipped.push({ line: p.line, text: p.code, reason: `別のテスト (${p.id}) のコードです` });
    } else if (seen.has(p.code)) {
      skipped.push({ line: p.line, text: p.code, reason: '同じコードがすでにあります' });
    } else if (total !== null && p.total !== total) {
      skipped.push({ line: p.line, text: p.code, reason: `問題数が他と違います (${p.total}問。ほかは${total}問)` });
    } else {
      total ??= p.total;
      seen.add(p.code);
      rows.push({ line: p.line, kumi: p.kumi, no: p.no, nick: p.nick, score: p.score, total: p.total, dup: false, at: p.at });
    }
  }
  // 同じ組・番号が2件以上なら、両方残して印を付ける (やり直し・番号の打ち間違い)
  const perSeat = new Map();
  for (const r of rows) perSeat.set(`${r.kumi}-${r.no}`, (perSeat.get(`${r.kumi}-${r.no}`) ?? 0) + 1);
  for (const r of rows) r.dup = perSeat.get(`${r.kumi}-${r.no}`) > 1;
  rows.sort(byKumiNo);
  skipped.sort((a, b) => a.line - b.line);
  const average = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : null;
  return { id: id ?? null, ids, rows, skipped, average, total, hasTime: rows.some((r) => r.at) };
}

// ---- T4: CSV ----

// 先頭が = + - @ のセルは Excel が式として実行するので ' を付ける。
export function csvCell(value) {
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 番号・点数・問題数は数値のまま書くので、Excel で番号順に並べ替えられる
// 提出時刻はフォームから貼ったときだけ入る。列は常に出す (列の位置が変わらないように)
export function toCsv(rows) {
  const lines = [['組', '番号', 'ニックネーム', '点数', '問題数', '同じ番号', '提出時刻'],
    ...rows.map((r) => [r.kumi, r.no, r.nick, r.score, r.total, r.dup ? '2回以上' : '', r.at ?? ''])];
  return CSV_BOM + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
