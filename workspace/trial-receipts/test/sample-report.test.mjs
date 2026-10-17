import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { report, format, tally } from '../scripts/sample-report.mjs';

test('サンプル一覧: 画像ごとに4項目と要確認の件数が出る。例外の画像も一覧に残る', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'samples-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'a-cafe.jpg'), 'x');
  await fs.writeFile(path.join(dir, 'b-thin.jpg'), 'y');
  await fs.writeFile(path.join(dir, 'memo.txt'), 'skip');
  const reader = async (buf) => {
    if (String(buf) === 'y') throw new Error('boom');
    return {
      date: { value: '2026-10-03', confidence: 0.95 },
      amount: { value: 480, confidence: 0.6 },
      payee: { value: 'カフェ', confidence: 0.9 },
      category: { value: '飲食', confidence: 0.9 },
    };
  };
  const rows = await report(dir, reader);
  assert.deepEqual(rows.map((r) => r.file), ['a-cafe.jpg', 'b-thin.jpg']);
  assert.equal(rows[0].fields.date.needs_review, false);
  assert.equal(rows[0].fields.amount.needs_review, true);
  assert.equal(rows[0].fields.category.value, 'その他');
  assert.match(rows[1].fields.amount.reason, /読み取りに失敗しました/);
  const out = format(rows);
  assert.match(out, /画像 2 枚/);
  assert.match(out, /"金額":2/);
  assert.match(out, /"日付":1/);
});

test('正解と比べて、金額と日付を「通過／誤読／要確認」の件数と母数で出す', () => {
  const f = (value, needs_review) => ({ value, needs_review, reason: needs_review ? '不確かです' : '' });
  const fields = (date, amount) => ({ date, amount, payee: f('x', false), category: f('その他', true) });
  const rows = [
    { file: 'cafe.jpg', fields: fields(f('2026-10-03', false), f(480, false)), seconds: 2.04 },
    { file: 'taxi.jpg', fields: fields(f('2026-10-09', false), f('', true)), seconds: 3.5 },
  ];
  const answers = { 'cafe.jpg': { kind: 'カフェ', date: '2026-10-03', amount: 480 }, 'taxi.jpg': { kind: 'タクシー', date: '2026-10-08', amount: 1500 } };
  assert.deepEqual(tally(rows, answers, 'date'), { 通過: 1, 誤読: 1, 要確認: 0, n: 2 });
  const out = format(rows, answers);
  assert.match(out, /金額：通過1／誤読0／要確認1（2枚中）/);
  assert.match(out, /\[カフェ\] 金額：通過1／誤読0／要確認0（1枚中） \/ 日付：通過1／誤読0／要確認0（1枚中）/);
  assert.match(out, /最短 2\.0 \/ 最長 3\.5/);
  assert.match(out, /2026-10-09 \[誤読\]/);
});

test('answers.json の下書き: 書いた正解は残し、空欄の項目は数えない', async () => {
  const { answersSkeleton } = await import('../scripts/sample-report.mjs');
  const sk = answersSkeleton(['a.jpg', 'b.jpg'], { 'a.jpg': { kind: 'カフェ', date: '2026-10-03', amount: 480 } });
  assert.deepEqual(sk, {
    'a.jpg': { kind: 'カフェ', date: '2026-10-03', amount: 480 },
    'b.jpg': { kind: '', date: null, amount: null },
  });
  const f = (value, needs_review = false) => ({ value, needs_review });
  const rows = [
    { file: 'a.jpg', fields: { amount: f(480), date: f('2026-10-03') } },
    { file: 'b.jpg', fields: { amount: f(999), date: f('2026-01-01') } },
  ];
  assert.deepEqual(tally(rows, sk, 'amount'), { 通過: 1, 誤読: 0, 要確認: 0, n: 1 });
  assert.deepEqual(tally(rows, { ...sk, 'b.jpg': { kind: '', date: '', amount: '' } }, 'date'), { 通過: 1, 誤読: 0, 要確認: 0, n: 1 });
});
