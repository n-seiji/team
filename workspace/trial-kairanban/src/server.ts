import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { Store } from "./store.ts";
import { qrSvg } from "./qr.ts";

export const MSG_INVALID_LINK = "このリンクは使えません";
export const MSG_BAD_KEY = "キーが違います。班長さんに確認してください";

const MAX_BODY = 64 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface ServerOptions {
  adminKey: string | undefined;
  /** QR と「リンクをコピー」に焼く URL の頭。例: https://kairan.example.jp */
  publicUrl: string;
  publicDir?: string;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "送る内容が大きすぎます");
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fallthrough */ }
  throw new HttpError(400, "JSON の形が正しくありません");
}

function requiredText(v: unknown, label: string, max: number): string {
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(400, `${label}を入力してください`);
  if (v.length > max) throw new HttpError(400, `${label}が長すぎます`);
  return v.trim();
}

function isAdmin(req: IncomingMessage, adminKey: string | undefined): boolean {
  if (!adminKey) return false;
  const given = req.headers["x-admin-key"];
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(adminKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** http(s) の URL だけを受け付け、末尾の / を取る。不正なら例外。 */
export function normalizePublicUrl(v: string | undefined): string {
  let u: URL;
  try { u = new URL(v ?? ""); } catch { throw new Error(`PUBLIC_URL が正しくありません: ${v ?? "(未設定)"}`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`PUBLIC_URL は http(s) で始めてください: ${v}`);
  return (u.origin + u.pathname).replace(/\/+$/, "");
}

export function createApp(store: Store, opts: ServerOptions): Server {
  const base = normalizePublicUrl(opts.publicUrl);
  const link = (token: string) => `${base}/r/${token}`;

  const residentView = (token: string, circularId?: number) => {
    const household = store.getHouseholdByToken(token);
    if (!household) throw new HttpError(404, MSG_INVALID_LINK);
    // 指定が無ければ一番古い未読、全部読んでいれば最新
    const unread = store.unreadCirculars(household.id);
    const circular = circularId === undefined ? unread[0] ?? store.latestCircular() : store.getCircular(circularId);
    if (!circular) return { household: { name: household.name }, circular: null, title: null, body: null, status: "unread", readAt: null, unreadCount: 0 };
    const reading = store.getReading(circular.id, household.id);
    const unreadCount = unread.filter((c) => c.id !== circular.id).length;
    return {
      household: { name: household.name },
      circular: { id: circular.id, title: circular.title, body: circular.body },
      title: circular.title,
      body: circular.body,
      status: reading.status,
      readAt: reading.readAt,
      unreadCount,
    };
  };

  async function api(req: IncomingMessage, url: URL): Promise<{ status: number; body: unknown }> {
    const method = req.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // "api" を除く
    const num = (s: string | undefined) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 1) throw new HttpError(404, "見つかりません");
      return n;
    };

    // 住民: 管理キー不要
    if (parts[0] === "r" && parts[1]) {
      const token = parts[1];
      if (parts.length === 2 && method === "GET") {
        const c = url.searchParams.get("circular");
        return { status: 200, body: residentView(token, c ? num(c) : undefined) };
      }
      if (parts.length === 3 && parts[2] === "read" && method === "POST") {
        const household = store.getHouseholdByToken(token);
        if (!household) throw new HttpError(404, MSG_INVALID_LINK);
        const body = await readJson(req);
        const cid = body.circularId === undefined ? store.latestCircular()?.id : num(String(body.circularId));
        if (cid === undefined || !store.getCircular(cid)) throw new HttpError(404, "回覧が見つかりません");
        store.markSelfRead(cid, household.id);
        return { status: 200, body: residentView(token, cid) };
      }
      throw new HttpError(404, "見つかりません");
    }

    // 班長: 管理キー必須
    if (!isAdmin(req, opts.adminKey)) throw new HttpError(401, MSG_BAD_KEY);

    // 画面向けの別名 (/api/admin/...)。形は画面側 (admin.js) の約束に合わせる
    if (parts[0] === "admin" && parts[1] === "circulars") {
      if (parts.length === 2 && method === "GET") {
        return { status: 200, body: store.listCirculars().map((c) => ({ id: c.id, title: c.title })) };
      }
      if (parts.length === 3 && method === "GET") {
        const circular = store.getCircular(num(parts[2]));
        if (!circular) throw new HttpError(404, "回覧が見つかりません");
        const households = store.statusBoard(circular.id).map(({ household, reading }) => ({
          id: household.id, name: household.name, status: reading.status, readAt: reading.readAt, url: link(household.token),
        }));
        return { status: 200, body: { id: circular.id, title: circular.title, households } };
      }
      if (parts.length === 6 && parts[3] === "households" && parts[5] === "proxy" && method === "POST") {
        const circular = store.getCircular(num(parts[2]));
        const hid = num(parts[4]);
        if (!circular || !store.listHouseholds().some((h) => h.id === hid)) throw new HttpError(404, "見つかりません");
        return { status: 200, body: store.markProxyRead(circular.id, hid) };
      }
    }

    // 印刷用: 全世帯の名前・リンク・QR (SVG)。作り直したリンクは新しい URL で出る
    if (parts[0] === "admin" && parts[1] === "print" && parts.length === 2 && method === "GET") {
      return {
        status: 200,
        body: store.listHouseholds().map((h) => ({ id: h.id, name: h.name, url: link(h.token), qrSvg: qrSvg(link(h.token)) })),
      };
    }

    if (parts[0] === "circulars") {
      if (parts.length === 1 && method === "POST") {
        const b = await readJson(req);
        const c = store.addCircular(requiredText(b.title, "タイトル", 200), requiredText(b.body, "本文", 20000));
        return { status: 201, body: c };
      }
      if (parts.length === 1 && method === "GET") return { status: 200, body: { circulars: store.listCirculars() } };
      if (parts.length === 3 && parts[2] === "status" && method === "GET") {
        const circular = store.getCircular(num(parts[1]));
        if (!circular) throw new HttpError(404, "回覧が見つかりません");
        const households = store.statusBoard(circular.id).map(({ household, reading }) => ({
          id: household.id, name: household.name, status: reading.status, readAt: reading.readAt, link: link(household.token),
        }));
        const readCount = households.filter((h) => h.status !== "unread").length;
        return { status: 200, body: { circular, readCount, total: households.length, households } };
      }
      if (parts.length === 5 && parts[2] === "households" && parts[4] === "proxy-read" && method === "POST") {
        const circular = store.getCircular(num(parts[1]));
        const hid = num(parts[3]);
        if (!circular || !store.listHouseholds().some((h) => h.id === hid)) throw new HttpError(404, "見つかりません");
        return { status: 200, body: store.markProxyRead(circular.id, hid) };
      }
    }

    if (parts[0] === "households") {
      if (parts.length === 1 && method === "POST") {
        const h = store.addHousehold(requiredText((await readJson(req)).name, "表示名", 50));
        return { status: 201, body: { id: h.id, name: h.name, link: link(h.token) } };
      }
      if (parts.length === 1 && method === "GET") {
        return { status: 200, body: { households: store.listHouseholds().map((h) => ({ id: h.id, name: h.name, link: link(h.token) })) } };
      }
      if (parts.length === 3 && parts[2] === "reissue" && method === "POST") {
        const h = store.reissueToken(num(parts[1]));
        if (!h) throw new HttpError(404, "見つかりません");
        return { status: 200, body: { id: h.id, name: h.name, link: link(h.token) } };
      }
    }
    throw new HttpError(404, "見つかりません");
  }

  async function serveStatic(url: URL, res: ServerResponse): Promise<void> {
    const dir = opts.publicDir;
    let path = url.pathname;
    if (path.startsWith("/r/")) path = "/resident.html";
    else if (path === "/admin" || path === "/") path = "/admin.html";
    const rel = normalize(path).replace(/^([/\\])+/, "");
    if (!dir || rel.split(/[/\\]/).includes("..")) throw new HttpError(404, "見つかりません");
    try {
      const data = await readFile(join(dir, rel));
      res.writeHead(200, { "content-type": MIME[extname(rel)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    } catch {
      throw new HttpError(404, "見つかりません");
    }
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const r = await api(req, url);
        send(res, r.status, r.body);
      } else if (req.method === "GET") {
        await serveStatic(url, res);
      } else {
        throw new HttpError(404, "見つかりません");
      }
    } catch (e) {
      if (e instanceof HttpError) {
        if (String(req.url).startsWith("/api/")) send(res, e.status, { error: e.message });
        else { res.writeHead(e.status, { "content-type": "text/plain; charset=utf-8" }); res.end(e.message); }
      } else {
        console.error(e);
        send(res, 500, { error: "サーバーでエラーが起きました" });
      }
    }
  });
}
