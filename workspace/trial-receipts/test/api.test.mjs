import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { normalize, editedField } from '../src/reader.mjs';
import { toCsv } from '../src/table.mjs';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

async function start(opts = {}) {
  const dataDir = opts.dataDir ?? (await mkdtemp(path.join(tmpdir(), 'rcpt-')));
  const app = createApp({ dataDir, ...opts });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { base, dataDir, close: () => app.server.close(), ready: app.ready };
}
const post = (base, buf = JPG, type = 'image/jpeg') => fetch(base + '/receipts', { method: 'POST', headers: { 'content-type': type }, body: buf });
const settle = () => new Promise((r) => setTimeout(r, 50));

test('登録するとすぐ id と reading が返り、全項目が空欄＋要確認（未読み取り）になる', async () => {
  const s = await start();
  const res = await post(s.base);
  assert.equal(res.status, 201);
  const rec = await res.json();
  assert.ok(rec.id);
  assert.equal(rec.status, 'reading');
  await settle();
  const got = await (await fetch(`${s.base}/receipts/${rec.id}`)).json();
  assert.equal(got.status, 'done');
  for (const f of ['date', 'amount', 'vendor', 'category']) {
    assert.equal(got.fields[f].needs_review, true);
    assert.equal(got.fields[f].reason, '未読み取り');
  }
  assert.equal(got.fields.amount.value, '');
  assert.equal(got.fields.category.value, 'その他');
  assert.equal(got.edited, false);
  const img = await fetch(s.base + got.image_url);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), JPG);
  s.close();
});

test('10MB超は理由つきで413、画像以外は400', async () => {
  const s = await start();
  const big = await post(s.base, Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal(big.status, 413);
  assert.match((await big.json()).error, /10MB/);
  assert.equal((await post(s.base, JPG, 'text/plain')).status, 400);
  s.close();
});

test('PATCH で直した項目だけ要確認が消え、edited になる。不正な値は400', async () => {
  const s = await start();
  const rec = await (await post(s.base)).json();
  await settle();
  const patch = (b) => fetch(`${s.base}/receipts/${rec.id}`, { method: 'PATCH', body: JSON.stringify(b) });
  const ok = await (await patch({ amount: '1280' })).json();
  assert.equal(ok.fields.amount.value, 1280);
  assert.equal(ok.fields.amount.needs_review, false);
  assert.equal(ok.fields.date.needs_review, true);
  assert.equal(ok.edited, true);
  assert.equal((await patch({ date: '2026-02-30' })).status, 400);
  assert.equal((await patch({ category: '食費' })).status, 400);
  s.close();
});

test('月の表: 日付順・合計・未確認件数・全体の needs_review_count・CSV', async () => {
  const s = await start();
  const ids = [];
  for (let i = 0; i < 3; i++) { ids.push((await (await post(s.base)).json()).id); }
  await settle();
  const patch = (id, b) => fetch(`${s.base}/receipts/${id}`, { method: 'PATCH', body: JSON.stringify(b) });
  const full = { vendor: 'ローソン', category: '消耗品費' };
  await patch(ids[0], { ...full, date: '2026-03-10', amount: 500 });
  await patch(ids[1], { ...full, date: '2026-03-02', amount: 300 });
  await patch(ids[2], { ...full, date: '2026-04-01', amount: 999 });
  let t = await (await fetch(s.base + '/receipts?month=2026-03')).json();
  assert.deepEqual(t.rows.map((r) => r.fields.date.value), ['2026-03-02', '2026-03-10']);
  assert.equal(t.total, 800);
  assert.equal(t.total_note, '');
  assert.equal(t.needs_review_count, 0);
  // 1件を要確認に戻す代わりに、未編集の4件目を追加
  await post(s.base); await settle();
  t = await (await fetch(s.base + '/receipts?month=2026-03')).json();
  assert.equal(t.needs_review_count, 1); // 月が違っても全体の件数
  assert.equal(t.undated_count, 1);
  const all = await (await fetch(s.base + '/receipts')).json();
  assert.equal(all.rows.at(-1).fields.date.value, ''); // 日付なしは末尾
  assert.equal(all.total_note, '未確認が1件あり、合計は確定ではありません');
  const csv = await fetch(s.base + '/export.csv?month=2026-03');
  const buf = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(buf.toString('utf8'), /2026-03-02","300","ローソン","消耗品費","","/);
  assert.equal((await fetch(s.base + '/receipts?month=2026-3')).status, 400);
  s.close();
});

test('再起動しても残り、reading のまま残ったものは読み直される', async () => {
  const a = await start();
  const rec = await (await post(a.base)).json();
  await settle();
  a.close();
  const b = await start({ dataDir: a.dataDir });
  const got = await (await fetch(`${b.base}/receipts/${rec.id}`)).json();
  assert.equal(got.id, rec.id);
  b.close();
});

test('リーダーが例外を投げると failed になり、項目は要確認の空欄', async () => {
  const s = await start({ reader: async () => { throw new Error('boom'); } });
  const rec = await (await post(s.base)).json();
  await settle();
  const got = await (await fetch(`${s.base}/receipts/${rec.id}`)).json();
  assert.equal(got.status, 'failed');
  assert.equal(got.fields.amount.needs_review, true);
  s.close();
});

test('normalize: 閾値未満・形式NG・カテゴリ外は要確認。推測で埋めない', () => {
  const n = normalize({
    date: { value: '2026-13-01', confidence: 0.99 },
    amount: { value: 1200, confidence: 0.5, reason: '薄くて読めない' },
    vendor: { value: 'カフェ', confidence: 0.95 },
    category: { value: '食費', confidence: 0.9 },
  });
  assert.deepEqual([n.date.value, n.date.needs_review], ['', true]);
  assert.equal(n.amount.needs_review, true);
  assert.equal(n.amount.reason, '薄くて読めない');
  assert.equal(n.vendor.needs_review, false);
  assert.deepEqual([n.category.value, n.category.needs_review], ['その他', true]);
  assert.throws(() => editedField('amount', '-5'));
});

test('CSV は数式に見える支払先を無害化する', () => {
  const rec = { id: 'x', status: 'done', fields: { date: { value: '2026-01-01' }, amount: { value: 1 }, vendor: { value: '=HYPERLINK("x")' }, category: { value: 'その他' } } };
  assert.match(toCsv([rec]), /"'=HYPERLINK\(""x""\)"/);
});
