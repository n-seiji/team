// samples/ の画像を読み取りアダプタに通し、項目ごとの結果を一覧にする（T5 の報告用）。
// 使い方: node scripts/sample-report.mjs [samples/]
// 画像は外部に送らない。精度の数字は出さず、件数だけを数える。
import fs from 'node:fs/promises';
import path from 'node:path';
import { nullReader, normalize, FIELDS, LABELS } from '../src/reader.mjs';

const IMAGE = /\.(jpe?g|png|webp|heic)$/i;

export async function report(dir, reader = nullReader) {
  const files = (await fs.readdir(dir)).filter((f) => IMAGE.test(f)).sort();
  const rows = [];
  for (const file of files) {
    const buf = await fs.readFile(path.join(dir, file));
    let fields;
    try {
      fields = normalize(await reader(buf, { id: file }));
    } catch (e) {
      fields = normalize({});
      for (const f of FIELDS) fields[f].reason = `読み取りに失敗しました（${e.message}）`;
    }
    rows.push({ file, fields });
  }
  return rows;
}

export function format(rows) {
  const head = ['画像', ...FIELDS.map((f) => LABELS[f])];
  const lines = [head.join('\t')];
  for (const { file, fields } of rows) {
    lines.push([file, ...FIELDS.map((f) => {
      const x = fields[f];
      return x.needs_review ? `要確認(${x.reason})${x.value === '' ? '' : ' ' + x.value}` : String(x.value);
    })].join('\t'));
  }
  const review = Object.fromEntries(FIELDS.map((f) => [LABELS[f], rows.filter((r) => r.fields[f].needs_review).length]));
  lines.push('', `画像 ${rows.length} 枚 / 要確認の件数: ${JSON.stringify(review)}`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'samples';
  const rows = await report(dir).catch((e) => {
    if (e.code === 'ENOENT') { console.error(`${dir} がありません。サンプル画像を置いてください。`); process.exit(1); }
    throw e;
  });
  if (rows.length === 0) { console.error(`${dir} に画像がありません。`); process.exit(1); }
  console.log(format(rows));
}
