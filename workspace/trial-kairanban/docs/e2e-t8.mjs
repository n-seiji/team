// T8（次を読む）と QR 印刷ページの実ブラウザ確認 (360px)。開発時のみ: playwright と chrome が必要。
// 例: PUBLIC_URL=http://localhost:3456 ADMIN_KEY=k DB_PATH=/tmp/t8.db PORT=3456 node src/main.ts の後、
//     S=<画像の保存先> CHROME=<chromeのパス> node docs/e2e-t8.mjs
import { chromium } from 'playwright';
const S = process.env.S, B = 'http://localhost:3456', K = { 'X-Admin-Key': 'k', 'Content-Type': 'application/json' };
const post = (p, b) => fetch(B + p, { method: 'POST', headers: K, body: JSON.stringify(b) }).then(r => r.json());
const h = await post('/api/households', { name: '伊藤さん' });
await post('/api/households', { name: '山田さん' });
for (const [t, b] of [['防災訓練のお知らせ', '11月3日(日)午前9時から、公民館前の広場で防災訓練を行います。'], ['秋祭りの寄付', '寄付のお願いです。'], ['ゴミ当番表', '11月の当番表です。']]) await post('/api/circulars', { title: t, body: b });

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const hs = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const state = async () => `${await page.textContent('#title')} | more: ${await page.isVisible('#more') ? await page.textContent('#more') : '(なし)'} | 次を読む: ${await page.isVisible('#next')}`;
await page.goto(h.link); await page.waitForTimeout(400);
console.log('[開いた]', await state());
for (let i = 0; i < 3; i++) {
  await page.click('#read'); await page.waitForTimeout(400);
  console.log(`[押した${i + 1}]`, await state(), '| ボタン:', await page.textContent('#read'));
  if (i === 0) {
    const box = await page.locator('#next').boundingBox();
    console.log('  「次を読む」の高さ', box.height, 'px | 横スクロール', await hs());
    await page.screenshot({ path: S + '/resident-t8-next.png', fullPage: true });
  }
  if (await page.isVisible('#next')) {
    await page.keyboard.press('Tab'); // 「次を読む」はキーボードでも押せる
    await page.focus('#next'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    console.log('  → 次を読む:', await page.textContent('#title'), '/', await page.textContent('#content'), '| フォーカス:', await page.evaluate(() => document.activeElement.id));
  }
}
await page.screenshot({ path: S + '/resident-t8-last.png', fullPage: true });
await page.reload(); await page.waitForTimeout(400);
console.log('[開き直す]', await state(), '| ボタン:', await page.textContent('#read'), '| 横スクロール', await hs());

// 印刷ページ（健さんの GET /api/admin/print の本物の QR）
const a = await ctx.newPage();
await a.goto(B + '/admin'); await a.fill('#key', 'k'); await a.keyboard.press('Enter'); await a.waitForTimeout(400);
console.log('[班長画面] リンク:', await a.textContent('.print-link'), '→', await a.getAttribute('.print-link', 'href'));
await a.goto(B + '/print.html'); await a.waitForTimeout(400);
console.log('[print]', await a.textContent('#lead'), '| 印刷ボタンにフォーカス:', await a.evaluate(() => document.activeElement.id));
console.log('[1枚目]', (await a.locator('.sheet').first().innerText()).replace(/\n+/g, ' / '));
console.log('[横スクロール 360px]', await a.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth));
await a.screenshot({ path: S + '/print-360.png', fullPage: true });
await a.emulateMedia({ media: 'print' });
const qr = await a.evaluate(() => { const r = document.querySelector('.qr').getBoundingClientRect(); return (r.width - 2 * 0.7 * 96 / 2.54) / 96 * 2.54; });
console.log('[印刷時の QR の1辺]', qr.toFixed(2), 'cm（余白を除く）');
console.log('[印刷時のページ数]', await a.evaluate(() => document.querySelectorAll('.sheet').length), '枚分の .sheet');
await a.pdf({ path: S + '/print.pdf', format: 'A4', preferCSSPageSize: true });
await browser.close();
