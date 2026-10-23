import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createServer } from "../src/server.ts";

const M = "m".repeat(32);
const F = "f".repeat(32);
let now = new Date("2026-10-16T21:42:00Z"); // 日本時間 2026-10-17 06:42
let server: Server;
let base: string;
let dir: string;
let publicDir: string;

const start = async () => {
  server = createServer({
    dataFile: join(dir, "records.json"),
    tokens: { mother: M, family: F },
    publicDir,
    now: () => now,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
};
const stop = () => new Promise<void>((r) => server.close(() => r()));
const get = (p: string, init?: RequestInit) => fetch(base + p, { redirect: "manual", ...init });
const post = (p: string) => get(p, { method: "POST" });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "care-srv-"));
  publicDir = join(dir, "public");
  mkdirSync(publicDir);
  writeFileSync(join(publicDir, "m.html"), "<p>mother</p>");
  writeFileSync(join(publicDir, "f.html"), "<p>family</p>");
  await start();
});
after(stop);

test("記録前: today は taken:false と今日の日付", async () => {
  const r = await get(`/m/${M}/today`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type")!, /application\/json/);
  assert.deepEqual(await r.json(), { taken: false, date: "2026-10-17" });
});

test("POST で記録、時刻は日本時間の HH:MM", async () => {
  const r = await post(`/m/${M}/taken`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { taken: true, date: "2026-10-17", at: "06:42" });
});

test("2回目の POST も同じ形で最初の時刻を返す", async () => {
  now = new Date("2026-10-16T22:10:00Z"); // 07:10
  const r = await post(`/m/${M}/taken`);
  assert.deepEqual(await r.json(), { taken: true, date: "2026-10-17", at: "06:42" });
  const t = await (await get(`/m/${M}/today`)).json();
  assert.deepEqual(t, { taken: true, date: "2026-10-17", at: "06:42" });
});

test("再起動しても残る", async () => {
  await stop();
  await start();
  const t = await (await get(`/m/${M}/today`)).json();
  assert.equal((t as any).at, "06:42");
});

test("status: today と過去3日 (古い順・3件固定・穴埋め)", async () => {
  now = new Date("2026-10-19T21:00:00Z"); // 日本時間 10-20 06:00
  await post(`/m/${M}/taken`); // 10-20 06:00
  const s: any = await (await get(`/f/${F}/status`)).json();
  assert.deepEqual(s.today, { taken: true, date: "2026-10-20", at: "06:00" });
  assert.deepEqual(s.days, [
    { date: "2026-10-17", taken: true, at: "06:42" },
    { date: "2026-10-18", taken: false },
    { date: "2026-10-19", taken: false },
  ]);
});

test("日付が変わると『まだ』に戻る", async () => {
  now = new Date("2026-10-20T15:00:00Z"); // 日本時間 10-21 00:00
  const t = await (await get(`/m/${M}/today`)).json();
  assert.deepEqual(t, { taken: false, date: "2026-10-21" });
});

test("トークン違い・取り違えは 404 (本人用トークンで家族用は見られない)", async () => {
  for (const p of ["/m/wrong/today", `/f/${M}/status`, `/m/${F}/today`, `/f/wrong/`, "/", "/x"]) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.equal((await post(`/m/wrong/taken`)).status, 404);
});

test("家族用トークンでは記録できない", async () => {
  assert.equal((await post(`/f/${F}/taken`)).status, 404);
});

test("メソッド違いは 405", async () => {
  assert.equal((await post(`/m/${M}/today`)).status, 405);
  assert.equal((await get(`/m/${M}/taken`)).status, 405);
  assert.equal((await post(`/f/${F}/status`)).status, 405);
});

test("末尾スラッシュなしは付きへリダイレクト", async () => {
  const r = await get(`/m/${M}`);
  assert.equal(r.status, 308);
  assert.equal(r.headers.get("location"), `/m/${M}/`);
  const r2 = await get(`/f/${F}`);
  assert.equal(r2.headers.get("location"), `/f/${F}/`);
});

test("HTML を配信する", async () => {
  const m = await get(`/m/${M}/`);
  assert.equal(m.status, 200);
  assert.match(m.headers.get("content-type")!, /text\/html/);
  assert.equal(await m.text(), "<p>mother</p>");
  assert.equal(await (await get(`/f/${F}/`)).text(), "<p>family</p>");
});

test("API は no-store (古い『飲んだ』をキャッシュさせない)", async () => {
  const r = await get(`/m/${M}/today`);
  assert.match(r.headers.get("cache-control")!, /no-store/);
});

test("あとから: 過去の日を押した時刻で記録し、status に出る。2回目は最初の時刻が残る", async () => {
  now = new Date("2026-10-20T10:30:00Z"); // 日本時間 10-20 19:30
  const r = await post(`/m/${M}/taken?date=2026-10-19`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { taken: true, date: "2026-10-19", at: "19:30" });
  now = new Date("2026-10-20T11:30:00Z");
  assert.deepEqual(await (await post(`/m/${M}/taken?date=2026-10-19`)).json(), { taken: true, date: "2026-10-19", at: "19:30" });
  const s: any = await (await get(`/f/${F}/status`)).json();
  assert.deepEqual(s.days.find((d: any) => d.date === "2026-10-19"), { taken: true, date: "2026-10-19", at: "19:30" });
});

test("あとから: date が今日なら通常の記録と同じ", async () => {
  now = new Date("2026-10-23T00:00:00Z"); // 10-23 09:00
  const r = await post(`/m/${M}/taken?date=2026-10-23`);
  assert.deepEqual(await r.json(), { taken: true, date: "2026-10-23", at: "09:00" });
});

test("あとから: 未来・4日より前・不正な日付は 400 で記録されない", async () => {
  now = new Date("2026-10-30T00:00:00Z");
  for (const d of ["2026-10-31", "2026-10-26", "abc", "2026-02-30", ""]) {
    assert.equal((await post(`/m/${M}/taken?date=${d}`)).status, 400, d);
  }
  const s: any = await (await get(`/f/${F}/status`)).json();
  assert.deepEqual(s.days.map((d: any) => d.taken), [false, false, false]);
});
