import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError, loadRoster, Store } from "../src/store.ts";

const roster = loadRoster(fileURLToPath(new URL("../data/roster.json", import.meta.url)));
const D = (s: string) => new Date(`2026-10-${s}T09:00:00+09:00`);
const ADMIN = { by: "石田 正雄", passphrase: "kaichou" };
const g1 = { by: "青木 誠", passphrase: "hanchou-1" };
const rec = (s: Store, house: string, status: string, at: Date, who = g1) => s.record({ circularId: "c1", houseId: house, status, ...who }, at);

function fresh(importance = "通常") {
  const s = new Store(roster);
  s.createCircular({ title: "防災訓練のお知らせ", importance, ...ADMIN }, D("01"));
  return s;
}

test("名簿は8班・120世帯で、紙とデジタルが混在する", () => {
  assert.equal(roster.groups.length, 8);
  assert.equal(roster.groups.flatMap((g) => g.houses).length, 120);
  const modes = new Set(roster.groups.flatMap((g) => g.houses.map((h) => h.mode)));
  assert.deepEqual([...modes].sort(), ["digital", "paper"]);
});

test("作成直後は各班の先頭の家が現在地で、作成日から数える", () => {
  const s = fresh();
  const v = s.view("c1", D("03"));
  assert.equal(v.groups.length, 8);
  assert.equal(v.groups[0].current.id, "g1-01");
  assert.equal(v.groups[0].status, "未着");
  assert.equal(v.groups[0].stayDays, 2);
  assert.equal(v.completed, false);
});

test("次へ渡した で現在地が進み、日数は渡した日から数え直す", () => {
  const s = fresh();
  rec(s, "g1-01", "受取済", D("01"));
  rec(s, "g1-01", "次へ渡した", D("02"));
  const g = s.view("c1", D("06")).groups[0];
  assert.equal(g.current.id, "g1-02");
  assert.equal(g.stayDays, 4);
  assert.equal(g.stale, true);
  assert.equal(g.receiptMissing, true); // 未着のまま3日以上
  assert.equal(g.completedCount, 1);
});

test("不在で保留 は飛ばさず現在地のまま。保留開始日と日数を返す", () => {
  const s = fresh();
  rec(s, "g1-01", "次へ渡した", D("01"));
  rec(s, "g1-02", "受取済", D("02"));
  rec(s, "g1-02", "不在で保留", D("04"));
  rec(s, "g1-02", "不在で保留", D("05")); // 連続した保留は最初の日から数える
  const g = s.view("c1", D("08")).groups[0];
  assert.equal(g.current.id, "g1-02");
  assert.equal(g.status, "不在で保留");
  assert.equal(g.holdSince, D("04").toISOString());
  assert.equal(g.holdDays, 4);
  assert.equal(g.receiptMissing, false);
});

test("紙の世帯もデジタルの世帯も同じ状態を記録できる", () => {
  const s = fresh();
  const paper = roster.groups[0].houses.find((h) => h.mode === "paper")!;
  const digital = roster.groups[0].houses.find((h) => h.mode === "digital")!;
  for (const h of [paper, digital]) assert.equal(rec(s, h.id, "受取済", D("02")).status, "受取済");
  assert.equal(s.view("c1", D("02")).groups[0].houses.find((h) => h.id === paper.id)!.mode, "paper");
});

test("記録には いつ・誰が が残り、履歴で追える", () => {
  const s = fresh();
  rec(s, "g1-01", "受取済", D("02"));
  rec(s, "g1-01", "次へ渡した", D("03"));
  const h = s.history("c1", "g1-01");
  assert.deepEqual(h.map((r) => [r.status, r.by, r.at]), [["受取済", "青木 誠", D("02").toISOString()], ["次へ渡した", "青木 誠", D("03").toISOString()]]);
});

test("合言葉違い・他班の班長・不正な状態は拒否する。会長は全班可", () => {
  const s = fresh();
  assert.throws(() => rec(s, "g1-01", "受取済", D("02"), { by: "青木 誠", passphrase: "x" }), (e: unknown) => e instanceof DomainError && e.status === 403);
  assert.throws(() => rec(s, "g1-01", "受取済", D("02"), { by: "大野 恵", passphrase: "hanchou-2" }), (e: unknown) => e instanceof DomainError && e.status === 403);
  assert.throws(() => rec(s, "g1-01", "読んだ", D("02")), (e: unknown) => e instanceof DomainError && e.status === 400);
  assert.equal(rec(s, "g1-01", "受取済", D("02"), ADMIN).by, "石田 正雄");
  assert.equal(s.history("c1").length, 1);
});

test("重要な回覧は全家が受取済(または次へ渡した)になるまで未完了", () => {
  const s = fresh("重要");
  assert.equal(s.view("c1", D("02")).importance, "重要");
  for (const g of roster.groups) for (const h of g.houses) {
    assert.equal(s.view("c1", D("09")).completed, false);
    s.record({ circularId: "c1", houseId: h.id, status: "受取済", by: ADMIN.by, passphrase: ADMIN.passphrase }, D("09"));
  }
  const v = s.view("c1", D("09"));
  assert.equal(v.completed, true);
  assert.ok(v.groups.every((g) => g.done && g.completedCount === 15 && g.stale === false));
});

test("題名なし・重要度不正・順番の欠けは拒否し、順番は上書きできる", () => {
  const s = new Store(roster);
  assert.throws(() => s.createCircular({ title: " ", ...ADMIN }), /題名/);
  assert.throws(() => s.createCircular({ title: "a", importance: "急ぎ", ...ADMIN }), /重要度/);
  assert.throws(() => s.createCircular({ title: "a", order: { g1: ["g1-01"] }, ...ADMIN }), /順番/);
  assert.throws(() => s.createCircular({ title: "a", by: "誰か", passphrase: "kaichou" }), /合言葉/);
  const rev = roster.groups[0].houses.map((h) => h.id).reverse();
  s.createCircular({ title: "逆順", order: { g1: rev }, ...ADMIN });
  assert.equal(s.view("c1").groups[0].current.id, "g1-15");
});

test("イベントログから再起動後も状態が復元される", () => {
  const logPath = join(mkdtempSync(join(tmpdir(), "kairan-")), "events.jsonl");
  const a = new Store(roster, { logPath });
  a.createCircular({ title: "t", ...ADMIN }, D("01"));
  a.record({ circularId: "c1", houseId: "g1-01", status: "次へ渡した", ...g1 }, D("02"));
  const b = new Store(roster, { logPath });
  assert.equal(b.view("c1", D("05")).groups[0].current.id, "g1-02");
  assert.equal(b.view("c1", D("05")).groups[0].stayDays, 3);
});
