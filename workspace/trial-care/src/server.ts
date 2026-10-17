import { createServer as httpServer, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { daysBefore, tokyoDate, tokyoTime } from "./dates.ts";
import { openStore } from "./store.ts";
import type { Tokens } from "./config.ts";

type Options = {
  dataFile: string;
  tokens: Tokens;
  publicDir: string;
  now?: () => Date;
};

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const plain = (res: ServerResponse, status: number, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end();
};

export const createServer = (opts: Options): Server => {
  const store = openStore(opts.dataFile);
  const now = opts.now ?? (() => new Date());

  const day = (date: string) => {
    const r = store.get(date);
    return r ? { taken: true, date, at: r.at } : { taken: false, date };
  };

  return httpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const [, area, token, action, ...rest] = path.split("/");
      const secret = area === "m" ? opts.tokens.mother : area === "f" ? opts.tokens.family : undefined;
      if (!secret || !token || !same(token, secret) || rest.length) return plain(res, 404);

      const method = req.method ?? "GET";
      const allow = (m: string) => method === m || (plain(res, 405, { allow: m }), false);

      if (action === undefined) return plain(res, 308, { location: `${path}/` });
      if (action === "") {
        if (!allow("GET")) return;
        const html = await readFile(join(opts.publicDir, `${area}.html`)).catch(() => undefined);
        if (!html) return plain(res, 404);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return void res.end(html);
      }

      const date = tokyoDate(now());
      if (area === "m" && action === "today") {
        if (allow("GET")) json(res, 200, day(date));
      } else if (area === "m" && action === "taken") {
        if (!allow("POST")) return;
        // ?date= で「あとから」記録する。時刻は押した時刻。画面に出ている今日+過去3日だけ受ける
        const target = url.searchParams.has("date") ? url.searchParams.get("date")! : date;
        if (![0, 1, 2, 3].some((n) => daysBefore(date, n) === target)) return plain(res, 400);
        const r = store.record(target, tokyoTime(now()));
        json(res, 200, { taken: true, date: target, at: r.at });
      } else if (area === "f" && action === "status") {
        if (!allow("GET")) return;
        const days = [3, 2, 1].map((n) => day(daysBefore(date, n)));
        json(res, 200, { today: day(date), days });
      } else {
        plain(res, 404);
      }
    } catch (e) {
      console.error(e);
      if (!res.headersSent) plain(res, 500);
    }
  });
};
