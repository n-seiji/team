// T10 の「カメラ相当」の確認。開発時のみ: playwright と chrome と jsqr (devDependencies) が必要。
// 1. 新しい DB でサーバーを起動する。例:
//    PUBLIC_URL=http://localhost:3457 ADMIN_KEY=k DB_PATH=/tmp/t10.db PORT=3457 node src/main.ts
// 2. S=<画像の保存先> CHROME=<chromeのパス> node docs/qr-camera-check.mjs
// やること: 回覧1件と世帯3件を入れ、1件を作り直す → /api/admin/print の QR を紙と同じ 6cm で描く →
// 斜め・ぼかし・暗めの「写真」にしてから読み取る → 読めた URL を幅360pxで開き、住民画面が出るかを見る。
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const B = process.env.B ?? 'http://localhost:3457';
const S = process.env.S ?? '.';
const H = { 'content-type': 'application/json', 'x-admin-key': process.env.KEY ?? 'k' };
const api = async (m, p, b) => (await fetch(B + p, { method: m, headers: H, body: b && JSON.stringify(b) })).json();

await api('POST', '/api/circulars', { title: '防災訓練のお知らせ', body: '11月3日 9時に公園へ集まってください。' });
const names = ['山田さん', '佐々木さん', '伊藤さん'];
const hs = [];
for (const name of names) hs.push(await api('POST', '/api/households', { name }));
const oldLink = hs[1].link;
const re = await api('POST', `/api/households/${hs[1].id}/reissue`);
const sheets = await api('GET', '/api/admin/print');
console.log('[print]', sheets.map((s) => `${s.name} ${s.url}`).join(' | '));
console.log('[作り直し] 佐々木さんの QR は新しいリンク:', sheets[1].url === re.link && sheets[1].url !== oldLink);

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const jsqrPath = fileURLToPath(new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url));

// 「写真」: 6cm の QR を少し傾け、遠近をつけ、ぼかして、灰色の机の上で暗めに撮った状態
const shots = [
  { label: '正面', css: 'filter: none' },
  { label: '斜め', css: 'transform: perspective(600px) rotateX(18deg) rotateZ(9deg); filter: blur(0.8px) brightness(0.8) contrast(0.8)' },
  { label: '遠め', css: 'transform: scale(0.45) rotateZ(-12deg); filter: blur(0.6px) brightness(0.75)' },
];
const cam = await browser.newPage({ viewport: { width: 480, height: 480 }, deviceScaleFactor: 1 });
for (const [i, sheet] of sheets.entries()) {
  for (const shot of shots) {
    await cam.setContent(`<body style="margin:0;background:#8a8a80;display:grid;place-items:center;height:100vh">
      <div style="width:6cm;height:6cm;${shot.css}">${sheet.qrSvg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div></body>`);
    const png = (await cam.screenshot()).toString('base64');
    if (i === 1) await cam.screenshot({ path: `${S}/qr-camera-${shot.label}.png` });
    await cam.addScriptTag({ path: jsqrPath });
    const got = await cam.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)?.data ?? null;
    }, png);
    console.log(`[読み取り ${shot.label}] ${sheet.name}:`, got === sheet.url ? 'OK' : `NG (${got})`);
  }
}

// 読めた URL をスマホ幅で開く (PUBLIC_URL がこのサーバーなので、そのまま開ける)
const phone = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
for (const url of [sheets[1].url, oldLink]) {
  await phone.goto(url);
  await phone.waitForTimeout(400);
  console.log(`[開く] ${url === oldLink ? '前のリンク' : 'QR のリンク'}:`, (await phone.innerText('body')).replace(/\s+/g, ' ').slice(0, 60));
}
await browser.close();
