import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DomainError, loadRoster, Store } from "./store.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

export function createApp(store: Store, publicDir = join(ROOT, "web")) {
  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    let s = "";
    for await (const chunk of req) { s += chunk; if (s.length > 100_000) throw new DomainError(413, "大きすぎます"); }
    try { return s ? JSON.parse(s) : {}; } catch { throw new DomainError(400, "JSON が不正です"); }
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const p = url.pathname;
      if (p.startsWith("/api/")) {
        let m: RegExpMatchArray | null;
        if (req.method === "GET" && p === "/api/groups") return send(res, 200, store.publicGroups());
        if (req.method === "GET" && p === "/api/circulars") return send(res, 200, store.list());
        if (req.method === "POST" && p === "/api/circulars") return send(res, 201, store.createCircular(await readBody(req) as never));
        if (req.method === "GET" && (m = p.match(/^\/api\/circulars\/([^/]+)$/))) return send(res, 200, store.view(m[1]));
        if (req.method === "GET" && (m = p.match(/^\/api\/circulars\/([^/]+)\/history$/))) return send(res, 200, store.history(m[1], url.searchParams.get("houseId") ?? undefined));
        if (req.method === "POST" && (m = p.match(/^\/api\/circulars\/([^/]+)\/records$/))) {
          const b = await readBody(req);
          store.record({ ...(b as never), circularId: m[1] });
          return send(res, 201, store.view(m[1]));
        }
        throw new DomainError(404, "そのAPIはありません");
      }
      if (req.method !== "GET") throw new DomainError(405, "GET のみです");
      const rel = normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, "");
      const file = join(publicDir, rel);
      if (!file.startsWith(publicDir)) throw new DomainError(403, "禁止");
      try {
        const data = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(data);
      } catch { throw new DomainError(404, "ありません"); }
    } catch (e) {
      if (e instanceof DomainError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: "サーバーエラー" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = process.env.KAIRAN_DATA ?? join(ROOT, "data");
  const store = new Store(loadRoster(join(dataDir, "roster.json")), { logPath: join(dataDir, "events.jsonl") });
  const port = Number(process.env.PORT ?? 3000);
  createApp(store).listen(port, () => console.log(`回覧板 http://localhost:${port}/ (データ: ${dataDir})`));
}
