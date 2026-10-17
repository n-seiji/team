// 実ブラウザ (Chromium headless) で T1〜T4 の画面を通す確認スクリプト。
// Playwright は本体の依存にしない。手元にあるものを PLAYWRIGHT で指す (例: /opt/node-tools/node_modules/playwright/index.mjs)。
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
import { readFileSync, mkdirSync } from 'node:fs';
import { makeResultCode, decodeTest, parseResultCode, encodeTest } from '../src/tango.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = process.argv[2] || 'demo/screens';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const LIST = [
  'abandon,断念する、捨てる', 'consider,よく考える、みなす', 'これは壊れた行', 'achieve,達成する',
  'acquire,獲得する', 'adapt,適応させる', 'admit,認める', 'afford,余裕がある', 'apply,申し込む、応用する',
].join('\n');
const FORM = 'https://forms.gle/AbC123xyz';

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('PAGE ERROR:', e.message));

// hidden 属性なのに見えている要素を数える
const leaks = (p) => p.evaluate(() => [...document.querySelectorAll('[hidden]')]
  .filter((el) => getComputedStyle(el).display !== 'none').map((el) => '#' + el.id));
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

// ---- T2: 先生がリンクを作る (PC幅) ----
await page.setViewportSize({ width: 1024, height: 900 });
await page.goto(BASE + 'teacher.html');
await page.fill('#list', LIST);
await page.fill('#form-url', 'https://example.com/form');
await page.click('#make');
await page.waitForFunction(() => document.querySelector('#make-msg').textContent);
log('[T2] Google 以外のフォーム URL:', await page.textContent('#make-msg'), '/ リンク欄:', await page.isVisible('#make-out'));
await page.fill('#form-url', FORM);
await page.click('#make');
await page.waitForFunction(() => document.querySelector('#link').value);
const link = await page.inputValue('#link');
log('[T2] msg:', await page.textContent('#make-msg'));
log('[T2] errors:', await page.$$eval('#make-errors li', (l) => l.map((x) => x.textContent)));
log('[T2] link:', link.slice(0, 60) + '…', 'hash長', link.split('#')[1].length, '/ リンク内のフォーム:', (await decodeTest(new URL(link).hash)).form);
await page.screenshot({ path: `${OUT}/t2-teacher-link.png`, fullPage: true });

