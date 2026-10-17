// @ts-check
// QR の印刷ページ /print.html。A4に1世帯か、A4に2世帯（切り取り線で半分に切る）を選べる。
// API: GET /api/admin/print -> [{name,url,qrSvg}]（qrSvg は viewBox だけの SVG。大きさは CSS で決める）
// ?sample=1 のときは API の代わりに世帯一覧と「見本」の四角で組む（配る紙には使わない）
const KEY = 'kairanban-admin-key';
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const sample = new URLSearchParams(location.search).has('sample');
// 2文は行を分ける（「今までど／おり」のような途中の折り返しを避ける）
const NOTE = ['新しい回覧も、このQRから読めます。', '紙の回覧板も今までどおり回ります'];
const HOW = ['スマホのカメラをこのQRに向けて、', '出てきた文字を押すと開きます。'];
const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><rect x="4" y="4" width="21" height="21" fill="none" stroke="#000"/><text x="14.5" y="16" font-size="5" text-anchor="middle">見本</text></svg>';

let adminKey = '';
try { adminKey = localStorage.getItem(KEY) ?? ''; } catch {}

/** @param {string} path */
async function api(path) {
  const res = await fetch(path, { headers: { 'X-Admin-Key': adminKey } });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('auth'), { auth: true });
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
  return res.json();
}

/** @returns {Promise<{name:string,url:string,qrSvg:string}[]>} */
async function households() {
  if (sample) {
    const data = await api('/api/households');
    return data.households.map((/** @type {any} */ h) => ({ name: h.name, url: h.link, qrSvg: SAMPLE_SVG }));
  }
  const data = await api('/api/admin/print');
  return Array.isArray(data) ? data : data.households;
}

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 手書きの欄 @param {string} label */
function blank(label) {
  const p = el('p', 'blank');
  p.append(el('span', 'blank-label', label), el('span', 'blank-line'));
  return p;
}

/** @param {{name:string,url:string,qrSvg:string}} h */
function sheet(h) {
  const s = el('section', 'sheet');
  s.setAttribute('aria-label', `${h.name}の紙`);
  if (sample) s.append(el('p', 'sample-mark', '見本（このQRでは開けません。配らないでください）'));
  s.append(el('h2', 'sheet-title', `${h.name}の回覧板`));
  // SVG は img で出す（中のスクリプトは動かない）。幅と高さは CSS
  const img = /** @type {HTMLImageElement} */ (el('img', 'qr'));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(h.qrSvg);
  img.alt = `${h.name}の回覧板を開くQRコード`;
  s.append(img);
  // 説明と手書き欄はまとめる（A4に2世帯のときは QR の右に並ぶ）
  const side = el('div', 'side');
  const how = el('p', 'how');
  how.append(...HOW.map((t) => el('span', 'note-line', t)));
  side.append(how);
  const note = el('p', 'note');
  note.append(...NOTE.map((t) => el('span', 'note-line', t)));
  side.append(note);
  const ask = el('div', 'ask');
  ask.append(el('p', 'ask-title', '分からないときは班長へ'), blank('班長の名前'), blank('電話番号'));
  side.append(ask);
  s.append(side);
  s.append(el('p', 'url', h.url));
  return s;
}

let count = 0;
function per() { return document.querySelector('input[name=per]:checked')?.getAttribute('value') === '2' ? 2 : 1; }
function showLead() {
  const n = per();
  document.body.classList.toggle('per-2', n === 2);
  $('lead').textContent = `全${count}世帯分、${Math.ceil(count / n)}枚です（A4に${n}世帯ずつ）。リンクを作り直した世帯は、新しいQRになっています。`;
}

async function main() {
  if (!adminKey) {
    $('lead').textContent = '先に班長画面で管理キーを入れてください。';
    return;
  }
  try {
    const list = await households();
    if (!list.length) {
      $('lead').textContent = '世帯がまだありません。班長画面の「＋ 世帯を追加」から追加すると、ここで印刷できます。';
      return;
    }
    $('sheets').replaceChildren(...list.map(sheet));
    count = list.length;
    showLead();
    $('layout').hidden = false;
    $('print').hidden = false;
    $('print').focus();
  } catch (e) {
    const err = /** @type {any} */ (e);
    if (err.auth) $('lead').textContent = 'キーが違います。班長画面でキーを入れ直してください。';
    else if (err.status === 404) $('lead').textContent = 'QRを作る準備がまだできていません。';
    else $('msg').textContent = '読み込めませんでした。少し待って、開き直してください。';
  }
}

$('layout').addEventListener('change', showLead);
$('print').addEventListener('click', () => window.print());
main();
