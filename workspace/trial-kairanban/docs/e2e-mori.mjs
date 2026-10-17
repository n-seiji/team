// 森さんの順番（キー → 世帯を追加 → 回覧を登録 → QRを印刷 → 住民が QR のリンクで読む）を、画面だけで通す。開発時のみ。
// 例: PUBLIC_URL=http://localhost:3456 ADMIN_KEY=k DB_PATH=/tmp/m.db PORT=3456 node src/main.ts の後、
//     S=<画像の保存先> CHROME=<chromeのパス> node docs/e2e-mori.mjs
import { chromium } from 'playwright';
const S = process.env.S, B = 'http://localhost:3456';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
const hs = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const t = (s) => page.locator(s).innerText().then(x => x.replace(/\s+/g, ' ').trim());
await page.goto(B + '/admin'); await page.waitForTimeout(300);
console.log('[1 開く] キー欄:', await page.isVisible('#key'), '| フォーカス:', await page.evaluate(() => document.activeElement?.id));
await page.focus('#key'); await page.keyboard.type('k'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
console.log('[1 キー] 一覧:', await t('#board'));
await page.click('#newHousehold summary');
for (const n of ['伊藤さん', '山田さん', '伊藤さん']) { await page.focus('#hname'); await page.keyboard.type(n); await page.keyboard.press('Enter'); await page.waitForTimeout(300); }
console.log('[2 世帯] 帯:', await t('#banner'), '| 同じ名前:', await t('#hnameErr'));
await page.fill('#hname', '');
await page.click('#newCircular summary');
await page.fill('#ctitle', '防災訓練のお知らせ'); await page.fill('#cbody', '11月3日(日)午前9時から、公民館前の広場で防災訓練を行います。');
await page.focus('#ctitle'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
console.log('[3 回覧] 帯:', await t('#banner'));
console.log('[3 回覧] 一覧:', await t('#summary'), '/', await t('#rows'), '| 横スクロール', await hs(page));
await page.screenshot({ path: S + '/mori-admin.png', fullPage: true });
const [pp] = await Promise.all([ctx.waitForEvent('page'), page.click('.print-link')]);
await pp.waitForLoadState(); await pp.waitForTimeout(500);
console.log('[4 印刷] ', (await pp.locator('#lead').innerText()).replace(/\s+/g, ' '), '| フォーカス:', await pp.evaluate(() => document.activeElement?.textContent?.trim()));
const sheets = await pp.locator('.sheet').count();
console.log('[4 印刷] 紙の枚数:', sheets, '| 横スクロール', await hs(pp));
const url = await pp.locator('.sheet').first().evaluate(e => e.textContent.match(/https?:\/\/\S+\/r\/[\w-]+/)?.[0]);
await pp.pdf({ path: S + '/mori-print.pdf', format: 'A4' });
const res = await page.request.get(B + '/api/admin/print', { headers: { 'X-Admin-Key': 'k' } });
const list = await res.json();
console.log('[4 印刷] 1枚目のURLは print API と同じ:', url === (Array.isArray(list) ? list : list.households)[0].url);
const r = await ctx.newPage(); await r.goto(url); await r.waitForTimeout(400);
console.log('[5 住民] ', await r.locator('#title').innerText(), '|', await r.locator('#read').innerText(), '| 本文の文字', await r.locator('#content').evaluate(e => getComputedStyle(e).fontSize));
await r.click('#read'); await r.waitForTimeout(400);
console.log('[5 住民 押した]', (await r.locator('main').innerText()).replace(/\s+/g, ' ').slice(-60));
await page.bringToFront(); await page.reload(); await page.waitForTimeout(500);
console.log('[6 班長 再読込] キー欄:', await page.isVisible('#key'), '|', await t('#summary'), '/', await t('#rows'));
await browser.close();
