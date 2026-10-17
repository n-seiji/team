// 画面確認用のモックサーバー(田中さんの本物のサーバーができるまで)。
// 使い方: node mock/server.mjs  → http://localhost:8787/ (スタッフ) /owner.html (合言葉: test)
// FAIL=1 で提出が必ず失敗する(失敗時の表示確認用)。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const staff = [
  { id: 's1', name: '陳 美玲', hourlyWage: 1100, weeklyLimit: 28 },
  { id: 's2', name: '山田 太郎', hourlyWage: 1050 },
  { id: 's3', name: '佐々木 葵', hourlyWage: 1100 },
];
const store = {}; // `${month}|${id}` -> {submittedAt, days}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s ? JSON.parse(s) : {})); });
const jst = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, '+09:00');
const hours = (s) => { const t = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)); return (t(s.end) - t(s.start)) / 60; };
const mondayOf = (date) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const month = url.searchParams.get('month');
  let m;
  if (p === '/api/staff') return json(res, 200, staff.map(({ id, name }) => ({ id, name })));
  if ((m = /^\/api\/staff\/([^/]+)\/requests$/.exec(p))) {
    const k = `${month}|${m[1]}`;
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (process.env.FAIL) return json(res, 500, { error: '保存に失敗しました' });
      store[k] = { submittedAt: jst(), days: b.days };
      return json(res, 200, { receivedAt: store[k].submittedAt });
    }
    const v = store[k];
    return json(res, 200, v ? { submitted: true, ...v } : { submitted: false, submittedAt: null, days: {} });
  }
  if (p.startsWith('/api/owner/') || p === '/api/calc') {
    if (req.headers['x-owner-pass'] !== 'test') return json(res, 401, { error: '合言葉が違います' });
    if (p === '/api/owner/requests') {
      return json(res, 200, { month, staff: staff.map((s) => ({ ...s, submittedAt: store[`${month}|${s.id}`]?.submittedAt ?? null, days: store[`${month}|${s.id}`]?.days ?? {} })) });
    }
    if (p === '/api/calc') {
      const b = await readBody(req);
      let total = 0; const weeks = {};
      for (const s of b.shifts) {
        const st = staff.find((x) => x.id === s.staffId);
        total += hours(s) * st.hourlyWage;
        const k = `${s.staffId}|${mondayOf(s.date)}`; weeks[k] = (weeks[k] || 0) + hours(s);
      }
      total = Math.round(total);
      const rate = b.revenue ? total / b.revenue : 0;
      const overLimit = Object.entries(weeks).flatMap(([k, h]) => {
        const [id, weekStart] = k.split('|'); const st = staff.find((x) => x.id === id);
        return st.weeklyLimit && h > st.weeklyLimit ? [{ staffId: id, name: st.name, weekStart, hours: h, limit: st.weeklyLimit }] : [];
      });
      return json(res, 200, { totalCost: total, rate, targetRate: b.targetRate, diffPoints: Math.round((rate - b.targetRate) * 1000) / 10, overLimit });
    }
  }
  const file = p === '/' ? '/index.html' : p;
  try {
    const path = join(root, normalize(file));
    if (!path.startsWith(root)) throw new Error();
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/plain' });
    res.end(await readFile(path));
  } catch { json(res, 404, { error: 'not found' }); }
}).listen(8787, () => console.log('mock: http://localhost:8787/'));