// ---- T3: 生徒がスマホ幅でリンクを開く ----
const m = await ctx.newPage();
m.on('pageerror', (e) => log('PAGE ERROR:', e.message));
await m.setViewportSize({ width: 360, height: 740 });
await m.goto(link);
await m.waitForSelector('#start:not([hidden])');
log('[T3] start:', await m.textContent('#start-info'), '/ hidden なのに見える:', await leaks(m), '/ 横はみ出し px:', await overflow(m));
await m.screenshot({ path: `${OUT}/t3-start-360.png` });
const top = (s) => m.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().top), s);
log('[T8] 組の例:', await m.textContent('#kumi-hint'), '/ 組の欄 top:', await top('#kumi'), '/ はじめる top:', await top('#begin'));
await m.fill('#nick', 'ひなた');
// T7: 組・番号が空 / 範囲外では始められず、その欄の下に理由が出てフォーカスが移る
const focused = () => m.evaluate(() => document.activeElement.id);
const errs = async () => [await m.textContent('#kumi-err'), await m.textContent('#no-err')].filter(Boolean);
await m.click('#begin');
log('[T7] 空で押す:', await errs(), '/ フォーカス:', await focused(), '/ 始まった:', await m.isVisible('#quiz'));
await m.screenshot({ path: `${OUT}/t7-seat-error-360.png` });
await m.fill('#kumi', '2b'); await m.fill('#no', '0'); await m.click('#begin');
log('[T7] 番号 0:', await errs(), '/ フォーカス:', await focused(), '/ 始まった:', await m.isVisible('#quiz'));
// T8: 学校の書き方の組 (2-3 / 2年3組) は止まり、組の欄の真下に例つきで出る
for (const v of ['2-3', '2年3組']) {
  await m.fill('#kumi', v); await m.fill('#no', '14'); await m.click('#begin');
  log(`[T8] 組 ${v}:`, await errs(), '/ フォーカス:', await focused(), '/ 始まった:', await m.isVisible('#quiz'), '/ 横はみ出し px:', await overflow(m));
}
await m.screenshot({ path: `${OUT}/t8-kumi-hint-360.png` });
await m.fill('#kumi', '2b');
await m.fill('#no', '14');
const hasSeat = true;
await m.click('#begin');
let n = 0;
while (await m.isVisible('#quiz') && await m.$('#result[hidden]')) {
  const en = await m.textContent('#qcard .en');
  const ans = LIST.split('\n').find((l) => l.startsWith(en + ','))?.split(',')[1];
  const btns = await m.$$('#choices button');
  if (n === 0) await m.screenshot({ path: `${OUT}/t3-question-360.png` });
  // 最初の2問はわざと間違える
  let clicked = false;
  for (const b of btns) {
    const t = await b.textContent();
    if ((n < 2) !== (t === ans)) { await b.click(); clicked = true; break; }
  }
  if (!clicked) await btns[0].click();
  n++;
  if (n > 40) break;
}
const t3ok = await m.waitForSelector('#result:not([hidden])', { timeout: 3000 }).then(() => true, () => false);
const testIdOf = (await decodeTest(new URL(link).hash)).id;
let code;
if (!t3ok) {
  log('[T3] 結果画面が出ない (画面が新しい makeResultCode に組・番号を渡していない)。T1 は飛ばし、T4 は Node で作ったコードで続ける');
  code = makeResultCode({ id: testIdOf, kumi: '2B', no: 14, score: 6, total: 8, nick: 'ひなた' });
} else {
log('[T3] score:', await m.textContent('#score'));
log('[T3] wrong:', await m.$$eval('#wrong li', (l) => l.map((x) => x.textContent)));
code = await m.inputValue('#code');
log('[T3] code:', code, '/ hidden なのに見える:', await leaks(m), '/ 横はみ出し px:', await overflow(m));
await m.screenshot({ path: `${OUT}/t3-result-360.png`, fullPage: true });
const pr = parseResultCode(code);
log('[T7] 結果コードを読む:', pr.ok ? `組 ${pr.kumi} / 番号 ${pr.no} / ${pr.score}/${pr.total} / ${pr.nick}` : pr.reason);
// フォームの URL 入りのテスト: 「コピーしてフォームを開く」だけを出す
const fl = await m.$eval('#form-link', (a) => { const r = a.getBoundingClientRect(); return { href: a.href, target: a.target, h: Math.round(r.height) }; });
log('[T7] フォームのボタン:', await m.isVisible('#form-link'), fl, '/ コピーだけのボタン:', await m.isVisible('#copy'));
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
const [popup] = await Promise.all([ctx.waitForEvent('page'), m.click('#form-link')]);
await m.waitForFunction(() => document.getElementById('cmsg').textContent);
log('[T7] 押した後: 開いたタブ', popup.url(), '/ クリップボード:', await m.evaluate(() => navigator.clipboard.readText()), '/', await m.textContent('#cmsg'));
await popup.close();
// コピーできない端末: コードを全選択して「長押し」の1行
await ctx.clearPermissions();
await m.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
await m.$eval('#cmsg', (p) => { p.textContent = ''; });
const [popup2] = await Promise.all([ctx.waitForEvent('page'), m.click('#form-link')]);
await m.waitForFunction(() => document.getElementById('cmsg').textContent);
log('[T7] コピー失敗時:', await m.textContent('#cmsg'), '/ 選択中:', await m.evaluate(() => { const c = document.getElementById('code'); return c.value.slice(c.selectionStart, c.selectionEnd); }));
await popup2.close();
await m.screenshot({ path: `${OUT}/t7-result-form-360.png`, fullPage: true });
// 次のテストでは前回の組・番号が最初から入っている (同じリンクを開き直す)
await m.goto(BASE + 'test.html?again' + new URL(link).hash);
await m.waitForSelector('#start:not([hidden])');
log('[T7] 開き直し: 組', await m.inputValue('#kumi'), '/ 番号', await m.inputValue('#no'), '/ フォーカス:', await focused());
// フォーム URL なしのテストでは「コピー」だけ
const noForm = BASE + 'test.html#' + await encodeTest((await decodeTest(new URL(link).hash)).words);
await m.goto(noForm);
await m.waitForSelector('#start:not([hidden])');
await m.click('#begin');
while (await m.isVisible('#quiz')) await m.click('#choices button');
log('[T7] フォームなしのテスト: コピーのボタン', await m.isVisible('#copy'), '/ フォームのボタン', await m.isVisible('#form-link'), '/', await m.textContent('#code-help'), '/ 横はみ出し px:', await overflow(m));

// ---- T1: 学習画面へ ----
await m.click('#study');
await m.waitForURL(/index\.html/);
await m.waitForSelector('#card .en');
const box = await m.$eval('#known', (b) => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; });
log('[T1] card:', await m.textContent('#card'), '/ count:', await m.textContent('#count'), '/「覚えた」ボタン位置', box, '画面高 740');
log('[T1] hidden なのに見える:', await leaks(m), '/ 横はみ出し px:', await overflow(m));
await m.screenshot({ path: `${OUT}/t1-card-360.png` });
await m.click('#flip');
log('[T1] めくった:', await m.textContent('#card'));
await m.click('#known'); await m.click('#known'); await m.click('#again');
const before = await m.textContent('#card .en');
log('[T1] 2つ覚えて1つまだ:', await m.textContent('#count'), '次のカード', before);
await m.reload();
await m.waitForSelector('#card .en');
log('[T1] 開き直し後:', await m.textContent('#count'), '次のカード', await m.textContent('#card .en'));
// 単語リストの入れ替え (覚えた数が減らないこと)、全部覚えたあとの続け方
await m.click('#change');
log('[T1] 入れ替え欄:', await m.isVisible('#empty'), '/ カードを隠す:', !(await m.isVisible('#card')), '/ 横はみ出し px:', await overflow(m));
await m.screenshot({ path: `${OUT}/t1-change-360.png` });
await m.fill('#paste', 'bring,持ってくる\ncarry,運ぶ');
await m.click('#load');
log('[T1] 2語のリストに入れ替え:', await m.textContent('#count'), '/', await m.textContent('#pos'), '/ カード', await m.textContent('#card .en'));
await m.click('#known'); await m.click('#known');
log('[T1] ぜんぶ覚えた:', await m.textContent('#count'), '/', await m.textContent('#card'), '/ 入れ替えボタン見える:', await m.isVisible('#change'));
await m.screenshot({ path: `${OUT}/t1-done-360.png` });
await m.click('#change'); await m.fill('#paste', 'decide,決める'); await m.click('#load');
await m.reload(); await m.waitForSelector('#card .en');
log('[T1] さらに入れ替えて開き直し:', await m.textContent('#count'), '/ カード', await m.textContent('#card .en'));
// 空の状態 (単語なし) を新しいコンテキストで
const e = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
await e.goto(BASE + 'index.html');
log('[T1] 単語なし:', await e.textContent('#welcome h1'), '/ 貼り付け欄は閉じている:', !(await e.isVisible('#paste')), '/ hidden なのに見える:', await leaks(e), '/ 横はみ出し px:', await overflow(e));
log('[T1] 進捗の見出し:', await e.textContent('.backup summary'), '/ 説明:', await e.textContent('.backup .note'));
await e.screenshot({ path: `${OUT}/t1-empty-360.png` });
await e.click('#paste-box summary');
log('[T1] 折りたたみを開く: 貼り付け欄見える:', await e.isVisible('#paste'));
}

