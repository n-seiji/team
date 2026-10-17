import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTokens } from "./config.ts";
import { createServer } from "./server.ts";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const dataDir = process.env.CARE_DATA_DIR ?? join(root, "data");
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const tokens = loadTokens(process.env, join(dataDir, "tokens.json"));
const server = createServer({
  dataFile: join(dataDir, "records.json"),
  tokens,
  publicDir: join(root, "public"),
});

server.listen(port, host, () => {
  const base = `http://${host}:${port}`;
  console.log(`本人用: ${base}/m/${tokens.mother}/`);
  console.log(`家族用: ${base}/f/${tokens.family}/`);
});
