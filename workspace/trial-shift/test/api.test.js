import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';

const dir = mkdtempSync(join(tmpdir(), 'shift-'));
const file = join(dir, 'd.json');
const H = { 'x-owner-pass': 'secret', 'content-type': 'application/json' };
let server, base, failWrites = false;

const start = (f = file) => new Promise((res) => {
  const store = createStore(f, { writeFile: (...a) => { if (failWrites) throw new Error('disk full'); writeFileSync(...a); } });
  const s = createApp({ store, passphrase: 'secret', now: () => new Date('2026-10-25T03:04:00Z') });
  s.listen(0, () => { server = s; base = `http://localhost:${s.address().port}`; res(); });
});
const stop = () => new Promise((r) => server.close(r));
const call = async (method, path, body, headers = H) => {
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

before(() => start());
after(async () => { await stop(); rmSync(dir, { recursive: true }); });

test('オーナー API は合言葉なしで 401', async () => {
  for (const [m, p] of [['GET', '/api/owner/staff'], ['GET', '/api/owner/requests?month=2026-11'], ['POST', '/api/calc']]) {
    assert.equal((await call(m, p, m === 'POST' ? {} : undefined, {})).status, 401);
    assert.equal((await call(m, p, m === 'POST' ? {} : undefined, { 'x-owner-pass': 'wrong' })).status, 401);
  }
});

test('スタッフ登録・編集、スタッフ用一覧は id と名前だけ', async () => {
  const a = await call('POST', '/api/owner/staff', { name: '陳 美玲', wage: 1100, weeklyLimit: 28 });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, { id: 's1', name: '陳 美玲', wage: 1100, weeklyLimit: 28 });
  await call('POST', '/api/owner/staff', { name: '山田', wage: 1000 });
  const e = await call('PUT', '/api/owner/staff/s2', { wage: 1050, weeklyLimit: 20 });
  assert.equal(e.body.wage, 1050);
  assert.equal((await call('PUT', '/api/owner/staff/s2', { weeklyLimit: null })).body.weeklyLimit, null);
  const pub = await call('GET', '/api/staff', undefined, {});
  assert.deepEqual(pub.body, [{ id: 's1', name: '陳 美玲' }, { id: 's2', name: '山田' }]);
});

test('スタッフ入力の検証', async () => {
  assert.equal((await call('POST', '/api/owner/staff', { name: '', wage: 1000 })).status, 400);
  assert.equal((await call('POST', '/api/owner/staff', { name: 'x', wage: -1 })).status, 400);
  assert.equal((await call('POST', '/api/owner/staff', { name: 'x', wage: 1000, weeklyLimit: 0 })).status, 400);
  assert.equal((await call('PUT', '/api/owner/staff/nope', { wage: 1000 })).status, 404);
});

test('未提出は 200 で submitted:false', async () => {
  const r = await call('GET', '/api/staff/s1/requests?month=2026-11', undefined, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { submitted: false, submittedAt: null, days: {} });
});

test('提出すると receivedAt(+09:00)が返り、再取得できる。再提出は上書き', async () => {
  const days = { '2026-11-03': { available: true, note: '17時まで' }, '2026-11-04': { available: false, note: 'ゼミ' } };
  const r = await call('PUT', '/api/staff/s1/requests?month=2026-11', { days }, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.receivedAt, '2026-10-25T12:04:00+09:00');
  const g = await call('GET', '/api/staff/s1/requests?month=2026-11', undefined, {});
  assert.deepEqual(g.body, { submitted: true, submittedAt: r.body.receivedAt, days });
  await call('PUT', '/api/staff/s1/requests?month=2026-11', { days: { '2026-11-05': { available: true } } }, {});
  const g2 = await call('GET', '/api/staff/s1/requests?month=2026-11', undefined, {});
  assert.deepEqual(Object.keys(g2.body.days), ['2026-11-05']);
  assert.equal(g2.body.days['2026-11-05'].note, '');
});

