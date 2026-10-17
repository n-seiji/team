import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { report, format } from '../scripts/sample-report.mjs';

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
