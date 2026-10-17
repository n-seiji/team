import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createApp } from './src/app.js';
import { createStore } from './src/store.js';

const root = dirname(fileURLToPath(import.meta.url));
const passphrase = process.env.OWNER_PASSPHRASE;
if (!passphrase) {
  console.error('環境変数 OWNER_PASSPHRASE(オーナー用の合言葉)を設定してください');
  process.exit(1);
}
const store = createStore(process.env.DATA_FILE ?? join(root, 'data', 'shift.json'));
const port = Number(process.env.PORT ?? 3000);
createApp({ store, passphrase, publicDir: join(root, 'public') }).listen(port, () => console.log(`http://localhost:${port}`));
