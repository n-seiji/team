import { Store } from "./store.ts";
import { createApp, normalizePublicUrl } from "./server.ts";
import { fileURLToPath } from "node:url";

const adminKey = process.env.ADMIN_KEY;
if (!adminKey) {
  console.error("ADMIN_KEY が未設定です。例: ADMIN_KEY=ひみつの合言葉 node src/main.ts");
  process.exit(1);
}
let publicUrl: string;
try {
  publicUrl = normalizePublicUrl(process.env.PUBLIC_URL);
} catch (e) {
  console.error(`${(e as Error).message}\n例: PUBLIC_URL=https://kairan.example.jp ADMIN_KEY=ひみつの合言葉 node src/main.ts`);
  process.exit(1);
}
const dbPath = process.env.DB_PATH ?? "kairanban.db";
const port = Number(process.env.PORT ?? 3000);
const publicDir = fileURLToPath(new URL("../public", import.meta.url));

createApp(new Store(dbPath), { adminKey, publicUrl, publicDir }).listen(port, () => {
  console.log(`回覧板サーバー: http://localhost:${port}/admin  (DB: ${dbPath}, 住民リンク: ${publicUrl}/r/…)`);
});
