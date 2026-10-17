import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { openStore } from './store.js';
import { createLedger } from './ledger.js';
import { openMembers } from './members.js';
import { AppError } from './errors.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

export function loadMembers(file) {
  const members = JSON.parse(readFileSync(file, 'utf8'));
  const ids = members.map((m) => m.id);
  if (!members.every((m) => m.id && m.name) || new Set(ids).size !== ids.length) {
    throw new Error(`${file}: メンバーは {id, name} の配列で、id は重複させないでください。`);
  }
  return members;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new AppError('body_invalid', '送られた内容を読み取れませんでした。もう一度お試しください。');
  }
}

export function createApp({ ledger, memberStore, publicDir = join(root, 'web') }) {
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  async function api(req, res, path) {
    const m = (re) => path.match(re);
    const method = req.method;
    let x;
    if (method === 'GET' && path === '/members') return send(res, 200, { members: ledger.members() });
    if (method === 'POST' && path === '/members') return send(res, 201, { member: memberStore.add(await readBody(req)) });
    if ((x = m(/^\/members\/([^/]+)$/)) && method === 'PATCH') {
      return send(res, 200, { member: memberStore.rename(decodeURIComponent(x[1]), await readBody(req)) });
    }
    if (method === 'GET' && path === '/entries') return send(res, 200, ledger.list());
    if (method === 'GET' && path === '/settlement') return send(res, 200, ledger.settlement());
    if (method === 'POST' && path === '/entries') return send(res, 201, { entry: ledger.create(await readBody(req)) });
    if (method === 'POST' && path === '/settle') return send(res, 200, ledger.settleAll());
    if (method === 'POST' && path === '/settle/undo') return send(res, 200, ledger.undoSettleAll());
    if ((x = m(/^\/entries\/(\d+)$/))) {
      if (method === 'PATCH') return send(res, 200, { entry: ledger.update(x[1], await readBody(req)) });
      if (method === 'DELETE') return send(res, 200, { entry: ledger.remove(x[1]) });
    }
    if ((x = m(/^\/entries\/(\d+)\/settled$/))) {
      if (method === 'PUT') return send(res, 200, { entry: ledger.markSettled(x[1]) });
      if (method === 'DELETE') return send(res, 200, { entry: ledger.unmarkSettled(x[1]) });
    }
    throw new AppError('not_found', 'そのAPIはありません。', 404);
  }

  function serveStatic(req, res, path) {
    const rel = normalize(path === '/' ? '/index.html' : path);
    const file = join(publicDir, rel);
    if (!file.startsWith(publicDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      return send(res, 404, { error: { code: 'not_found', message: 'ページが見つかりません。' } });
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    try {
      const isApi = /^\/(members|entries|settlement|settle)(\/|$)/.test(path);
      if (isApi) await api(req, res, path);
      else if (req.method === 'GET') serveStatic(req, res, path);
      else throw new AppError('not_found', 'そのAPIはありません。', 404);
    } catch (err) {
      if (err instanceof AppError) {
        return send(res, err.status, { error: { code: err.code, message: err.message } });
      }
      console.error(err);
      send(res, 500, { error: { code: 'internal', message: 'サーバーでエラーが起きました。もう一度お試しください。' } });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seed = existsSync(process.env.MEMBERS_FILE ?? join(root, 'config/members.json'))
    ? loadMembers(process.env.MEMBERS_FILE ?? join(root, 'config/members.json'))
    : [];
  const memberStore = openMembers({ file: process.env.MEMBERS_DATA_FILE ?? join(root, 'data/members.json'), seed });
  const members = memberStore.list;
  const store = openStore(process.env.DATA_FILE ?? join(root, 'data/ledger.json'));
  const port = Number(process.env.PORT ?? 3000);
  createApp({ ledger: createLedger({ store, members }), memberStore }).listen(port, () => {
    console.log(`http://localhost:${port}  (メンバー ${members.length}人)`);
  });
}
