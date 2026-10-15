import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openStore, initStore, addClient, previewInvoice, createInvoice, listInvoices, calcAmounts, getInvoice, localDate,
  getTemplate, setTemplate, invoicesToCsv,
} from '../src/core.js';

function fresh() {
  const store = openStore(mkdtempSync(join(tmpdir(), 'inv-')));
  initStore(store, { name: '山田事務所', invoiceNumber: 'T1234567890123' });
  return store;
}
const raw = (s) => readFileSync(s.file, 'utf8');
const items = [{ name: '顧問料', amount: 50000 }];

test('山田さんの例: 報酬10万(源泉対象)+実費1万、源泉ありクライアント', () => {
  const store = fresh();
  addClient(store, { name: 'A商事', withholding: true });
  const inv = createInvoice(store, {
    clientId: 'A商事', month: '2026-09',
    items: [
      { name: '顧問料', amount: 50000, withholding: true },
      { name: '記帳代行', amount: 50000, withholding: true },
      { name: '立替実費', amount: 10000 },
    ],
  });
  assert.equal(inv.subtotal, 110000);
  assert.equal(inv.tax, 11000);
  assert.equal(inv.withholdingBase, 100000);
  assert.equal(inv.withholdingTax, 10210); // 100000 × 0.1021
  assert.equal(inv.total, 110000 + 11000 - 10210);
});

test('源泉は円未満切り捨て', () => {
  assert.equal(calcAmounts([{ amount: 33333, withholding: true }], true).withholdingTax, 3403); // 3403.28
  assert.equal(calcAmounts([{ amount: 9999, withholding: true }], true).withholdingTax, 1020); // 1020.89
});

test('消費税も円未満切り捨て', () => {
  assert.equal(calcAmounts([{ amount: 12345 }], false).tax, 1234);
});

test('源泉なしクライアントは明細に指定があっても源泉0', () => {
  const store = fresh();
  addClient(store, { name: 'B社' });
  const p = previewInvoice(store, { clientId: 'B社', month: '2026-09', items: [{ name: 'x', amount: 1000, withholding: true }] });
  assert.equal(p.withholdingTax, 0);
  assert.equal(p.total, 1100);
});

test('採番: 連続発行・別クライアントでも重複しない', () => {
  const store = fresh();
  addClient(store, { name: 'A' });
  addClient(store, { name: 'B' });
  const nums = [];
  for (let i = 0; i < 5; i++) {
    nums.push(createInvoice(store, { clientId: i % 2 ? 'A' : 'B', month: '2026-09', items }).number);
  }
  assert.equal(new Set(nums).size, 5);
  assert.deepEqual(nums, ['INV-0001', 'INV-0002', 'INV-0003', 'INV-0004', 'INV-0005']);
});

test('プレビューは data.json を一切変えない（未作成なら作らない）', () => {
  const store = fresh();
  addClient(store, { name: 'A' });
  const before = raw(store);
  const p = previewInvoice(store, { clientId: 'A', month: '2026-09', items });
  assert.equal(raw(store), before);
  assert.equal(p.number, undefined);
});

test('プレビューと確定で金額が一致する', () => {
  const store = fresh();
  addClient(store, { name: 'A', withholding: true });
  const input = { clientId: 'A', month: '2026-09', items: [{ name: 'r', amount: 33333, withholding: true }, { name: 'e', amount: 777 }] };
  const p = previewInvoice(store, input);
  const c = createInvoice(store, input);
  for (const k of ['subtotal', 'tax', 'withholdingBase', 'withholdingTax', 'total']) assert.equal(c[k], p[k], k);
});

test('Nを選んだ(=createを呼ばない)場合、番号は消費されない', () => {
  const store = fresh();
  addClient(store, { name: 'A' });
  previewInvoice(store, { clientId: 'A', month: '2026-09', items });
  previewInvoice(store, { clientId: 'A', month: '2026-09', items });
  assert.equal(createInvoice(store, { clientId: 'A', month: '2026-09', items }).number, 'INV-0001');
});

test('不正な入力ではエラーになり、番号を消費しない', () => {
  const store = fresh();
  addClient(store, { name: 'A' });
  assert.throws(() => createInvoice(store, { clientId: 'A', month: '2026-13', items }));
  assert.throws(() => createInvoice(store, { clientId: 'A', month: '2026-09', items: [{ name: 'x', amount: 1.5 }] }));
  assert.throws(() => createInvoice(store, { clientId: 'ZZ', month: '2026-09', items }));
  assert.equal(createInvoice(store, { clientId: 'A', month: '2026-09', items }).number, 'INV-0001');
});

test('スナップショット: 後でクライアント設定を変えても過去の請求書は変わらない', () => {
  const store = fresh();
  addClient(store, { name: 'A', withholding: true });
  const inv = createInvoice(store, { clientId: 'A', month: '2026-09', items: [{ name: 'r', amount: 10000, withholding: true }] });
  initStore(store, { name: '別名', invoiceNumber: '' });
  const got = getInvoice(store, inv.number);
  assert.equal(got.issuer.name, '山田事務所');
  assert.equal(got.issuer.invoiceNumber, 'T1234567890123');
  assert.equal(got.client.withholding, true);
});

test('一覧: 番号・日付・クライアント・金額', () => {
  const store = fresh();
  addClient(store, { name: 'A' });
  createInvoice(store, { clientId: 'A', month: '2026-09', items }, { date: new Date(2026, 8, 30, 0, 30) });
  assert.deepEqual(listInvoices(store), [{ number: 'INV-0001', date: '2026-09-30', client: 'A', month: '2026-09', total: 55000 }]);
});

