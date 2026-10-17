// sw.js の FILES (オフラインのキャッシュ = npm run dist で公開するファイル) に、
// 画面が読み込むファイルが全部入っているかを確かめる。漏れると Pages やオフラインで画面が動かない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const files = JSON.parse(readFileSync('sw.js', 'utf8').match(/const FILES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));

// HTML の src/href と、JS の import をたどる
function refs(file) {
  const text = readFileSync(file, 'utf8');
  const re = file.endsWith('.html') ? /(?:src|href)="(?!https?:|#)([^"]+)"/g : /^import .* from '(\.[^']+)'/gm;
  return [...text.matchAll(re)].map((m) => normalize(join(dirname(file), m[1])));
}

test('sw.js の FILES に、3画面が読み込むファイルが全部入っている', () => {
  const need = new Set();
  const todo = ['index.html', 'teacher.html', 'test.html'];
  while (todo.length) {
    const f = todo.pop();
    if (need.has(f)) continue;
    need.add(f);
    if (/\.(html|js)$/.test(f)) todo.push(...refs(f));
  }
  const missing = [...need].filter((f) => !files.includes(f));
  assert.deepEqual(missing, []);
});
