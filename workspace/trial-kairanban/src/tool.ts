// 運用のための小さな道具。docs/運用のしかた.md の手順から使う。
//   node src/tool.ts key <設定ファイル>            新しい管理キーを作って設定ファイルに書く
//   node src/tool.ts backup <DB> <保存先フォルダ>    DB をその日の日付のファイルにコピーする (14日分を残す)
//   node src/tool.ts restore <バックアップ> <DB>     バックアップから DB を戻す (サーバーを止めてから)
import { DatabaseSync } from "node:sqlite";
import { randomInt } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 紛らわしい字 (0/o, 1/l/i) を抜いた小文字と数字。スマホで打ちやすいよう 4文字ずつ区切る
const KEY_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const KEEP_DAYS = 14;

export function newAdminKey(): string {
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => KEY_CHARS[randomInt(KEY_CHARS.length)]).join(""),
  );
  return groups.join("-");
}

// 設定ファイルの ADMIN_KEY= の行だけを差し替える。ほかの行 (PUBLIC_URL など) は残す
export function writeAdminKey(envFile: string, key: string): void {
  const lines = existsSync(envFile) ? readFileSync(envFile, "utf8").split("\n").filter((l) => l !== "") : [];
  const rest = lines.filter((l) => !l.startsWith("ADMIN_KEY="));
  writeFileSync(envFile, [...rest, `ADMIN_KEY=${key}`].join("\n") + "\n");
  chmodSync(envFile, 0o600);
}

// 動いている最中でも壊れないコピーを作るため、ファイルのコピーではなく VACUUM INTO を使う
export function backup(dbPath: string, dir: string, today = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `kairanban-${today.toISOString().slice(0, 10)}.db`);
  rmSync(out, { force: true });
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(out);
  } finally {
    db.close();
  }
  const old = readdirSync(dir).filter((f) => /^kairanban-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(KEEP_DAYS);
  for (const f of old) rmSync(join(dir, f));
  return out;
}

export function restore(backupFile: string, dbPath: string): void {
  const broken = new Error(`バックアップが壊れています。前の日の控えを指定してください: ${backupFile}`);
  const db = new DatabaseSync(backupFile, { readOnly: true });
  try {
    const ok = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (ok.integrity_check !== "ok") throw broken;
  } catch {
    // SQLite でないファイルは prepare の時点で "file is not a database" になる。機械係に分かる文言にそろえる
    throw broken;
  } finally {
    db.close();
  }
  for (const suffix of ["-journal", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
  copyFileSync(backupFile, dbPath);
}

if (import.meta.main) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === "key" && a) {
      const key = newAdminKey();
      writeAdminKey(a, key);
      console.log(`新しい管理キー: ${key}\n紙に書き写してから、サーバーを再起動してください。`);
    } else if (cmd === "backup" && a && b) {
      console.log(`バックアップしました: ${backup(a, b)}`);
    } else if (cmd === "restore" && a && b) {
      restore(a, b);
      console.log(`戻しました: ${a} → ${b}\nサーバーを起動してください。`);
    } else {
      console.error("使い方: node src/tool.ts key <設定ファイル> | backup <DB> <保存先> | restore <バックアップ> <DB>");
      process.exit(2);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