test('インボイス番号の形式チェック・未init で発行不可', () => {
  const store = openStore(mkdtempSync(join(tmpdir(), 'inv-')));
  assert.throws(() => initStore(store, { name: 'x', invoiceNumber: '123' }));
  addClient(store, { name: 'A' });
  assert.throws(() => createInvoice(store, { clientId: 'A', month: '2026-09', items }), /init/);
  assert.equal(existsSync(store.file), true);
});

test('エラーは code で判別できる', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openStore, addClient, previewInvoice, createInvoice } = await import('../src/core.js');
  const store = openStore(mkdtempSync(join(tmpdir(), 'inv-')));
  const items = [{ name: 'a', amount: 1000, withholding: false }];
  assert.throws(() => previewInvoice(store, { clientId: 'x', month: '2026-01', items }), { code: 'CLIENT_NOT_FOUND' });
  addClient(store, { name: 'A社' });
  assert.throws(() => addClient(store, { name: 'A社' }), { code: 'CLIENT_EXISTS' });
  assert.throws(() => createInvoice(store, { clientId: 'A社', month: '2026-01', items }), { code: 'NO_ISSUER' });
  assert.throws(() => previewInvoice(store, { clientId: 'A社', month: '202601', items }), { code: 'INVALID_INPUT' });
});

test('発行日はローカル日付(午前0時台でも前日にならない)', () => {
  assert.equal(localDate(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  assert.equal(localDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('定番明細: 未保存は[]、保存して読める、置き換え、コピーを返す', () => {
  const store = fresh();
  addClient(store, { name: 'A商事' });
  assert.deepEqual(getTemplate(store, 'A商事'), []);
  setTemplate(store, 'A商事', [{ name: '顧問料', amount: 50000, withholding: true }]);
  const t = getTemplate(store, 'c1');
  assert.deepEqual(t, [{ name: '顧問料', amount: 50000, withholding: true }]);
  t[0].amount = 1; // 呼び出し側の書き換えは保存内容に影響しない
  assert.equal(getTemplate(store, 'A商事')[0].amount, 50000);
  setTemplate(store, 'A商事', [{ name: '保守', amount: 3000 }]);
  assert.deepEqual(getTemplate(store, 'A商事'), [{ name: '保守', amount: 3000, withholding: false }]);
});

test('定番明細: 不正入力と未登録はコード付きで失敗し、保存内容は変わらない', () => {
  const store = fresh();
  addClient(store, { name: 'A商事' });
  setTemplate(store, 'A商事', items);
  assert.throws(() => setTemplate(store, 'A商事', [{ name: 'x', amount: 1.5 }]), { code: 'INVALID_INPUT' });
  assert.throws(() => setTemplate(store, 'A商事', [{ name: '', amount: 100 }]), { code: 'INVALID_INPUT' });
  assert.throws(() => setTemplate(store, 'A商事', 'x'), { code: 'INVALID_INPUT' });
  assert.throws(() => getTemplate(store, '無名'), { code: 'CLIENT_NOT_FOUND' });
  assert.throws(() => setTemplate(store, '無名', items), { code: 'CLIENT_NOT_FOUND' });
  assert.equal(getTemplate(store, 'A商事')[0].amount, 50000);
});

test('定番明細: 定番を変えても発行済み請求書は変わらない（スナップショット）', () => {
  const store = fresh();
  addClient(store, { name: 'A商事' });
  setTemplate(store, 'A商事', items);
  const inv = createInvoice(store, { clientId: 'A商事', month: '2026-09', items: getTemplate(store, 'A商事') });
  setTemplate(store, 'A商事', [{ name: '別件', amount: 999 }]);
  assert.deepEqual(getInvoice(store, inv.number).items, [{ name: '顧問料', amount: 50000, withholding: false }]);
  assert.equal(getInvoice(store, inv.number).total, 55000);
});

test('定番明細: 定番の保存は採番に影響しない', () => {
  const store = fresh();
  addClient(store, { name: 'A商事' });
  setTemplate(store, 'A商事', items);
  assert.equal(createInvoice(store, { clientId: 'A商事', month: '2026-09', items }).number, 'INV-0001');
});

test('CSV: BOM・CRLF・見出し・8列、金額は整数のまま', () => {
  const store = fresh();
  addClient(store, { name: 'A商事', withholding: true });
  createInvoice(store, { clientId: 'A商事', month: '2026-09', items: [
    { name: '報酬', amount: 100000, withholding: true }, { name: '実費', amount: 10000 }] }, { date: new Date(2026, 8, 30) });
  const csv = invoicesToCsv(store);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], '番号,日付,クライアント,対象月,小計,消費税,源泉,請求額');
  assert.equal(lines[1], 'INV-0001,2026-09-30,A商事,2026-09,110000,11000,10210,110790');
  assert.equal(lines[2], ''); // 末尾もCRLF
});

test('CSV: 0件でも見出しだけ出る', () => {
  const csv = invoicesToCsv(fresh());
  assert.equal(csv, '\ufeff番号,日付,クライアント,対象月,小計,消費税,源泉,請求額\r\n');
});

test('CSV: カンマ・引用符・改行は囲む。先頭が =+-@ の値には \' を付ける', () => {
  const store = fresh();
  for (const n of ['=SUM(A1)', '+81 商事', '-x', '@foo', 'a,b "c"', '改\n行']) {
    addClient(store, { name: n });
    createInvoice(store, { clientId: n, month: '2026-09', items });
  }
  const csv = invoicesToCsv(store);
  assert.ok(csv.includes(",'=SUM(A1),"));
  assert.ok(csv.includes(",'+81 商事,"));
  assert.ok(csv.includes(",'-x,"));
  assert.ok(csv.includes(",'@foo,"));
  assert.ok(csv.includes(',"a,b ""c""",'));
  assert.ok(csv.includes(',"改\n行",'));
});
