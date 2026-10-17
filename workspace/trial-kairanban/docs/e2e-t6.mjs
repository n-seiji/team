// T6 の実ブラウザ確認 (360px)。開発時のみ: playwright と chrome が必要。新しい DB で起動してから実行する。
// 例: ADMIN_KEY=k DB_PATH=/tmp/t6.db PORT=3456 node src/main.ts の後、S=<画像の保存先> CHROME=<chromeのパス> node docs/e2e-t6.mjs
import { chromium } from 'playwright';
const S = process.env.S, B = 'http://localhost:3456';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
const page = await ctx.newPage();
const hs = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const board = () => page.evaluate(() => document.querySelector('#board').innerText.replace(/\n+/g, ' / '));
const vis = (s) => page.isVisible(s);
await page.goto(B + '/admin');
await page.fill('#key', 'k'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
console.log('[最初]', await page.textContent('#empty'));
// 世帯の追加 (キーボードだけ)
await page.focus('#newHousehold summary'); await page.keyboard.press('Enter');
console.log('[世帯フォームの欄]', await page.$$eval('#householdForm input, #householdForm textarea', es => es.map(e => document.querySelector(`label[for=${e.id}]`).textContent)));
await page.focus('#hname'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
console.log('[空の表示名]', await page.textContent('#hnameErr'), '| aria-invalid:', await page.getAttribute('#hname', 'aria-invalid'));
for (const n of ['山田さん', '佐々木さん', '伊藤さん']) { await page.fill('#hname', n); await page.keyboard.press('Enter'); await page.waitForTimeout(250); }
console.log('[世帯追加]', await page.textContent('#banner'));
// 回覧の登録
await page.click('#newCircular summary');
await page.click('#circularForm button'); await page.waitForTimeout(200);
console.log('[空のタイトル]', await page.textContent('#ctitleErr'), '/', await page.textContent('#cbodyErr'));
await page.fill('#ctitle', '防災訓練のお知らせ'); await page.fill('#cbody', '11月3日(日)午前9時から、公民館前の広場で防災訓練を行います。');
await page.click('#circularForm button'); await page.waitForTimeout(500);
await page.click('#newCircular summary'); await page.fill('#ctitle', '秋祭りの寄付'); await page.fill('#cbody', '寄付のお願いです。');
await page.click('#circularForm button'); await page.waitForTimeout(500);
console.log('[登録後] 帯:', await page.textContent('#banner'));
console.log('[登録後] 選択中:', await page.$eval('#circular', s => s.selectedOptions[0].text), '| 並び:', await page.$$eval('#circular option', os => os.map(o => o.text)));
console.log('[登録後] 一覧:', await board(), '| 横スクロール', await hs());
await page.screenshot({ path: S + '/admin-t6-registered.png', fullPage: true });
// 世帯を回覧がある状態で追加 → 一番下に出る
await page.$eval('#newHousehold', d => { d.open = true; }); await page.fill('#hname', '鈴木さん'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
console.log('[追加後の並び]', await page.$$eval('#rows li .name', es => es.map(e => e.textContent)), '/', await page.textContent('#summary'));
// リンクを作り直す
const copyOf = (i) => `#rows li:nth-child(${i}) button.copy`;
await page.click(copyOf(1)); await page.waitForTimeout(150);
const oldUrl = await page.evaluate(() => navigator.clipboard.readText());
page.once('dialog', d => { console.log('[確認]', d.message().replace(/\n/g, ' ')); d.accept(); });
await page.click('#rows li:nth-child(1) >> text=リンクを作り直す'); await page.waitForTimeout(500);
console.log('[作り直し後] 帯:', await page.textContent('#banner'));
console.log('[作り直し後] フォーカス:', await page.evaluate(() => document.activeElement.textContent));
await page.keyboard.press('Enter'); await page.waitForTimeout(200);
const newUrl = await page.evaluate(() => navigator.clipboard.readText());
console.log('[新しいリンク]', newUrl, '| 前と違う:', newUrl !== oldUrl);
await page.screenshot({ path: S + '/admin-t6-reissued.png', fullPage: true });
// キャンセルなら変わらない
page.once('dialog', d => d.dismiss());
await page.click('#rows li:nth-child(2) >> text=リンクを作り直す'); await page.waitForTimeout(300);
await page.click(copyOf(2)); await page.waitForTimeout(150);
const sasaki1 = await page.evaluate(() => navigator.clipboard.readText());
await page.reload(); await page.waitForTimeout(400);
await page.click(copyOf(2)); await page.waitForTimeout(150);
console.log('[キャンセル] 佐々木さんのリンクは変わらない:', sasaki1 === await page.evaluate(() => navigator.clipboard.readText()));
console.log('[360px] 横スクロール', await hs());
// 古いリンクと新しいリンクを住民として開く
const r = await ctx.newPage(); await r.setViewportSize({ width: 360, height: 740 });
await r.goto(oldUrl); await r.waitForTimeout(400);
console.log('[前のリンク]', await r.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' / ')), '| ボタン:', await r.isVisible('#read'));
await r.screenshot({ path: S + '/resident-t6-oldlink.png', fullPage: true });
await r.goto(newUrl); await r.waitForTimeout(400);
console.log('[新しいリンク]', await r.$eval('h1', e => e.textContent), '| ボタン:', await r.isVisible('#read'));
await browser.close();
