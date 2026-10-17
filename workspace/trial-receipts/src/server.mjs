// 標準ライブラリだけの HTTP サーバー。起動: node src/server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, RejectError, MAX_BYTES, MIME_BY_EXT } from './store.mjs';
import { nullReader, normalize, editedField, FIELDS } from './reader.mjs';
import { buildTable, toCsv, rowNeedsReview } from './table.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATIC = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function createApp({ dataDir = path.join(root, 'data'), reader = nullReader, publicDir = path.join(root, 'public') } = {}) {
  const store = createStore(dataDir);

  async function readReceipt(rec) {
    try {
      const raw = await reader(await store.readImage(rec), { id: rec.id });
      rec.fields = normalize(raw);
      rec.status = 'done';
    } catch (e) {
      rec.fields = normalize({});
      rec.status = 'failed';
      rec.error = String(e?.message ?? e);
    }
    await store.save(rec);
  }
  // 再起動で reading のまま残ったものを読み直す
  const resumed = store.list().then((all) => Promise.all(all.filter((r) => r.status === 'reading').map(readReceipt)));

  const view = (r) => ({ ...r, needs_review: rowNeedsReview(r), image_url: `/receipts/${r.id}/image` });
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
        setImmediate(() => readReceipt(rec));
        return json(res, 201, view(rec));
      }
      if (req.method === 'GET' && p === '/receipts') {
        const t = buildTable(await store.list(), url.searchParams.get('month') ?? undefined);
        return json(res, 200, { ...t, rows: t.rows.map(view) });
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
          if (rec.status === 'reading') return fail(res, 409, '読み取り中です。完了後に直してください');
          let patch;
          try { patch = JSON.parse((await body(req, 65536)).toString('utf8')); } catch { return fail(res, 400, 'JSON が不正です'); }
          const keys = Object.keys(patch ?? {});
          if (!keys.length || keys.some((k) => !FIELDS.includes(k))) return fail(res, 400, `直せる項目: ${FIELDS.join(', ')}`);
          try { for (const k of keys) rec.fields[k] = editedField(k, patch[k]); } catch (e) { return fail(res, 400, e.message); }
          rec.edited = true;
          await store.save(rec);
          return json(res, 200, view(rec));
        }
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
      if (req.method === 'GET') { // フロントの静的ファイル（public/）
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
  return { server, store, ready: resumed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const { server } = createApp();
  server.listen(port, '0.0.0.0', () => console.log(`http://0.0.0.0:${port}`));
}
