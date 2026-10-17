import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { createLedger } from '../src/ledger.js';

const members = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];
const fresh = () => {
  const file = join(mkdtempSync(join(tmpdir(), 'kakeibo-')), 'ledger.json');
  return { file, ledger: createLedger({ store: openStore(file), members }) };
};
const rejects = (fn, code) =>
  assert.throws(fn, (e) => e.code === code && typeof e.message === 'string' && e.message.length > 0);

test('最小入力（金額と払った人）で保存でき、負担者は全員・区分は家庭・日付は今日', () => {
  const { ledger } = fresh();
  const e = ledger.create({ amount: 1000, payerId: 'a' });
  assert.deepEqual(e.participantIds, ['a', 'b', 'c']);
  assert.equal(e.category, 'home');
  assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('再起動（再読み込み）後も残る', () => {
  const { file, ledger } = fresh();
  ledger.create({ amount: 500, payerId: 'b', memo: '洗剤' });
  const again = createLedger({ store: openStore(file), members });
  assert.equal(again.list().entries[0].memo, '洗剤');
  assert.equal(again.create({ amount: 1, payerId: 'a' }).id, 2);
});

test('保存後に一時ファイルが残らない', () => {
  const { file, ledger } = fresh();
  ledger.create({ amount: 500, payerId: 'b' });
  assert.deepEqual(readdirSync(join(file, '..')), ['ledger.json']);
});

test('0円・負数・空・小数・文字列は理由付きで拒否', () => {
  const { ledger } = fresh();
  rejects(() => ledger.create({ amount: 0, payerId: 'a' }), 'amount_not_positive');
  rejects(() => ledger.create({ amount: -5, payerId: 'a' }), 'amount_not_positive');
  rejects(() => ledger.create({ payerId: 'a' }), 'amount_required');
  rejects(() => ledger.create({ amount: '', payerId: 'a' }), 'amount_required');
  rejects(() => ledger.create({ amount: 10.5, payerId: 'a' }), 'amount_invalid');
  rejects(() => ledger.create({ amount: '1000', payerId: 'a' }), 'amount_invalid');
  assert.equal(ledger.list().entries.length, 0);
});

test('払った人の未指定・不明、負担者の空、区分・日付の不正を拒否', () => {
  const { ledger } = fresh();
  rejects(() => ledger.create({ amount: 100 }), 'payer_required');
  rejects(() => ledger.create({ amount: 100, payerId: 'zzz' }), 'member_unknown');
  rejects(() => ledger.create({ amount: 100, payerId: 'a', participantIds: [] }), 'participants_required');
  rejects(() => ledger.create({ amount: 100, payerId: 'a', category: 'x' }), 'category_invalid');
  rejects(() => ledger.create({ amount: 100, payerId: 'a', date: '2026-02-30' }), 'date_invalid');
});

test('家庭だけが精算に入り、仕事は一切含まれない', () => {
  const { ledger } = fresh();
  ledger.create({ amount: 3000, payerId: 'a', category: 'home' });
  ledger.create({ amount: 90000, payerId: 'b', category: 'work' });
  const s = ledger.settlement();
  assert.equal(s.entryCount, 1);
  assert.equal(s.total, 3000);
  assert.deepEqual(s.transfers, [
    { from: 'b', to: 'a', amount: 1000 },
    { from: 'c', to: 'a', amount: 1000 },
  ]);
  assert.equal(Object.values(s.balances).reduce((x, y) => x + y, 0), 0);
});

test('端数: 3人で1000円をAが払う → B,Cは333円ずつ渡し、Aの負担は334円', () => {
  const { ledger } = fresh();
  ledger.create({ amount: 1000, payerId: 'a' });
  const s = ledger.settlement();
  assert.deepEqual(s.balances, { a: 666, b: -333, c: -333 });
});

test('端数: Bが1000円払うとAが334円、Cが333円負担', () => {
  const { ledger } = fresh();
  ledger.create({ amount: 1000, payerId: 'b' });
  assert.deepEqual(ledger.settlement().balances, { a: -334, b: 667, c: -333 });
});

test('区分の初期値は前回の区分。一覧は前回の区分・払った人を返す', () => {
  const { ledger } = fresh();
  assert.deepEqual(
    { c: ledger.list().lastCategory, p: ledger.list().lastPayerId },
    { c: null, p: null },
  );
  ledger.create({ amount: 100, payerId: 'b', category: 'work' });
  const e = ledger.create({ amount: 200, payerId: 'c' });
  assert.equal(e.category, 'work');
  const l = ledger.list();
  assert.equal(l.lastCategory, 'work');
  assert.equal(l.lastPayerId, 'c');
});

test('修正すると修正回数が増え、精算結果に反映される', () => {
  const { ledger } = fresh();
  const e = ledger.create({ amount: 1000, payerId: 'a', participantIds: ['a', 'b'] });
  const u = ledger.update(e.id, { amount: 2000, memo: '  修正後 ' });
  assert.equal(u.revisions, 1);
  assert.equal(u.memo, '修正後');
  assert.deepEqual(ledger.settlement().transfers, [{ from: 'b', to: 'a', amount: 1000 }]);
  rejects(() => ledger.update(e.id, { amount: 0 }), 'amount_not_positive');
  assert.equal(ledger.list().entries[0].revisions, 1);
});

test('削除は論理削除: 履歴に残り、精算からは外れ、以後は変更できない', () => {
  const { ledger } = fresh();
  const e = ledger.create({ amount: 1000, payerId: 'a' });
  ledger.remove(e.id);
  const row = ledger.list().entries[0];
  assert.equal(row.deleted, true);
  assert.ok(row.deletedAt);
  assert.equal(ledger.settlement().entryCount, 0);
  rejects(() => ledger.update(e.id, { memo: 'x' }), 'entry_deleted');
  rejects(() => ledger.remove(e.id), 'entry_deleted');
  rejects(() => ledger.markSettled(e.id), 'entry_deleted');
  rejects(() => ledger.update(999, {}), 'not_found');
});

test('精算済みの印: 付けると精算から外れ、取り消すと戻る', () => {
  const { ledger } = fresh();
  const e = ledger.create({ amount: 1000, payerId: 'a' });
  ledger.markSettled(e.id);
  assert.equal(ledger.settlement().entryCount, 0);
  assert.deepEqual(ledger.settlement().transfers, []);
  assert.equal(ledger.list().entries[0].settled, true);
  ledger.unmarkSettled(e.id);
  assert.equal(ledger.settlement().entryCount, 1);
  assert.equal(ledger.list().entries[0].settled, false);
});

test('仕事の記録には精算済みを付けられない（理由付き）', () => {
  const { ledger } = fresh();
  const e = ledger.create({ amount: 1000, payerId: 'a', category: 'work' });
  rejects(() => ledger.markSettled(e.id), 'work_not_settleable');
  assert.match(
    (() => { try { ledger.markSettled(e.id); } catch (x) { return x.message; } })(),
    /仕事/,
  );
});

test('精算済みの記録は修正・削除できない', () => {
  const { ledger } = fresh();
  const e = ledger.create({ amount: 1000, payerId: 'a' });
  ledger.markSettled(e.id);
  rejects(() => ledger.update(e.id, { amount: 1 }), 'entry_settled');
  rejects(() => ledger.remove(e.id), 'entry_settled');
});

test('「精算しました」: 未精算の家庭分だけ一括で精算済み。仕事・削除済みは対象外', () => {
  const { ledger } = fresh();
  const h1 = ledger.create({ amount: 1000, payerId: 'a', category: 'home' });
  const h2 = ledger.create({ amount: 2000, payerId: 'b', category: 'home' });
  const w = ledger.create({ amount: 5000, payerId: 'c', category: 'work' });
  const d = ledger.create({ amount: 700, payerId: 'c', category: 'home' });
  ledger.remove(d.id);
  const r = ledger.settleAll();
  assert.equal(r.settledCount, 2);
  const byId = Object.fromEntries(ledger.list().entries.map((e) => [e.id, e]));
  assert.equal(byId[h1.id].settled, true);
  assert.equal(byId[h2.id].settled, true);
  assert.equal(byId[w.id].settled, false);
  assert.equal(byId[d.id].settled, false);
  assert.equal(ledger.settlement().entryCount, 0);
  rejects(() => ledger.settleAll(), 'nothing_to_settle');
});

test('直後の取り消しで直前の一括分だけ元に戻る（それ以前に精算済みの分は残る）', () => {
  const { ledger } = fresh();
  const old = ledger.create({ amount: 1000, payerId: 'a' });
  ledger.settleAll();
  const n1 = ledger.create({ amount: 2000, payerId: 'b' });
  const n2 = ledger.create({ amount: 3000, payerId: 'c' });
  ledger.settleAll();
  const r = ledger.undoSettleAll();
  assert.equal(r.restoredCount, 2);
  const byId = Object.fromEntries(ledger.list().entries.map((e) => [e.id, e]));
  assert.equal(byId[old.id].settled, true);
  assert.equal(byId[n1.id].settled, false);
  assert.equal(byId[n2.id].settled, false);
  assert.equal(ledger.settlement().entryCount, 2);
});

test('取り消す一括精算がなければ理由付きエラー', () => {
  const { ledger } = fresh();
  rejects(() => ledger.undoSettleAll(), 'nothing_to_undo');
});

test('一括精算の取り消しは再起動後もできる', () => {
  const { file, ledger } = fresh();
  ledger.create({ amount: 1000, payerId: 'a' });
  ledger.settleAll();
  const again = createLedger({ store: openStore(file), members });
  assert.equal(again.undoSettleAll().restoredCount, 1);
});
