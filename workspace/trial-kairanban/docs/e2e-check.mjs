// 実ブラウザ確認 (360px)。開発時のみ: playwright と chrome が必要。
// 例: ADMIN_KEY=k DB_PATH=/tmp/e2e.db PORT=3456 node src/main.ts の後、S=<画像の保存先> CHROME=<chromeのパス> node docs/e2e-check.mjs
import { chromium } from 'playwright';
const S = process.env.S, B = 'http://localhost:3456', H = { 'X-Admin-Key': 'k', 'Content-Type': 'application/json' };
const post = (p, b) => fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
const yamada = await post('/api/households', { name: '山田さん' });
await post('/api/households', { name: '佐々木さん' });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
const hs = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const txt = () => page.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' / '));
// 1. 回覧なし
await page.goto(B + yamada.link); await page.waitForTimeout(300);
console.log('[回覧なし]', await txt(), '| ボタン表示:', await page.isVisible('#read'));
// 2. 回覧あり
const c1 = await post('/api/circulars', { title: '防災訓練のお知らせ', body: '11月3日(日)午前9時から、公民館前の広場で防災訓練を行います。雨天の場合は11月10日に延期します。動きやすい服装でお越しください。'.repeat(2) });
await page.goto(B + yamada.link); await page.waitForTimeout(300);
const fs = await page.$eval('#content', e => getComputedStyle(e).fontSize), bh = await page.$eval('#read', e => e.getBoundingClientRect().height);
console.log('[回覧あり] 本文', fs, '/ ボタン高さ', bh + 'px', '/ 横スクロール', await hs());
await page.screenshot({ path: S + '/resident-360.png', fullPage: true });
// 3. 開いた後に新しい回覧が登録 → 押す
const c2 = await post('/api/circulars', { title: '秋祭りの寄付', body: '寄付のお願い' });
await page.click('#read'); await page.waitForTimeout(300);
console.log('[押下後]', await txt(), '| disabled:', await page.$eval('#read', e => e.disabled));
await page.screenshot({ path: S + '/resident-360-done.png', fullPage: true });
const st = async id => (await fetch(`${B}/api/circulars/${id}/status`, { headers: H }).then(r => r.json())).households.find(h => h.name === '山田さん').status;
console.log('[取り違え確認] 防災訓練:', await st(c1.id), ' 秋祭り:', await st(c2.id));
// 4. 開き直し(過去回覧)
await page.goto(`${B}${yamada.link}?circular=${c1.id}`); await page.waitForTimeout(300);
console.log('[開き直し]', await txt());
// 5. 無効リンク
await page.goto(B + '/r/bad'); await page.waitForTimeout(300);
console.log('[無効]', await txt(), '/ 横スクロール', await hs());
// 6. 班長画面
await page.goto(B + '/admin'); await page.waitForTimeout(300);
await page.fill('#key', 'x'); await page.click('#keyform button'); await page.waitForTimeout(300);
console.log('[キー違い]', await page.textContent('#keyerr'), '| 一覧表示:', await page.isVisible('#board'));
await page.fill('#key', 'k'); await page.click('#keyform button'); await page.waitForTimeout(500);
await page.selectOption('#circular', String(c1.id)); await page.waitForTimeout(400);
console.log('[一覧]', await page.evaluate(() => document.querySelector('#board').innerText.replace(/\n+/g, ' / ')), '/ 横スクロール', await hs());
await page.screenshot({ path: S + '/admin-360.png', fullPage: true });
await page.context().grantPermissions(['clipboard-read','clipboard-write'], { origin: B });
await page.click('#rows li:nth-child(2) button.sub'); await page.waitForTimeout(200);
console.log('[コピー]', await page.textContent('#rows li:nth-child(2) button.sub'), '→', await page.evaluate(() => navigator.clipboard.readText()));
await page.check('#onlyUnread'); await page.waitForTimeout(200);
console.log('[絞り込み]', await page.$$eval('#rows li .name', es => es.map(e => e.textContent)));
await page.uncheck('#onlyUnread');
page.once('dialog', d => { console.log('[ダイアログ]', d.message()); d.accept(); });
await page.click('text=紙で読んだと記録する'); await page.waitForTimeout(400);
console.log('[代理記録後]', await page.evaluate(() => document.querySelector('#board').innerText.replace(/\n+/g, ' / ')));
await page.reload(); await page.waitForTimeout(500);
console.log('[再訪] キー欄表示:', await page.isVisible('#keyform'), ' 一覧:', await page.isVisible('#board'));
await browser.close();
