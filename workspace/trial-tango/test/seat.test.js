import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSeat, saveSeat, checkSeat } from '../src/seat.js';
import { loadProgress } from '../src/progress.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('組・番号をそろえて通す (全角・小文字・先頭の0)', () => {
  assert.deepEqual(checkSeat('２ｂ', '07'), { ok: true, kumi: '2B', no: 7, errors: {} });
});

test('空や範囲外は、どの欄の問題かを返す', () => {
  const r = checkSeat('', '100');
  assert.equal(r.ok, false);
  assert.match(r.errors.kumi, /組/);
  assert.match(r.errors.no, /出席番号/);
  assert.deepEqual(Object.keys(checkSeat('2B', '').errors), ['no']);
  assert.deepEqual(Object.keys(checkSeat('2-B', '3').errors), ['kumi']);
});

test('T8: 学校の書き方 (2-3、2年3組) で止まり、例つきで直し方を返す', () => {
  for (const v of ['2-3', '2年3組', '2年3']) {
    const r = checkSeat(v, '14');
    assert.equal(r.ok, false, v);
    assert.match(r.errors.kumi, /例: 3、2B/, v);
  }
});

test('前回の組・番号が残り、進捗とは別のキーに置く', () => {
  const s = mem();
  assert.deepEqual(loadSeat(s), { kumi: '', no: '' });
  saveSeat(s, { kumi: '2B', no: 14 });
  assert.deepEqual(loadSeat(s), { kumi: '2B', no: '14' });
  assert.deepEqual(loadProgress(s).known, {});
  assert.equal([...s.m.keys()].some((k) => k.includes('progress')), false);
});

test('保存できない端末 (例外) でも落ちない', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepEqual(loadSeat(bad), { kumi: '', no: '' });
  assert.equal(saveSeat(bad, { kumi: '1', no: 1 }), false);
});
