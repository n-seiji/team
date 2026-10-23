// T2 確認用のモックAPI(T1が出来るまでの代用)。API の形は README の「API 契約」と同じ。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web');
const DAY = 86400000, now = Date.now();
const surnames = ['青木', '井上', '上田', '遠藤', '大野', '加藤', '木村', '工藤', '小林', '斎藤', '佐々木', '清水', '高橋', '中村', '山本'];
const groups = Array.from({ length: 8 }, (_, i) => ({
  group: i + 1, pass: `g${i + 1}`, leaders: [`${surnames[i]} 班長`, `${surnames[i + 7]} 副班長`],
  houses: Array.from({ length: 15 }, (_, j) => ({ house: `${i + 1}-${j + 1}`, houseName: `${surnames[(i + j) % 15]}家(${i + 1}-${j + 1})`, mode: (i * 15 + j) % 5 === 0 ? 'paper' : 'digital', status: 'not_arrived', since: now - 12 * DAY })),
}));
// 初期状況: 班ごとの進み具合と滞留日数
[[5, 1], [9, 2], [14, 0], [3, 4], [7, 1], [2, 6], [11, 1], [6, 3]].forEach(([pos, days], i) => {
  const g = groups[i]; g.houses.forEach((h, j) => { if (j < pos) h.status = 'passed'; });
  const h = g.houses[pos]; if (h) { h.status = i === 5 ? 'on_hold' : days ? 'received' : 'not_arrived'; h.since = now - days * DAY; if (i === 3) h.status = 'not_arrived'; }
});
const circulars = [
  { id: 'c1', title: '秋の清掃活動と防災訓練のお知らせ', importance: 'important' },
  { id: 'c2', title: 'ごみ置き場の場所変更について', importance: 'normal' },
];
const current = (g) => g.houses.find((h) => h.status !== 'passed');
const view = (g) => {
  const h = current(g), d = Math.floor((now - (h?.since ?? now)) / DAY);
  return { group: g.group, doneCount: g.houses.filter((x) => x.status === 'received' || x.status === 'passed').length, totalCount: g.houses.length,
    current: h && { house: h.house, houseName: h.houseName, mode: h.mode, status: h.status, stayDays: d, holdDays: h.status === 'on_hold' ? d : undefined } };
};
const done = () => groups.every((g) => g.houses.every((h) => h.status !== 'not_arrived' && h.status !== 'on_hold'));

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (p === '/api/circulars') return send(res, 200, circulars.map((c) => ({ ...c, completed: done() })));
  if (p === '/api/leaders') return send(res, 200, groups.map((g) => ({ group: g.group, leaders: g.leaders })));
  let m = p.match(/^\/api\/circulars\/(\w+)\/status$/);
  if (m) { const c = circulars.find((x) => x.id === m[1]); return c ? send(res, 200, { ...c, completed: done(), groups: groups.map(view) }) : send(res, 404, {}); }
  m = p.match(/^\/api\/circulars\/(\w+)\/records$/);
  if (m && req.method === 'POST') {
    let b = ''; for await (const ch of req) b += ch; const r = JSON.parse(b);
    const g = groups.find((x) => x.group === r.group);
    if (!g || g.pass !== r.passphrase) return send(res, 401, { error: 'bad passphrase' });
    const h = g.houses.find((x) => x.house === r.house); if (!h) return send(res, 404, {});
    h.status = r.status; h.since = r.status === 'passed' ? h.since : Date.now();
    const nx = g.houses[g.houses.indexOf(h) + 1]; if (r.status === 'passed' && nx) nx.since = Date.now();
    return send(res, 200, { ok: true });
  }
  const file = normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, '');
  try { const buf = await readFile(join(webDir, file)); res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }); res.end(buf); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(Number(process.env.PORT ?? 3000), () => console.log('mock on http://localhost:' + (process.env.PORT ?? 3000)));
