// 標準ライブラリだけの HTTP サーバー。起動: node src/server.mjs
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, RejectError, MAX_BYTES, MIME_BY_EXT } from './store.mjs';
import { nullReader, normalize, editedField, FIELDS } from './reader.mjs';
import { buildTable, toCsv, rowNeedsReview, isPending } from './table.mjs';
import { pickReader } from './tesseract.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATIC = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function createApp({ dataDir = path.join(root, 'data'), reader = nullReader, publicDir = path.join(root, 'web') } = {}) {
  const store = createStore(dataDir);

  // 同じ id への書き込みを順番に並べる（読み取り結果と手の修正がぶつからないように）
  const locks = new Map();
  function update(id, fn) {
    const prev = locks.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const rec = await store.get(id);
      if (!rec) return null;
      const out = await fn(rec);
      if (out !== false) await store.save(rec);
      return rec;
    });
    locks.set(id, next.catch(() => {}));
    return next;
  }

  // 読み取りは1件ずつ順番に。10枚続けて撮っても OCR を同時に走らせない。
  const queue = [];
  let running = null;
  async function readOne(id) {
    const rec = await update(id, (r) => { r.status = 'reading'; });
    if (!rec) return;
    let fields, status, error;
    try {
      fields = normalize(await reader(await store.readImage(rec), { id }));
      status = 'done';
    } catch (e) {
      fields = normalize({});
      status = 'failed';
      error = String(e?.message ?? e);
    }
    await update(id, (r) => {
      // 待っている間に手で直した欄（edited）は、あとから届いた読み取り結果で上書きしない
      r.fields = Object.fromEntries(FIELDS.map((f) => [f, r.fields?.[f]?.edited ? r.fields[f] : fields[f]]));
      r.status = status;
      if (error) r.error = error;
    });
  }
  async function pump() {
    if (running) return;
    while (queue.length) {
      running = queue.shift();
      try { await readOne(running); } catch (e) { console.error(e); }
    }
    running = null;
  }
  const enqueue = (id) => { queue.push(id); pump(); };
  // 前に何枚あるか（読み取り中の1枚を含む）
  const queuePosition = (id) => { const i = queue.indexOf(id); return i < 0 ? 0 : i + (running ? 1 : 0); };

  // 再起動で queued / reading のまま残ったものを、撮った順に読み直す
  const resumed = store.list().then((all) => all.filter(isPending)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .forEach((r) => enqueue(r.id)));

  const view = (r) => ({
    ...r,
    ...(r.status === 'queued' ? { queue_position: queuePosition(r.id) } : {}),
    needs_review: rowNeedsReview(r),
    image_url: `/receipts/${r.id}/image`,
  });
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const fail = (res, code, error) => json(res, code, { error });

  async function body(req, limit) {
    const chunks = []; let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > limit) throw new RejectError(`画像が10MBを超えています（${(n / 1048576).toFixed(1)}MB 以上）`);
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      let m;
      if (req.method === 'POST' && p === '/receipts') {
        const buf = await body(req, MAX_BYTES);
        const rec = await store.create(buf, req.headers['content-type']);
        enqueue(rec.id);
        return json(res, 201, view(rec));
      }
      if (req.method === 'GET' && p === '/receipts') {
        const { rows, ...t } = buildTable(await store.list(), url.searchParams.get('month') ?? undefined);
        return json(res, 200, { ...t, receipts: rows.map(view) });
      }
      if ((m = p.match(/^\/receipts\/([^/]+)(\/image)?$/))) {
        const rec = await store.get(m[1]);
        if (!rec) return fail(res, 404, '領収書が見つかりません');
        if (m[2] && req.method === 'GET') {
          res.writeHead(200, { 'content-type': MIME_BY_EXT[path.extname(rec.image_path).slice(1)] });
          return res.end(await store.readImage(rec));
        }
        if (!m[2] && req.method === 'GET') return json(res, 200, view(rec));
        if (!m[2] && req.method === 'PATCH') {
          // 順番待ち・読み取り中でも直せる。直した欄は読み取り結果で上書きされない。
          let patch;
          try { patch = JSON.parse((await body(req, 65536)).toString('utf8')); } catch { return fail(res, 400, 'JSON が不正です'); }
          const keys = Object.keys(patch ?? {});
          if (!keys.length || keys.some((k) => !FIELDS.includes(k))) return fail(res, 400, `直せる項目: ${FIELDS.join(', ')}`);
          let edits;
          try { edits = Object.fromEntries(keys.map((k) => [k, editedField(k, patch[k])])); } catch (e) { return fail(res, 400, e.message); }
          const saved = await update(rec.id, (r) => {
            r.fields = { ...(r.fields ?? normalize({})), ...edits };
            r.edited = true;
          });
          return json(res, 200, view(saved));
        }
      }
      if (req.method === 'GET' && p === '/api/info') { // /start の QR 用
        return json(res, 200, { urls: lanUrls(port()), reader: reader.label ?? 'none' });
      }
      if (req.method === 'GET' && p === '/export.csv') {
        const month = url.searchParams.get('month') ?? undefined;
        const t = buildTable(await store.list(), month);
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="receipts-${month ?? 'all'}.csv"`,
        });
        return res.end(toCsv(t.rows));
      }
      if (req.method === 'GET') { // フロントの静的ファイル（web/）
        const rel = p === '/' ? 'index.html' : p.slice(1);
        const file = path.join(publicDir, rel);
        if (file.startsWith(publicDir + path.sep) && STATIC[path.extname(file)]) {
          try {
            const data = await readFile(file);
            res.writeHead(200, { 'content-type': STATIC[path.extname(file)] });
            return res.end(data);
          } catch {}
        }
      }
      fail(res, 404, 'not found');
    } catch (e) {
      if (e instanceof RejectError) return fail(res, e.message.includes('10MB') ? 413 : 400, e.message);
      if (e.message?.startsWith('month')) return fail(res, 400, e.message);
      console.error(e);
      fail(res, 500, 'サーバーエラー');
    }
  });
  const port = () => server.address()?.port;
  return { server, store, ready: resumed };
}

// 同じ Wi-Fi のスマホから開ける URL（IPv4、ループバック以外）
export function lanUrls(port, ifaces = os.networkInterfaces()) {
  return Object.values(ifaces).flat()
    .filter((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal)
    .map((a) => `http://${a.address}:${port}/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const reader = await pickReader(process.env.READER);
  const { server } = createApp({ reader });
  server.listen(port, '0.0.0.0', () => {
    const urls = lanUrls(port);
    console.log(`読み取り: ${reader.label ?? 'なし（全項目を要確認で返す）'}`);
    console.log(`写真の保存先: ${path.join(root, 'data', 'images')}（このマシンの外には送りません）`);
    console.log(urls.length ? `スマホで開く URL:\n${urls.map((u) => '  ' + u).join('\n')}` : `LAN のアドレスが見つかりません。http://localhost:${port}/ で開けます`);
    console.log(`QR コード: ${urls[0] ?? `http://localhost:${port}/`}start`);
  });
}
