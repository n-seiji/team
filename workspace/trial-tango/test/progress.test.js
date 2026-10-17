import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, markKnown, countKnown, exportCode, importCode, loadProgress, saveProgress } from '../src/progress.js';

const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };

test('覚えた数は key ごとで、同じ単語を二度数えない', () => {
  let p = markKnown(markKnown(emptyProgress(), 'run'), 'run');
  assert.equal(countKnown(p), 1);
});
test('保存して読み直しても残る', () => {
  const s = mem();
  saveProgress(s, { ...markKnown(emptyProgress(), 'apple'), pos: 3 });
  const p = loadProgress(s);
  assert.equal(countKnown(p), 1); assert.equal(p.pos, 3);
});
test('壊れた保存データでも空で始まる', () => {
  const s = mem(); s.setItem('trial-tango:progress:v1', '{{');
  assert.equal(countKnown(loadProgress(s)), 0);
});
test('書き出して貼ると元に戻る (日本語キー含む)', () => {
  let p = markKnown(markKnown(emptyProgress(), 'run'), 'café');
  const r = importCode(emptyProgress(), exportCode(p));
  assert.ok(r.ok); assert.equal(countKnown(r.progress), 2);
});
test('古いコードを貼っても数は減らない', () => {
  const old = exportCode(markKnown(emptyProgress(), 'a'));
  let now = markKnown(markKnown(emptyProgress(), 'a'), 'b');
  const r = importCode(now, old);
  assert.equal(countKnown(r.progress), 2); assert.equal(r.added, 0);
});
test('切れたコード・違う文字列は理由つきで失敗する', () => {
  const c = exportCode(markKnown(emptyProgress(), 'apple'));
  assert.equal(importCode(emptyProgress(), c.slice(0, -4)).ok, false);
  assert.equal(importCode(emptyProgress(), 'hello').ok, false);
});
