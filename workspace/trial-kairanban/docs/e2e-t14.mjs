// T12/T14 の確認：80世帯を入れて印刷ページを開き、「A4に1世帯」「A4に2世帯」の PDF を作って測る。開発時のみ。
// 例: PUBLIC_URL=http://localhost:3456 ADMIN_KEY=k DB_PATH=/tmp/p.db PORT=3456 node src/main.ts の後、
//     S=<PDFの保存先> CHROME=<chromeのパス> node docs/e2e-t14.mjs
import { chromium } from 'playwright';
const S = process.env.S, N = +(process.env.N ?? 80), B = 'http://localhost:3456', H = { 'X-Admin-Key': 'k', 'Content-Type': 'application/json' };
for (let i = 1; i <= N; i++) await fetch(B + '/api/households', { method: 'POST', headers: H, body: JSON.stringify({ name: `${i}番の家さん` }) });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
await ctx.addInitScript(() => localStorage.setItem('kairanban-admin-key', 'k'));
const page = await ctx.newPage();
await page.goto(B + '/print.html'); await page.waitForTimeout(800);
const hs = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
console.log('[開く]', await page.locator('#lead').innerText(), '| 最初の選択:', await page.locator('input[name=per]:checked').getAttribute('value'), '| 横スクロール', await hs());
// 印刷時の寸法（mm）。幅は A4 から余白 15mm×2 を引いた 180mm（680px）で測る。QR の黒い部分は viewBox の (n-8)/n
const measure = async () => { await page.setViewportSize({ width: 680, height: 1000 }); const r = await page.evaluate(() => {
  const mm = (px) => Math.round(px * 25.4 / 96 * 10) / 10;
  const s = document.querySelectorAll('.sheet');
  const f = (sel) => Math.round(parseFloat(getComputedStyle(s[0].querySelector(sel)).fontSize) * 0.75);
  const img = s[0].querySelector('.qr'), n = +decodeURIComponent(img.src).match(/viewBox="0 0 (\d+)/)[1];
  const over = [...s].filter((x) => x.querySelector('.url').getBoundingClientRect().bottom > x.getBoundingClientRect().bottom + 1).length;
  return `カメラの行 ${f('.how')}pt / 新しい回覧の行 ${f('.note')}pt / URL ${f('.url')}pt | QR 黒い部分 ${mm((img.clientWidth - 2 * parseFloat(getComputedStyle(img).paddingLeft)) * (n - 8) / n)}mm（${n}マス） | はみ出した紙 ${over}`;
}); await page.setViewportSize({ width: 360, height: 740 }); return r; };
await page.emulateMedia({ media: 'print' });
console.log('[A4に1世帯]', await measure());
await page.pdf({ path: S + '/print-a4-1.pdf', format: 'A4' });
await page.emulateMedia({ media: 'screen' });
await page.focus('input[value="2"]'); await page.keyboard.press('Space');
console.log('[2世帯を選ぶ]', await page.locator('#lead').innerText(), '| 横スクロール', await hs());
await page.emulateMedia({ media: 'print' });
console.log('[A4に2世帯]', await measure());
await page.pdf({ path: S + '/print-a4-2.pdf', format: 'A4' });
await browser.close();
