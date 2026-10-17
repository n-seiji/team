import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitSize, maxSideFrom, needsReview, visibleReceipts, flagText, countText, validateInput,
  fieldsFor, orderForScreen, monthOptions, totalText,
} from '../web/logic.js';

const f = (nr) => ({ value: 'x', confidence: 1, needs_review: nr, reason: '' });
const done = (nr) => ({ id: 'a', status: 'done', fields: { date: f(false), amount: f(nr), payee: f(false), category: f(false) } });

test('縮小: 長辺2000以下は拡大も縮小もしない', () => {
  assert.deepEqual(fitSize(1500, 2000), { width: 1500, height: 2000, scaled: false });
});
test('縮小: 長辺を2000にして縦横比を保つ', () => {
  assert.deepEqual(fitSize(3000, 4000), { width: 1500, height: 2000, scaled: true });
});
test('読み取り中は要確認に数えず、失敗は数える（サーバーの needs_review_count と同じ）', () => {
  assert.equal(needsReview({ status: 'reading', fields: null }), false);
  assert.equal(needsReview({ status: 'failed', fields: null }), true);
  const ok = { value: 'x', confidence: 1, needs_review: false, reason: '' };
  const fixed = { status: 'failed', fields: { date: ok, amount: ok, payee: ok, category: ok } };
  assert.equal(needsReview(fixed), false, '失敗行も4項目を直せば要確認から外れる');
  assert.equal(needsReview({ ...fixed, fields: { ...fixed.fields, amount: undefined } }), true);
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

test('失敗した行にも空欄の4項目を出し、写真を見て入力するよう促す', () => {
  const fs = fieldsFor({ status: 'failed', fields: null });
  assert.deepEqual(Object.keys(fs), ['date', 'amount', 'payee', 'category']);
  assert.equal(fs.amount.value, '');
  assert.equal(flagText('amount', fs.amount), '要確認：読み取れませんでした。写真を見て金額を入力してください');
  const ok = { value: 800, confidence: 1, needs_review: false, reason: '' };
  const half = fieldsFor({ status: 'failed', fields: { date: { value: '', needs_review: true, reason: '未読み取り' }, amount: ok } });
  assert.equal(half.amount, ok); // 直した項目はそのまま
  assert.equal(half.date.reason, '読み取り失敗');
});
test('並び順: 日付のない行（撮ったばかり）が先頭、新しい順。その下は API の日付順のまま', () => {
  const d = (id, date, created_at) => ({ id, created_at, fields: date ? { date: { value: date } } : null });
  const list = [d('a', '2026-10-01', '1'), d('b', '2026-10-05', '2'), d('c', '', '3'), d('e', '', '5')];
  assert.deepEqual(orderForScreen(list).map((r) => r.id), ['e', 'c', 'a', 'b']);
});
test('月の選択肢は日付のある行から作り、新しい月が上', () => {
  const d = (date) => ({ fields: { date: { value: date } } });
  assert.deepEqual(monthOptions([d('2026-09-30'), d('2026-10-02'), d(''), d('2026-10-20')]), ['2026-10', '2026-09']);
});
test('合計: 未確認があれば「確定ではありません」を併記する', () => {
  assert.equal(totalText({ month: '2026-10', total: 12345, total_note: '' }), '2026年10月の合計 12,345円');
  assert.equal(totalText({ month: '', total: 1200, total_note: '未確認が2件あり、合計は確定ではありません' }),
    'すべての合計 1,200円（未確認が2件あり、合計は確定ではありません）');
});

test('maxSideFrom: ?maxside で縮小の上限を切り替える（受け入れテストの比較用）', () => {
  assert.equal(maxSideFrom(null), 2000);
  assert.equal(maxSideFrom(''), 2000);
  assert.equal(maxSideFrom('0'), Infinity);
  assert.equal(maxSideFrom('3000'), 3000);
  assert.equal(maxSideFrom('abc'), 2000);
  assert.equal(maxSideFrom('100'), 2000);
  assert.deepEqual(fitSize(3000, 4000, maxSideFrom('0')), { width: 3000, height: 4000, scaled: false });
});
