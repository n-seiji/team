import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { calc, CalcError, isMonth } from './calc.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const MAX_BODY = 256 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function jstIso(d = new Date()) {
  const j = new Date(d.getTime() + 9 * 3600000);
  return j.toISOString().replace(/\.\d+Z$/, '+09:00');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, '送信内容が大きすぎます')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch { reject(new HttpError(400, 'JSON が不正です')); }
    });
    req.on('error', reject);
  });
}

function validateStaffInput(b, partial) {
  if (!b || typeof b !== 'object') throw new HttpError(400, '入力が不正です');
  const out = {};
  if (!partial || 'name' in b) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 40) throw new HttpError(400, '名前は1〜40文字で入力してください');
    out.name = b.name.trim();
  }
  if (!partial || 'wage' in b) {
    if (!Number.isInteger(b.wage) || b.wage <= 0 || b.wage > 100000) throw new HttpError(400, '時給は1以上の整数で入力してください');
    out.wage = b.wage;
  }
  if ('weeklyLimit' in b) {
    if (b.weeklyLimit === null) out.weeklyLimit = null;
    else if (typeof b.weeklyLimit === 'number' && b.weeklyLimit > 0 && b.weeklyLimit <= 168) out.weeklyLimit = b.weeklyLimit;
    else throw new HttpError(400, '週上限は0より大きい時間(数値)か null にしてください');
  }
  return out;
}

function validateDays(month, days) {
  if (!days || typeof days !== 'object' || Array.isArray(days)) throw new HttpError(400, 'days が不正です');
  const out = {};
  for (const [date, v] of Object.entries(days)) {
    const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(month + '-') || new Date(t).toISOString().slice(0, 10) !== date)
      throw new HttpError(400, `${month} の日付ではありません: ${date}`);
    if (!v || typeof v.available !== 'boolean') throw new HttpError(400, `${date}: available は true/false で指定してください`);
    const note = v.note ?? '';
    if (typeof note !== 'string' || note.length > 200) throw new HttpError(400, `${date}: メモは200文字までです`);
    out[date] = { available: v.available, note };
  }
  return out;
}

export function createApp({ store, passphrase, publicDir, now = () => new Date() }) {
  if (!passphrase) throw new Error('passphrase が必要です');
  const pass = Buffer.from(passphrase);

  function requireOwner(req) {
    const given = Buffer.from(String(req.headers['x-owner-pass'] ?? ''));
    if (given.length !== pass.length || !timingSafeEqual(given, pass)) throw new HttpError(401, '合言葉が違います');
  }
  const monthOf = (url) => {
    const m = url.searchParams.get('month');
    if (!isMonth(m)) throw new HttpError(400, 'month は YYYY-MM で指定してください');
    return m;
  };
  const findStaff = (id) => {
    const s = store.get().staff.find((x) => x.id === id);
    if (!s) throw new HttpError(404, 'スタッフが見つかりません');
    return s;
  };

  async function route(req, url) {
    const { pathname } = url;
    const method = req.method;
    let m;

    if (pathname === '/api/staff' && method === 'GET')
      return store.get().staff.map(({ id, name }) => ({ id, name }));

    if ((m = /^\/api\/staff\/([^/]+)\/requests$/.exec(pathname))) {
      const staff = findStaff(m[1]);
      const month = monthOf(url);
      if (method === 'GET') {
        const r = store.get().requests[month]?.[staff.id];
        return r ? { submitted: true, submittedAt: r.submittedAt, days: r.days } : { submitted: false, submittedAt: null, days: {} };
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        const days = validateDays(month, body?.days);
        const receivedAt = jstIso(now());
        try {
          store.update((d) => { (d.requests[month] ??= {})[staff.id] = { submittedAt: receivedAt, days }; });
        } catch (e) {
          console.error('save failed', e);
          throw new HttpError(500, '保存できませんでした。もう一度お試しください');
        }
        return { receivedAt };
      }
      throw new HttpError(405, 'メソッドが許可されていません');
    }

    if (pathname.startsWith('/api/owner/') || pathname === '/api/calc') {
      requireOwner(req);
      if (pathname === '/api/owner/staff' && method === 'GET') return store.get().staff;
      if (pathname === '/api/owner/staff' && method === 'POST') {
        const input = validateStaffInput(await readJson(req), false);
        return store.update((d) => {
          const s = { id: `s${d.nextStaffId++}`, name: input.name, wage: input.wage, weeklyLimit: input.weeklyLimit ?? null };
          d.staff.push(s);
          return s;
        });
      }
      if ((m = /^\/api\/owner\/staff\/([^/]+)$/.exec(pathname)) && method === 'PUT') {
        findStaff(m[1]);
        const input = validateStaffInput(await readJson(req), true);
        return store.update((d) => Object.assign(d.staff.find((x) => x.id === m[1]), input));
      }
      if (pathname === '/api/owner/requests' && method === 'GET') {
        const month = monthOf(url);
        const reqs = store.get().requests[month] ?? {};
        return {
          month,
          staff: store.get().staff.map((s) => ({
            id: s.id, name: s.name,
            submittedAt: reqs[s.id]?.submittedAt ?? null,
            days: reqs[s.id]?.days ?? {},
          })),
        };
      }
      if (pathname === '/api/calc' && method === 'POST') {
        const b = await readJson(req);
        if (!b || typeof b !== 'object') throw new HttpError(400, '入力が不正です');
        try { return calc({ ...b, staff: store.get().staff }); }
        catch (e) { if (e instanceof CalcError) throw new HttpError(400, e.message); throw e; }
      }
    }

    if (pathname.startsWith('/api/')) throw new HttpError(404, 'APIが見つかりません');
    return null;
  }

  async function serveStatic(pathname, res) {
    if (!publicDir) throw new HttpError(404, 'Not Found');
    const rel = normalize(pathname === '/' ? '/index.html' : pathname);
    if (rel.includes('..')) throw new HttpError(404, 'Not Found');
    try {
      const body = await readFile(join(publicDir, rel));
      res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { throw new HttpError(404, 'Not Found'); }
  }

  return createServer(async (req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const result = await route(req, url);
      if (result !== null) return send(200, result);
      await serveStatic(url.pathname, res);
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: 'サーバーエラーです' });
    }
  });
}