// ---- T4: 先生が集計する ----
// Google フォームの回答シートを列ごとコピーした形 (タブ区切り、見出し・タイムスタンプ・空白つき)
const id = testIdOf;
const mk = (kumi, no, score, nick) => makeResultCode({ id, kumi, no, score, total: 8, nick });
const codes = ['タイムスタンプ\t結果コードを貼ってください',
  ...[code, code, mk('2B', 3, 8, 'けん'), mk('1', 20, 3, '=SUM(A1)'), mk('2B', 14, 8, 'ひなた'), code.slice(0, -2), 'わかりません']
    .map((c, i) => `2026/10/19 8:${String(i).padStart(2, '0')}:00\t ${c} `)].join('\n');
await page.bringToFront();
await page.fill('#codes', codes);
await page.dispatchEvent('#codes', 'input');
log('[T4] summary:', await page.textContent('#agg-summary'));
log('[T4] rows:', await page.$$eval('#agg-table tbody tr', (l) => l.map((x) => x.textContent)));
log('[T4] skipped:', await page.$$eval('#agg-skipped li', (l) => l.map((x) => x.textContent)));
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
const csvPath = `${OUT}/${dl.suggestedFilename()}`;
await dl.saveAs(csvPath);
const buf = readFileSync(csvPath);
log('[T4] CSV:', dl.suggestedFilename(), 'BOM', buf.subarray(0, 3).toString('hex') === 'efbbbf', 'CRLF', buf.includes('\r\n'));
log(buf.toString('utf8').slice(1));
await page.screenshot({ path: `${OUT}/t4-aggregate.png`, fullPage: true });

// ---- T2: オフライン ----
await page.reload();
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(500);
await ctx.setOffline(true);
await page.reload();
log('[T2] オフラインで再読み込み:', await page.title(), '/ 入力が残る:', (await page.inputValue('#list')).split('\n').length, '行');
await page.click('#make');
await page.waitForFunction(() => document.querySelector('#make-msg').textContent);
log('[T2] オフラインでリンク作成:', await page.textContent('#make-msg'));
const off = await ctx.newPage();
await off.goto(link).catch((x) => log('[T2] オフラインで test.html:', x.message.split('\n')[0]));
if (await off.$('#start')) { await off.waitForSelector('#start:not([hidden])'); log('[T2] オフラインで test.html を開けた:', await off.textContent('#start-info')); }
await browser.close();
