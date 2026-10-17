// GitHub Pages に置くファイルだけを dist/ に集める。依存なし。
// 置くファイルは sw.js の FILES と同じにする (オフライン用のキャッシュと公開物をずらさないため)。
import { readFileSync, rmSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = process.argv[2] || 'dist';
const m = readFileSync('sw.js', 'utf8').match(/const FILES = (\[[^\]]*\])/);
if (!m) throw new Error('sw.js に FILES が見つかりません');
const files = JSON.parse(m[1].replace(/'/g, '"')).filter((f) => f !== './');
const all = [...files, 'sw.js'];

const missing = all.filter((f) => !existsSync(f));
if (missing.length) { console.error('見つからないファイル:', missing.join(', ')); process.exit(1); }

rmSync(OUT, { recursive: true, force: true });
for (const f of all) {
  mkdirSync(dirname(join(OUT, f)), { recursive: true });
  copyFileSync(f, join(OUT, f));
}
writeFileSync(join(OUT, '.nojekyll'), ''); // Pages の Jekyll 処理を止める
console.log(`${OUT}/ に ${all.length} ファイルを置きました:\n` + all.map((f) => '  ' + f).join('\n'));
