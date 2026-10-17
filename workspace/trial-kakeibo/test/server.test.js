import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { createLedger } from '../src/ledger.js';
import { createApp } from '../src/server.js';

const members = [
  { id: 'a', name: '健太' },
  { id: 'b', name: '美香' },
];
let server, base;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-http-'));
  mkdirSync(join(dir, 'public'));
  writeFileSync(join(dir, 'public/index.html'), '<h1>ok</h1>');
  const ledger = createLedger({ store: openStore(join(dir, 'ledger.json')), members });
  server = createApp({ ledger, publicDir: join(dir, 'public') });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('GET /members', async () => {
  const r = await call('GET', '/members');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.members, members);
});

test('空のとき GET /entries は空配列と前回値 null', async () => {
  const r = await call('GET', '/entries');
  assert.deepEqual(r.body, { entries: [], lastCategory: null, lastPayerId: null });
});

test('エラーは {error:{code,message}} の日本語', async () => {
  const r = await call('POST', '/entries', { amount: 0, payerId: 'a' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'amount_not_positive');
  assert.match(r.body.error.message, /1円以上/);
  const bad = await fetch(base + '/entries', { method: 'POST', body: '{oops' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'body_invalid');
});

test('記録→一覧→精算→印→一括精算→取り消し（HTTP経由）', async () => {
  const c = await call('POST', '/entries', { amount: 3000, payerId: 'a', memo: '食材' });
  assert.equal(c.status, 201);
  const w = await call('POST', '/entries', { amount: 800, payerId: 'b', category: 'work' });

  const l = await call('GET', '/entries');
  assert.equal(l.body.entries.length, 2);
  assert.equal(l.body.lastCategory, 'work');
  assert.equal(l.body.lastPayerId, 'b');
  for (const k of ['category', 'deleted', 'settled', 'revisions']) assert.ok(k in l.body.entries[0]);

  const s = await call('GET', '/settlement');
  assert.deepEqual(s.body.transfers, [{ from: 'b', to: 'a', amount: 1500 }]);
  assert.equal(s.body.approximate, false);

  const bad = await call('PUT', `/entries/${w.body.entry.id}/settled`);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'work_not_settleable');

  const one = await call('PUT', `/entries/${c.body.entry.id}/settled`);
  assert.equal(one.body.entry.settled, true);
  assert.deepEqual((await call('GET', '/settlement')).body.transfers, []);
  await call('DELETE', `/entries/${c.body.entry.id}/settled`);

  const all = await call('POST', '/settle');
  assert.equal(all.body.settledCount, 1);
  const undo = await call('POST', '/settle/undo');
  assert.equal(undo.body.restoredCount, 1);
  assert.equal((await call('GET', '/settlement')).body.entryCount, 1);
});

test('修正(PATCH)と削除(DELETE)、存在しないIDは404', async () => {
  const c = await call('POST', '/entries', { amount: 100, payerId: 'a' });
  const p = await call('PATCH', `/entries/${c.body.entry.id}`, { amount: 200 });
  assert.equal(p.body.entry.revisions, 1);
  const d = await call('DELETE', `/entries/${c.body.entry.id}`);
  assert.equal(d.body.entry.deleted, true);
  assert.equal((await call('PATCH', '/entries/9999', {})).status, 404);
});

test('静的ファイルを配信し、パス traversal は拒否', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /ok/);
  const t = await fetch(base + '/..%2f..%2fpackage.json');
  assert.equal(t.status, 404);
});

test('undoable: 一括精算で true、取り消しで false、再起動後も保たれる', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-undo-'));
  const file = join(dir, 'ledger.json');
  const boot = () => createLedger({ store: openStore(file), members });
  let ledger = boot();
  assert.equal(ledger.settlement().undoable, false);
  ledger.create({ amount: 1000, payerId: 'a' });
  assert.equal(ledger.settlement().undoable, false);
  ledger.settleAll();
  assert.equal(ledger.settlement().undoable, true);
  ledger = boot();
  assert.equal(ledger.settlement().undoable, true);
  ledger.undoSettleAll();
  assert.equal(ledger.settlement().undoable, false);
  assert.equal(boot().settlement().undoable, false);
});

test('undoable: 一括分を個別に取り消し済みなら false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-undo-'));
  const ledger = createLedger({ store: openStore(join(dir, 'l.json')), members });
  const e = ledger.create({ amount: 500, payerId: 'a' });
  ledger.settleAll();
  ledger.unmarkSettled(e.id);
  assert.equal(ledger.settlement().undoable, false);
});

test('GET /settlement に undoable が含まれる（HTTP）', async () => {
  const r = await call('GET', '/settlement');
  assert.equal(typeof r.body.undoable, 'boolean');
});
