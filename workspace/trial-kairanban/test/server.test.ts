import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.ts";
import { loadRoster, Store } from "../src/store.ts";

const roster = loadRoster(fileURLToPath(new URL("../data/roster.json", import.meta.url)));

test("HTTP: 作成→記録→班ごとの現在地取得、合言葉は漏れない", async () => {
  const server = createApp(new Store(roster)).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const j = (path: string, body?: unknown) => fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  try {
    const groups = await (await j("/api/groups")).json();
    assert.equal(groups.length, 8);
    assert.ok(!JSON.stringify(groups).includes("hanchou"));

    const c = await j("/api/circulars", { title: "ごみ置き場の変更", importance: "重要", by: "石田 正雄", passphrase: "kaichou" });
    assert.equal(c.status, 201);

    const bad = await j("/api/circulars/c1/records", { houseId: "g2-01", status: "受取済", by: "大野 恵", passphrase: "nope" });
    assert.equal(bad.status, 403);

    const ok = await j("/api/circulars/c1/records", { houseId: "g2-01", status: "次へ渡した", by: "大野 恵", passphrase: "hanchou-2" });
    assert.equal(ok.status, 201);
    const v = await ok.json();
    assert.equal(v.groups[1].current.id, "g2-02");
    assert.deepEqual(Object.keys(v.groups[1]).filter((k) => ["group", "current", "status", "stayDays", "holdSince", "completedCount", "total"].includes(k)).sort(), ["completedCount", "current", "group", "holdSince", "status", "stayDays", "total"]);
    assert.equal(v.completed, false);

    assert.equal((await j("/api/circulars/zzz")).status, 404);
    assert.equal((await (await j("/api/circulars")).json())[0].importance, "重要");
  } finally { server.close(); }
});
