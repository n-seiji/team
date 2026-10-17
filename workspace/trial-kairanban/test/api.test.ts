import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Store } from "../src/store.ts";
import { createApp, MSG_INVALID_LINK, normalizePublicUrl } from "../src/server.ts";

const KEY = "test-key";
const PUB = "https://kairan.example.jp";
let store: Store;
let server: Server;
let base: string;
let clock: number;

beforeEach(async () => {
  clock = Date.parse("2026-10-01T09:00:00Z");
  store = new Store(":memory:", () => new Date(clock));
  server = createApp(store, { adminKey: KEY, publicUrl: PUB });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  store.close();
});

async function call(method: string, path: string, body?: unknown, key: string | null = KEY) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-admin-key"] = key;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
}
const tokenOf = (link: string) => link.replace(`${PUB}/r/`, "");

async function setup() {
  const c = (await call("POST", "/api/circulars", { title: "ごみ収集日の変更", body: "来月から火曜です" })).json;
  const h = (await call("POST", "/api/households", { name: "山田さん" })).json;
  return { cid: c.id as number, hid: h.id as number, token: tokenOf(h.link) };
}
const board = async (cid: number) => (await call("GET", `/api/circulars/${cid}/status`)).json;

test("登録: 回覧と複数の世帯を登録でき、世帯は表示名だけ・トークンは長く別々", async () => {
  const { cid, token } = await setup();
  await call("POST", "/api/households", { name: "佐々木さん" });
  const b = await board(cid);
  assert.equal(b.total, 2);
  assert.deepEqual(Object.keys(b.households[0]).sort(), ["id", "link", "name", "readAt", "status"]);
  assert.ok(token.length >= 32);
  assert.notEqual(b.households[0].link, b.households[1].link);
  assert.equal((await call("POST", "/api/households", { name: "  " })).status, 400);
});

test("読了記録: 本人が押すと本人が読んだ+日時、2回押しても最初の日時が残る", async () => {
  const { cid, token } = await setup();
  const first = await call("POST", `/api/r/${token}/read`, {}, null);
  assert.equal(first.status, 200);
  assert.equal(first.json.status, "self");
  assert.equal(first.json.readAt, "2026-10-01T09:00:00.000Z");
  clock += 3600_000;
  const second = await call("POST", `/api/r/${token}/read`, {}, null);
  assert.equal(second.status, 200);
  assert.equal(second.json.readAt, "2026-10-01T09:00:00.000Z");
  const view = await call("GET", `/api/r/${token}`, undefined, null);
  assert.equal(view.json.circular.title, "ごみ収集日の変更");
  assert.equal(view.json.status, "self");
  const b = await board(cid);
  assert.equal(b.readCount, 1);
});

test("代理記録: 班長の代理記録→本人が上書き、本人が読んだ世帯は変わらない", async () => {
  const { cid, hid, token } = await setup();
  const p = await call("POST", `/api/circulars/${cid}/households/${hid}/proxy-read`);
  assert.equal(p.json.status, "proxy");
  assert.equal(p.json.readAt, "2026-10-01T09:00:00.000Z");
  clock += 86400_000;
  await call("POST", `/api/r/${token}/read`, {}, null);
  let h = (await board(cid)).households[0];
  assert.equal(h.status, "self");
  assert.equal(h.readAt, "2026-10-02T09:00:00.000Z");
  clock += 86400_000;
  const again = await call("POST", `/api/circulars/${cid}/households/${hid}/proxy-read`);
  assert.equal(again.json.status, "self");
  h = (await board(cid)).households[0];
  assert.equal(h.status, "self");
  assert.equal(h.readAt, "2026-10-02T09:00:00.000Z");
});

test("無効トークン: 回覧は見えず「このリンクは使えません」、再発行で古いリンクも無効", async () => {
  const { token, hid } = await setup();
  const bad = await call("GET", "/api/r/nonexistent", undefined, null);
  assert.equal(bad.status, 404);
  assert.equal(bad.json.error, MSG_INVALID_LINK);
  assert.equal(JSON.stringify(bad.json).includes("ごみ"), false);
  assert.equal((await call("POST", "/api/r/nonexistent/read", {}, null)).status, 404);
  const re = await call("POST", `/api/households/${hid}/reissue`);
  assert.equal(re.status, 200);
  assert.notEqual(tokenOf(re.json.link), token);
  assert.equal((await call("GET", `/api/r/${token}`, undefined, null)).status, 404);
  assert.equal((await call("GET", `/api/r/${tokenOf(re.json.link)}`, undefined, null)).status, 200);
});

test("管理キー: キーなし・違うキーは班長 API をすべて拒否、住民 API は通る", async () => {
  const { cid, hid, token } = await setup();
  const admin: [string, string, unknown?][] = [
    ["POST", "/api/circulars", { title: "a", body: "b" }],
    ["GET", "/api/circulars"],
    ["POST", "/api/households", { name: "x" }],
    ["GET", "/api/households"],
    ["GET", `/api/circulars/${cid}/status`],
    ["POST", `/api/circulars/${cid}/households/${hid}/proxy-read`],
    ["POST", `/api/households/${hid}/reissue`],
    ["GET", "/api/admin/print"],
  ];
  for (const [m, p, b] of admin) {
    for (const key of [null, "wrong"]) {
      const r = await call(m, p, b, key);
      assert.equal(r.status, 401, `${m} ${p} key=${key}`);
      assert.equal(r.json.error, "キーが違います。班長さんに確認してください");
    }
  }
  assert.equal((await call("GET", `/api/r/${token}`, undefined, null)).status, 200);
  assert.equal((await call("POST", `/api/r/${token}/read`, {}, null)).status, 200);
});