test('提出の入力検証', async () => {
  const put = (b, q = '2026-11') => call('PUT', `/api/staff/s1/requests?month=${q}`, b, {});
  assert.equal((await put({ days: { '2026-12-01': { available: true } } })).status, 400);
  assert.equal((await put({ days: { '2026-11-31': { available: true } } })).status, 400);
  assert.equal((await put({ days: { '2026-11-01': { available: 'yes' } } })).status, 400);
  assert.equal((await put({ days: { '2026-11-01': { available: true, note: 'a'.repeat(201) } } })).status, 400);
  assert.equal((await put({})).status, 400);
  assert.equal((await put({ days: {} }, 'bad')).status, 400);
  assert.equal((await call('PUT', '/api/staff/zz/requests?month=2026-11', { days: {} }, {})).status, 404);
});

test('オーナー一覧: 未提出は submittedAt:null、メモも含む', async () => {
  const r = await call('GET', '/api/owner/requests?month=2026-11');
  assert.equal(r.status, 200);
  assert.equal(r.body.staff.length, 2);
  assert.equal(r.body.staff[0].submittedAt, '2026-10-25T12:04:00+09:00');
  assert.deepEqual(r.body.staff[1], { id: 's2', name: '山田', submittedAt: null, days: {} });
});

test('保存失敗ならエラーで、受付済みにならず旧データが残る', async () => {
  const before = await call('GET', '/api/staff/s1/requests?month=2026-11', undefined, {});
  failWrites = true;
  const r = await call('PUT', '/api/staff/s1/requests?month=2026-11', { days: { '2026-11-09': { available: false } } }, {});
  failWrites = false;
  assert.equal(r.status, 500);
  assert.ok(r.body.error);
  assert.equal(r.body.receivedAt, undefined);
  assert.deepEqual((await call('GET', '/api/staff/s1/requests?month=2026-11', undefined, {})).body, before.body);
});

test('サーバーを再起動してもスタッフと希望が残る', async () => {
  const before = await call('GET', '/api/owner/requests?month=2026-11');
  await stop();
  await start();
  assert.deepEqual((await call('GET', '/api/owner/requests?month=2026-11')).body, before.body);
  assert.equal((await call('GET', '/api/owner/staff')).body.length, 2);
  assert.equal((await call('POST', '/api/owner/staff', { name: '新人', wage: 1000 })).body.id, 's3');
});

test('POST /api/calc: 保存済みスタッフの時給で計算し、週超過を返す', async () => {
  const shifts = [
    ...['02', '03', '04'].map((d) => ({ date: `2026-11-${d}`, staffId: 's1', start: '09:00', end: '15:00' })),
    { date: '2026-11-05', staffId: 's1', start: '09:00', end: '13:00' },
  ];
  const ok = await call('POST', '/api/calc', { month: '2026-11', revenue: 500000, shifts });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.totalCost, 22 * 1100);
  assert.deepEqual(ok.body.overLimit, []);
  shifts.push({ date: '2026-11-06', staffId: 's1', start: '10:00', end: '17:00' }); // 22h+7h=29h
  const over = await call('POST', '/api/calc', { month: '2026-11', revenue: 500000, shifts });
  assert.deepEqual(over.body.overLimit, [{ staffId: 's1', name: '陳 美玲', weekStart: '2026-11-02', hours: 29, limit: 28 }]);
});

test('calc の不正入力は 400', async () => {
  const r = await call('POST', '/api/calc', { month: '2026-11', revenue: 1000, shifts: [{ date: '2026-11-02', staffId: 's1', start: '18:00', end: '10:00' }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /日またぎ/);
});

test('未知のパスは 404、不正 JSON は 400', async () => {
  assert.equal((await call('GET', '/api/nothing', undefined, {})).status, 404);
  const r = await fetch(base + '/api/owner/staff', { method: 'POST', headers: H, body: '{bad' });
  assert.equal(r.status, 400);
});
