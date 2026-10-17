import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitSize, maxSideFrom, needsReview, visibleReceipts, flagText, countText, validateInput,
  fieldsFor, orderForScreen, monthOptions, totalText, statusText, pickStartUrl, printSheet, PRINT_HEAD,
} from '../web/logic.js';
import { qrMatrix, qrSvg } from '../web/qr.js';
import { readFileSync } from 'node:fs';

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
  assert.equal(countText(0, 3), '要確認 0件（読み取り待ち 3枚）', '待ちがあるのに確認済みとは言わない');
  assert.equal(countText(2, 3), '要確認 2件');
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

test('順番待ち: 「順番待ち（前に○枚）」と「読み取り中…」を出し分ける', () => {
  assert.equal(statusText({ status: 'queued', queue_position: 2 }), '順番待ち（前に2枚）');
  assert.equal(statusText({ status: 'queued', queue_position: 0 }), '順番待ち');
  assert.equal(statusText({ status: 'queued' }), '順番待ち');
  assert.equal(statusText({ status: 'reading' }), '読み取り中…');
  assert.equal(statusText(done(false)), '');
});
test('順番待ち: 待っている間も空欄で入力でき、⚠ はまだ出さない。直した欄は残る', () => {
  const mine = { value: '5000', confidence: 1, needs_review: false, reason: '', edited: true };
  const blank = { value: '', confidence: 0, needs_review: true, reason: '未読み取り' };
  const r = { status: 'queued', queue_position: 1, fields: { date: blank, amount: mine, payee: blank, category: blank } };
  const f = fieldsFor(r);
  assert.equal(f.amount.value, '5000');
  assert.equal(f.date.value, '');
  assert.equal(f.date.needs_review, false);
  assert.equal(needsReview(r), false);
  assert.equal(fieldsFor({ status: 'reading', fields: null }).payee.value, '');
});

test('/start: スマホから開いていればその URL、PC の localhost なら LAN の 192.168 を優先', () => {
  const urls = ['http://172.17.0.1:3000/', 'http://192.168.1.23:3000/', 'http://10.0.0.5:3000/'];
  assert.deepEqual(pickStartUrl({ urls, origin: 'http://localhost:3000', hostname: 'localhost' }),
    { url: 'http://192.168.1.23:3000/', others: ['http://10.0.0.5:3000/', 'http://172.17.0.1:3000/'] });
  assert.equal(pickStartUrl({ urls, origin: 'http://10.0.0.5:3000', hostname: '10.0.0.5' }).url, 'http://10.0.0.5:3000/');
  assert.equal(pickStartUrl({ urls, override: 'http://192.168.43.1:3000/', origin: 'http://localhost:3000', hostname: 'localhost' }).url, 'http://192.168.43.1:3000/');
  assert.equal(pickStartUrl({ urls: [], origin: 'http://localhost:3000', hostname: 'localhost' }).url, 'http://localhost:3000/');
});
test('QR: 型番に合った大きさで、3隅に位置検出パターンがある（デコードの確認は README 参照）', () => {
  const m = qrMatrix('http://192.168.1.23:3000/');
  assert.equal(m.length, 25); // 2型 = 25x25
  const finder = (r0, c0) => [0, 1, 2, 3, 4, 5, 6].map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) => (m[r0 + r][c0 + c] ? 1 : 0)).join('')).join('/');
  const want = '1111111/1000001/1011101/1011101/1011101/1000001/1111111';
  assert.equal(finder(0, 0), want);
  assert.equal(finder(0, 18), want);
  assert.equal(finder(18, 0), want);
  assert.equal(qrMatrix('x'.repeat(150)).length, 49); // 8型
  assert.throws(() => qrMatrix('x'.repeat(300)), /入りきりません/);
  assert.match(qrSvg('http://a/"<'), /aria-label="http:\/\/a\/&quot;&lt; の QR コード"/);
});

test('印刷: 5列と合計だけ。id や /receipts/… は出ない。未確認があれば注記も出る', () => {
  const ok = (v) => ({ value: v, confidence: 1, needs_review: false, reason: '' });
  const table = {
    month: '2026-10', total: 6200, total_note: '未確認が1件あり、合計は確定ではありません',
    receipts: [
      { id: 'abc-123', status: 'done', image_url: '/receipts/abc-123/image', fields: { date: ok('2026-10-03'), amount: ok('5000'), payee: ok('タクシー'), category: ok('交通費') } },
      { id: 'def-456', status: 'done', image_url: '/receipts/def-456/image', fields: { date: ok('2026-10-07'), amount: { value: '', confidence: 0.2, needs_review: true, reason: '薄くて読めません' }, payee: ok('カフェ'), category: ok('会議費') } },
    ],
  };
  const s = printSheet(table);
  assert.deepEqual(s.head, PRINT_HEAD);
  assert.deepEqual(s.head, ['日付', '金額', '支払先', 'カテゴリ', '要確認']);
  assert.deepEqual(s.rows[0], ['2026-10-03', '5,000円', 'タクシー', '交通費', '']);
  assert.deepEqual(s.rows[1], ['2026-10-07', '', 'カフェ', '会議費', '要確認']);
  assert.equal(s.title, '2026年10月の経費（領収書 2枚）');
  assert.equal(s.total, '合計 6,200円');
  assert.equal(s.note, '未確認が1件あり、合計は確定ではありません');
  const text = JSON.stringify(s);
  assert.ok(!text.includes('abc-123') && !text.includes('/receipts/'), 'id と画像のパスは紙に出さない');
  assert.equal(printSheet({ ...table, total_note: '' }).note, '');
});
test('字の大きさ: 項目名と入力欄は 16px 以上。印刷では表以外を隠す', () => {
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  const px = (sel) => Number(new RegExp(`${sel.replace(/[.*]/g, '\\$&')} \\{[^}]*font-size: (\\d+)px`).exec(css)?.[1]);
  assert.ok(px('.field label') >= 16, '項目名');
  assert.ok(px('.monthbar label') >= 16, '月の項目名');
  assert.match(css, /body \{[^}]*font: 16px/, '入力欄は font: inherit で 16px を受け継ぐ');
  assert.match(css, /\.field input, \.field select \{[^}]*font: inherit/);
  assert.match(css, /@media print \{[\s\S]*body > \*:not\(\.printout\) \{ display: none !important; \}/);
});
