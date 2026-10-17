import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSize, needsReview, visibleReceipts, flagText, countText, validateInput } from '../web/logic.js';

const f = (nr) => ({ value: 'x', confidence: 1, needs_review: nr, reason: '' });
const done = (nr) => ({ id: 'a', status: 'done', fields: { date: f(false), amount: f(nr), payee: f(false), category: f(false) } });

test('縮小: 長辺2000以下は拡大も縮小もしない', () => {
  assert.deepEqual(fitSize(1500, 2000), { width: 1500, height: 2000, scaled: false });
});
test('縮小: 長辺を2000にして縦横比を保つ', () => {
  assert.deepEqual(fitSize(3000, 4000), { width: 1500, height: 2000, scaled: true });
});
test('読み取り中・失敗の行は要確認に数えない', () => {
  assert.equal(needsReview({ status: 'reading', fields: null }), false);
  assert.equal(needsReview(done(true)), true);
  assert.equal(needsReview(done(false)), false);
});
test('絞り込み: 要確認の行だけ残る', () => {
  const list = [done(true), done(false)];
  assert.equal(visibleReceipts(list, true).length, 1);
  assert.equal(visibleReceipts(list, false).length, 2);
});
test('文言: 色に頼らず「要確認：金額が薄くて読めません」と出る', () => {
  assert.equal(flagText('amount', { reason: '薄くて読めません' }), '要確認：金額が薄くて読めません');
  assert.equal(flagText('date', { reason: '未読み取り' }), '要確認：日付はまだ読み取られていません');
});
test('件数表示', () => {
  assert.equal(countText(3), '要確認 3件');
  assert.match(countText(0), /すべて確認済み/);
});
test('入力検証', () => {
  assert.equal(validateInput('date', '2026-02-30'), 'その日付は存在しません');
  assert.equal(validateInput('date', '2026-03-05'), '');
  assert.notEqual(validateInput('amount', '12,00'), '');
  assert.equal(validateInput('amount', ' 1200 '), '');
  assert.notEqual(validateInput('category', '食費'), '');
});
