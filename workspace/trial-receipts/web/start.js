// /start: テスト機の画面に、スマホで開く URL を QR と大きな字で出す。
import { qrSvg } from './qr.js';
import { pickStartUrl } from './logic.js';

const $ = (s) => document.querySelector(s);

async function boot() {
  let urls = [];
  try { urls = (await (await fetch('/api/info')).json()).urls ?? []; } catch {}
  const q = new URLSearchParams(location.search);
  const { url, others } = pickStartUrl({ override: q.get('url'), urls, origin: location.origin, hostname: location.hostname });
  $('#url').textContent = url;
  $('#qr').innerHTML = qrSvg(url);
  if (others.length) {
    $('#others').hidden = false;
    $('#others').textContent = `開けないときは、こちらも試してください：${others.join('　')}`;
  }
  if (/^(localhost|127\.)/.test(new URL(url).hostname)) {
    $('#others').hidden = false;
    $('#others').textContent = 'この PC の LAN のアドレスが見つかりません。Wi-Fi につながっているか確かめてください。';
  }
}
boot();
