import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { openMembers } from '../src/members.js';
import { createLedger } from '../src/ledger.js';
import { createApp } from '../src/server.js';

const seed = [{ id: 'kenta', name: '健太' }, { id: 'mika', name: '美香' }];

async function boot(dir) {
  const memberStore = openMembers({ file: join(dir, 'members.json'), seed });
  const ledger = createLedger({ store: openStore(join(dir, 'ledger.json')), members: memberStore.list });
  const server = createApp({ ledger, memberStore, publicDir: dir });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { call, close: () => server.close() };
}

test('POST /members: 追加でき、IDは連番、再起動後も残る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-mem-'));
  let s = await boot(dir);
  const r = await s.call('POST', '/members', { name: ' 花子 ' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.member, { id: 'm1', name: '花子' });
  assert.equal((await s.call('POST', '/members', { name: '太郎' })).body.member.id, 'm2');
  s.close();
  s = await boot(dir);
  assert.deepEqual((await s.call('GET', '/members')).body.members.map((m) => m.name), ['健太', '美香', '花子', '太郎']);
  s.close();
});

test('空・空白・重複（大文字小文字無視）・長すぎる名前は日本語の理由付きで拒否', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-mem-'));
  const s = await boot(dir);
  for (const body of [{}, { name: '' }, { name: '  ' }, { name: 5 }]) {
    const r = await s.call('POST', '/members', body);
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'name_required');
    assert.match(r.body.error.message, /名前を入力/);
  }
  const dup = await s.call('POST', '/members', { name: '健太' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'name_duplicate');
  assert.match(dup.body.error.message, /すでにいます/);
  await s.call('POST', '/members', { name: 'Bob' });
  assert.equal((await s.call('POST', '/members', { name: 'bob' })).status, 409);
  assert.equal((await s.call('POST', '/members', { name: 'あ'.repeat(31) })).body.error.code, 'name_too_long');
  assert.equal((await s.call('GET', '/members')).body.members.length, 3);
  s.close();
});

test('PATCH /members/:id: 改名しても記録と精算結果は同じ人のまま', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-mem-'));
  let s = await boot(dir);
  await s.call('POST', '/entries', { amount: 3000, payerId: 'kenta' });
  const before = (await s.call('GET', '/settlement')).body;
  const r = await s.call('PATCH', '/members/kenta', { name: '健' });
  assert.deepEqual(r.body.member, { id: 'kenta', name: '健' });
  assert.deepEqual((await s.call('GET', '/settlement')).body, before);
  assert.equal((await s.call('GET', '/entries')).body.entries[0].payerId, 'kenta');
  s.close();
  s = await boot(dir);
  assert.equal((await s.call('GET', '/members')).body.members[0].name, '健');
  assert.deepEqual((await s.call('GET', '/settlement')).body, before);
  s.close();
});

test('PATCH /members/:id: 重複・空・存在しないIDは拒否、自分の名前のままはOK', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-mem-'));
  const s = await boot(dir);
  assert.equal((await s.call('PATCH', '/members/kenta', { name: '美香' })).status, 409);
  assert.equal((await s.call('PATCH', '/members/kenta', { name: '' })).status, 400);
  assert.equal((await s.call('PATCH', '/members/zzz', { name: 'x' })).status, 404);
  assert.equal((await s.call('PATCH', '/members/kenta', { name: '健太' })).status, 200);
  s.close();
});

test('追加したメンバーが払った人・負担者として使え、データがなければ設定ファイルは書き出さない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-mem-'));
  const s = await boot(dir);
  assert.equal(existsSync(join(dir, 'members.json')), false);
  const m = (await s.call('POST', '/members', { name: '花子' })).body.member;
  const e = await s.call('POST', '/entries', { amount: 900, payerId: m.id });
  assert.equal(e.status, 201);
  assert.equal(e.body.entry.participantIds.length, 3);
  s.close();
});

test('メンバー0人でも GET /members は空配列', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kakeibo-mem-'));
  const memberStore = openMembers({ file: join(dir, 'members.json'), seed: [] });
  const server = createApp({ ledger: createLedger({ store: openStore(join(dir, 'l.json')), members: memberStore.list }), memberStore, publicDir: dir });
  await new Promise((r) => server.listen(0, r));
  const r = await fetch(`http://localhost:${server.address().port}/members`);
  assert.deepEqual(await r.json(), { members: [] });
  server.close();
});