test("管理キーが未設定のサーバーは班長 API を全拒否する", async () => {
  const s2 = createApp(store, { adminKey: undefined, publicUrl: PUB });
  await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
  const port = (s2.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/circulars`, { headers: { "x-admin-key": "" } });
  assert.equal(res.status, 401);
  await new Promise((r) => s2.close(r));
});

test("画面向け API: 住民は title/body/status/readAt、班長は /api/admin/* で一覧と代理記録、キー無しは401", async () => {
  const { cid, hid, token } = await setup();
  const r = await call("GET", `/api/r/${token}`, undefined, null);
  assert.equal(r.json.title, "ごみ収集日の変更");
  assert.equal(r.json.body, "来月から火曜です");
  assert.equal(r.json.status, "unread");
  assert.equal((await call("GET", "/api/admin/circulars", undefined, null)).status, 401);
  assert.equal((await call("GET", `/api/admin/circulars/${cid}`, undefined, "wrong")).status, 401);
  assert.deepEqual((await call("GET", "/api/admin/circulars")).json, [{ id: cid, title: "ごみ収集日の変更" }]);
  const d = (await call("GET", `/api/admin/circulars/${cid}`)).json;
  assert.equal(d.households[0].url, `${PUB}/r/${token}`);
  assert.equal((await call("POST", `/api/admin/circulars/${cid}/households/${hid}/proxy`, undefined, null)).status, 401);
  assert.equal((await call("POST", `/api/admin/circulars/${cid}/households/${hid}/proxy`)).status, 200);
  assert.equal((await call("GET", `/api/admin/circulars/${cid}`)).json.households[0].status, "proxy");
});

test("未読の順番: 3件の回覧は古い未読から出て、1件ずつ読むと進み、全部読むと最新に戻る", async () => {
  const { token } = await setup(); // 1件目: ごみ収集日の変更
  await call("POST", "/api/circulars", { title: "秋祭り", body: "10月です" });
  await call("POST", "/api/circulars", { title: "防災訓練", body: "11月です" });
  const view = async () => (await call("GET", `/api/r/${token}`, undefined, null)).json;

  let v = await view();
  assert.deepEqual([v.title, v.status, v.unreadCount], ["ごみ収集日の変更", "unread", 2]);
  let p = await call("POST", `/api/r/${token}/read`, { circularId: v.circular.id }, null);
  assert.deepEqual([p.json.title, p.json.status, p.json.unreadCount], ["ごみ収集日の変更", "self", 2]);

  v = await view();
  assert.deepEqual([v.title, v.unreadCount], ["秋祭り", 1]);
  p = await call("POST", `/api/r/${token}/read`, { circularId: v.circular.id }, null);
  assert.equal(p.json.unreadCount, 1);

  v = await view();
  assert.deepEqual([v.title, v.unreadCount], ["防災訓練", 0]);
  p = await call("POST", `/api/r/${token}/read`, { circularId: v.circular.id }, null);
  assert.equal(p.json.unreadCount, 0);

  v = await view();
  assert.deepEqual([v.title, v.status, v.unreadCount], ["防災訓練", "self", 0]);
});

test("未読の順番: 代理記録された回覧は未読に数えず、飛ばされる", async () => {
  const { cid, hid, token } = await setup();
  await call("POST", "/api/circulars", { title: "秋祭り", body: "10月です" });
  await call("POST", `/api/circulars/${cid}/households/${hid}/proxy-read`);
  const v = (await call("GET", `/api/r/${token}`, undefined, null)).json;
  assert.deepEqual([v.title, v.unreadCount], ["秋祭り", 0]);
});

test("PUBLIC_URL: 管理 API のリンクは PUBLIC_URL から作った完全な URL、不正な値は拒否", async () => {
  const { cid } = await setup();
  const d = (await call("GET", `/api/admin/circulars/${cid}`)).json;
  assert.match(d.households[0].url, /^https:\/\/kairan\.example\.jp\/r\/[A-Za-z0-9_-]{32}$/);
  assert.equal(normalizePublicUrl("https://kairan.example.jp/"), PUB);
  for (const bad of [undefined, "", "kairan.example.jp", "ftp://x"]) assert.throws(() => normalizePublicUrl(bad));
});

test("印刷 API: 全世帯の name/url/qrSvg を返し、作り直すと新しい URL の QR になる", async () => {
  const { hid } = await setup();
  await call("POST", "/api/households", { name: "佐々木さん" });
  const before = (await call("GET", "/api/admin/print")).json;
  assert.deepEqual(before.map((p: any) => p.name), ["山田さん", "佐々木さん"]);
  for (const p of before) {
    assert.match(p.url, new RegExp(`^${PUB}/r/[A-Za-z0-9_-]{32}$`));
    assert.match(p.qrSvg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  }
  const re = (await call("POST", `/api/households/${hid}/reissue`)).json;
  const after = (await call("GET", "/api/admin/print")).json;
  assert.equal(after[0].url, re.link);
  assert.notEqual(after[0].qrSvg, before[0].qrSvg);
  assert.equal(after[1].qrSvg, before[1].qrSvg);
});
