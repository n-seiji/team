// samples/ の画像を読み取りアダプタに通し、項目ごとの結果を一覧にする（T5 の報告用）。
// 使い方: READER=tesseract node scripts/sample-report.mjs [samples/]
// 画像は外部に送らない。精度の数字（％）は出さず、件数と母数だけを出す。
// samples/answers.json（コミットしない）に正解があれば、金額と日付を「通過／誤読／要確認」で数える。
//   形: {"cafe-1.jpg": {"kind": "カフェ", "date": "2026-10-03", "amount": 480}, ...}
import fs from 'node:fs/promises';
import path from 'node:path';
import { nullReader, normalize, FIELDS, LABELS } from '../src/reader.mjs';
import { pickReader } from '../src/tesseract.mjs';

const IMAGE = /\.(jpe?g|png|webp|heic)$/i;

export async function report(dir, reader = nullReader) {
  const files = (await fs.readdir(dir)).filter((f) => IMAGE.test(f)).sort();
  const rows = [];
  for (const file of files) {
    const buf = await fs.readFile(path.join(dir, file));
    let fields;
    const t0 = performance.now();
    try {
      fields = normalize(await reader(buf, { id: file }));
    } catch (e) {
      fields = normalize({});
      for (const f of FIELDS) fields[f].reason = `読み取りに失敗しました（${e.message}）`;
    }
    rows.push({ file, fields, seconds: (performance.now() - t0) / 1000 });
  }
  return rows;
}

// 要確認なしで正解 = 通過、要確認なしで不正解 = 誤読（確定に見える誤り）、要確認 = 要確認
export function judge(field, answer) {
  if (field.needs_review) return '要確認';
  return field.value === answer ? '通過' : '誤読';
}

export function tally(rows, answers, key) {
  const c = { 通過: 0, 誤読: 0, 要確認: 0, n: 0 };
  for (const r of rows) {
    const a = answers[r.file];
    if (!a || a[key] === undefined) continue;
    c[judge(r.fields[key], a[key])]++; c.n++;
  }
  return c;
}
const line = (label, c) => `${label}：通過${c.通過}／誤読${c.誤読}／要確認${c.要確認}（${c.n}枚中）`;

export function format(rows, answers = null) {
  const head = ['画像', ...FIELDS.map((f) => LABELS[f]), '秒'];
  const lines = [head.join('\t')];
  for (const { file, fields, seconds } of rows) {
    lines.push([file, ...FIELDS.map((f) => {
      const x = fields[f];
      const cell = x.needs_review ? `要確認(${x.reason})${x.value === '' ? '' : ' ' + x.value}` : String(x.value);
      const a = answers?.[file];
      return a && (f === 'date' || f === 'amount') && a[f] !== undefined ? `${cell} [${judge(x, a[f])}]` : cell;
    }), seconds === undefined ? '' : seconds.toFixed(1)].join('\t'));
  }
  const review = Object.fromEntries(FIELDS.map((f) => [LABELS[f], rows.filter((r) => r.fields[f].needs_review).length]));
  lines.push('', `画像 ${rows.length} 枚 / 要確認の件数: ${JSON.stringify(review)}`);
  const secs = rows.map((r) => r.seconds).filter((x) => x !== undefined);
  if (secs.length) lines.push(`1枚の秒数（実測）: 最短 ${Math.min(...secs).toFixed(1)} / 最長 ${Math.max(...secs).toFixed(1)}`);
  if (answers) {
    lines.push('', '正解との比較（samples/answers.json）', line('金額', tally(rows, answers, 'amount')), line('日付', tally(rows, answers, 'date')));
    const kinds = [...new Set(Object.values(answers).map((a) => a.kind).filter(Boolean))];
    for (const k of kinds) {
      const sub = rows.filter((r) => answers[r.file]?.kind === k);
      lines.push(`[${k}] ${line('金額', tally(sub, answers, 'amount'))} / ${line('日付', tally(sub, answers, 'date'))}`);
    }
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'samples';
  const reader = await pickReader(process.env.READER);
  const rows = await report(dir, reader).catch((e) => {
    if (e.code === 'ENOENT') { console.error(`${dir} がありません。サンプル画像を置いてください。`); process.exit(1); }
    throw e;
  });
  if (rows.length === 0) { console.error(`${dir} に画像がありません。`); process.exit(1); }
  let answers = null;
  try { answers = JSON.parse(await fs.readFile(path.join(dir, 'answers.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  console.log(`読み取り: ${reader.label ?? 'なし（全項目を要確認で返す）'}`);
  console.log(format(rows, answers));
}
