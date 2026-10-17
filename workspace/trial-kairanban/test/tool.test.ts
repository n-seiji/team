import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { backup, newAdminKey, restore, writeAdminKey } from "../src/tool.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "kairan-tool-"));

test("管理キー: 4文字×3、紛らわしい字を含まない、毎回違う", () => {
  const k = newAdminKey();
  assert.match(k, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
  assert.notEqual(k, newAdminKey());
});

test("管理キー: ADMIN_KEY の行だけ差し替え、ほかの設定は残る", () => {
  const f = join(tmp(), "env");
  writeFileSync(f, "PUBLIC_URL=https://kairan.example.jp\nADMIN_KEY=old\nPORT=3000\n");
  writeAdminKey(f, "abcd-efgh-jkmn");
  assert.equal(readFileSync(f, "utf8"), "PUBLIC_URL=https://kairan.example.jp\nPORT=3000\nADMIN_KEY=abcd-efgh-jkmn\n");
  assert.equal(statSync(f).mode & 0o777, 0o600);
});

test("バックアップと復元: 読了記録まで戻り、14日分だけ残る", () => {
  const dir = tmp();
  const db = join(dir, "kairanban.db");
  const store = new Store(db);
  const c = store.addCircular("防災訓練", "11月3日");
  const h = store.addHousehold("山田さん");
  store.markSelfRead(c.id, h.id);

  let file = "";
  for (let d = 1; d <= 16; d++) file = backup(db, join(dir, "bk"), new Date(Date.UTC(2026, 9, d)));
  const kept = readdirSync(join(dir, "bk")).sort();
  assert.equal(kept.length, 14);
  assert.equal(kept[0], "kairanban-2026-10-03.db");

  const restored = join(dir, "restored.db");
  restore(file, restored);
  const s2 = new Store(restored);
  assert.equal(s2.getReading(c.id, h.id).status, "self");
  assert.equal(s2.listHouseholds()[0].token, h.token);
});

test("復元: 壊れたファイルは戻さない", () => {
  const dir = tmp();
  const bad = join(dir, "bad.db");
  writeFileSync(bad, "not a database");
  assert.throws(() => restore(bad, join(dir, "x.db")), /バックアップが壊れています/);
  assert.equal(existsSync(join(dir, "x.db")), false);
});
