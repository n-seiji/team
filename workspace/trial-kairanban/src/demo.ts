// 画面確認用の見本データを events.jsonl に書く(日付は今日からさかのぼる)。
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoster, Store } from "./store.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.KAIRAN_DATA ?? join(ROOT, "data");
const logPath = join(dataDir, "events.jsonl");
rmSync(logPath, { force: true });
const store = new Store(loadRoster(join(dataDir, "roster.json")), { logPath });
const ago = (d: number) => new Date(Date.now() - d * 86_400_000);
const admin = { by: "石田 正雄", passphrase: "kaichou" };

store.createCircular({ title: "秋の清掃活動と防災訓練のお知らせ", importance: "重要", ...admin }, ago(10));
store.createCircular({ title: "ごみ置き場の場所変更", ...admin }, ago(2));

// c1: 班ごとに進み具合を変える。3班は旅行で不在保留、5班は未着のまま止まっている
const pass = (g: number, n: number, startAgo: number) => {
  const gr = store.roster.groups[g - 1];
  for (let i = 0; i < n; i++) {
    const by = { by: gr.leaders[0], passphrase: gr.passphrase };
    store.record({ circularId: "c1", houseId: gr.houses[i].id, status: "受取済", ...by }, ago(startAgo - i));
    store.record({ circularId: "c1", houseId: gr.houses[i].id, status: "次へ渡した", ...by }, ago(startAgo - i - 0.5));
  }
};
pass(1, 15, 9.5); pass(2, 9, 9); pass(4, 6, 9); pass(6, 12, 9); pass(7, 3, 9); pass(8, 14, 9);
pass(3, 4, 9);
{ const gr = store.roster.groups[2]; store.record({ circularId: "c1", houseId: gr.houses[4].id, status: "不在で保留", by: gr.leaders[0], passphrase: gr.passphrase }, ago(5)); }
pass(5, 2, 9);
console.log(`見本データを書きました: ${logPath}`);
