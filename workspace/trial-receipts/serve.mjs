// web/ を配るだけの開発サーバー（標準ライブラリのみ）。API は別プロセスの想定:
//   node serve.mjs [port]   → http://<このPCのIP>:8080/?mock=1  または ?api=http://host:port
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const port = Number(process.argv[2] || process.env.PORT || 8080);

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, '0.0.0.0', () => console.log(`http://localhost:${port}/?mock=1`));
