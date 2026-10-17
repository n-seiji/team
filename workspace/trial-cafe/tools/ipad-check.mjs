// iPad 相当の画面サイズで #/check と #/order を実際に操作し、タップ領域とスクショを確認する
import { chromium } from 'playwright';
const BASE = process.argv[2];
const OUT = process.argv[3];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function smallTargets() {
  return page.$$eval('button, input, a, textarea', (els) => els
    .filter((e) => e.offsetParent !== null)
    .map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((r) => r.w < 44 || r.h < 44));
}

await page.goto(`${BASE}/index.html#/check`);
await page.waitForSelector('.item');
const items = await page.$$eval('.item', (els) => els.length);
const unfilled0 = await page.textContent('.unfilled-count');
console.log('check: 品目', items, '/', unfilled0);
console.log('check: 44px 未満', JSON.stringify(await smallTargets()));
await page.screenshot({ path: `${OUT}/check-empty.png`, fullPage: true });

// 名前なしで押す
await page.click('button.primary');
console.log('check: 名前なし →', await page.textContent('.status'));
await page.fill('#recorder', '蓮');
await page.dispatchEvent('#recorder', 'change');
// 数える品目は + を2回、段階は「半分」
const t0 = Date.now();
for (let i = 0; i < items; i++) {
  const row = page.locator('.item').nth(i);
  const plus = row.locator('button.step').last();
  if (await plus.count()) { await plus.tap(); await plus.tap(); }
  else await row.locator('button.level').nth(2).tap();
}
console.log('check: 全品目入力', Date.now() - t0, 'ms /', await page.textContent('.unfilled-count'));
// 数字の直接入力(牛乳10本など)。数字以外は受け付けず、+/- はそのまま使える
const milk = page.locator('.item', { hasText: '牛乳' });
const milkInput = milk.locator('input.count-input');
console.log('check: 牛乳の欄 inputmode =', await milkInput.getAttribute('inputmode'));
await milkInput.tap();
await milkInput.fill('');
await milkInput.pressSequentially('10');
console.log('check: 牛乳に「10」→', await milkInput.inputValue());
await milkInput.pressSequentially('a');
console.log('check: 続けて「a」→', await milkInput.inputValue());
await milk.locator('button.step').last().tap();
console.log('check: + を1回 →', await milkInput.inputValue());
await milk.screenshot({ path: `${OUT}/check-direct-input.png` });
// 最後の行が固定バーに隠れていないか
const hidden = await page.evaluate(() => {
  window.scrollTo(0, document.body.scrollHeight);
  const last = [...document.querySelectorAll('.item')].pop().getBoundingClientRect();
  const bar = document.querySelector('.bar').getBoundingClientRect();
  return last.bottom > bar.top;
});
console.log('check: 最後の品目がバーに隠れる?', hidden);
await page.screenshot({ path: `${OUT}/check-filled.png`, fullPage: true });
await page.click('button.primary');
console.log('check: 記録 →', await page.textContent('.status'));
await page.reload();
await page.waitForSelector('.item');
console.log('check: 再読み込み後 名前=', await page.inputValue('#recorder'), '/ 前回=', (await page.textContent('.item .prev')).trim());
console.log('check: 上部 =', JSON.stringify(await page.innerText('.after-order')));

// 発注画面
await page.goto(`${BASE}/index.html#/order`);
await page.waitForSelector('.order-item');
console.log('order: 44px 未満', JSON.stringify(await smallTargets()));
// LINE の最初の業者で確かめる(業者の並びは store.js の SUPPLIERS 順)
const firstSection = page.locator('section.supplier').filter({ has: page.getByRole('button', { name: '文面をコピー' }) }).first();
await firstSection.locator('input').first().fill('3');
// コピーできない場合(http や許可なし)を再現する。ブラウザによって既定の動きが違うので、明示的に失敗させる
await page.evaluate(() => { window.__write = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
await firstSection.getByRole('button', { name: '文面をコピー' }).click();
await page.waitForFunction(() => document.querySelector('main > .status').textContent !== '');
console.log('order: コピー →', await page.textContent('main > .status'));
const ta = firstSection.locator('.copy-out textarea');
console.log('order: 退避欄 =', JSON.stringify(await ta.inputValue()), '選択範囲', await ta.evaluate((e) => [e.selectionStart, e.selectionEnd, document.activeElement === e]));
await page.screenshot({ path: `${OUT}/order-copy-fallback.png` });
await page.evaluate(() => { navigator.clipboard.writeText = window.__write; });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await firstSection.getByRole('button', { name: '文面をコピー' }).click();
await page.waitForFunction(() => document.querySelector('main > .status').textContent.includes('コピーしました'), null, { timeout: 3000 }).catch(() => {});
console.log('order: 許可あり コピー →', await page.textContent('main > .status'), '/ クリップボード =', JSON.stringify(await page.evaluate(() => navigator.clipboard.readText())));
const reminder = firstSection.locator('.reminder');
console.log('order: コピー後の案内 =', JSON.stringify(await reminder.isVisible() && await reminder.innerText()));
await firstSection.locator('input').first().fill('4');
console.log('order: 量を直しても案内は残る?', await reminder.isVisible());
await firstSection.screenshot({ path: `${OUT}/order-reminder.png` });
await firstSection.getByRole('button', { name: '発注した' }).click();
console.log('order: 発注後の案内は消える?', !(await reminder.isVisible()));
console.log('order: 発注 →', await page.textContent('main > .status'));
console.log('order: 1行目 =', JSON.stringify(await firstSection.locator('.order-item').first().innerText()));
const phone = page.locator('section.supplier', { hasText: '電話' });
await phone.locator('input').first().fill('２');
await phone.getByRole('button', { name: '読み上げ用の一覧を出す' }).click();
console.log('order: 読み上げ =', JSON.stringify(await phone.locator('.copy-out').innerText()));
// 各品目を画面の一番上まで送ったとき、名前と入力欄が何かに隠れていないか(実際のスクロール位置で確かめる)
async function coveredRows() {
  return page.$$eval('.order-item', (rows) => rows.map((row) => {
    row.scrollIntoView({ block: 'start' });
    const hit = (el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + 4); return row.contains(top); };
    const name = row.querySelector('.item-name').textContent;
    return hit(row.querySelector('.item-name')) && hit(row.querySelector('input')) ? null : name;
  }).filter(Boolean));
}
console.log('order: 一番上で隠れる品目(お知らせなし)', JSON.stringify(await coveredRows()));
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${OUT}/order.png`, fullPage: true });
// 蓮さん側: 記録のあとに発注があったか
await page.goto(`${BASE}/index.html#/check`);
await page.waitForSelector('.after-order');
console.log('check: 発注後の上部 =', JSON.stringify(await page.innerText('.after-order')));
console.log('check: 44px 未満(数字欄あり)', JSON.stringify(await smallTargets()));
await page.screenshot({ path: `${OUT}/check-after-order.png` });
console.log('JS エラー', JSON.stringify(errors));
await browser.close();
