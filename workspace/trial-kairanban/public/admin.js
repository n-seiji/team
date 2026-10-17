// @ts-check
// 班長画面 /admin。管理キーは X-Admin-Key ヘッダで送る。
// API: GET /api/admin/circulars -> [{id,title}]
//      GET /api/admin/circulars/<id> -> {id,title,households:[{id,name,status,readAt,url}]}
//      POST /api/admin/circulars/<id>/households/<hid>/proxy
//      POST /api/circulars {title,body} / POST /api/households {name} / POST /api/households/<id>/reissue
//      400 のときは {error} を画面に出す
const KEY = 'kairanban-admin-key';
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const LABEL = { unread: '未読', self: '本人が読んだ', proxy: '班長が代理記録' };

let adminKey = '';
try { adminKey = localStorage.getItem(KEY) ?? ''; } catch {}
/** @type {{id:string,title:string,households:any[]}|null} */
let current = null;

class AuthError extends Error {}
class InputError extends Error {}

/** @param {string} path @param {RequestInit} [init] */
async function api(path, init = {}) {
  /** @type {Record<string,string>} */
  const headers = { 'X-Admin-Key': adminKey };
  if (init.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 || res.status === 403) throw new AuthError();
  if (res.status === 400) throw new InputError((await res.json().catch(() => ({}))).error ?? '入力を確かめてください');
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** @param {string} path @param {object} body */
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

/** @param {string} text */
function showBanner(text) {
  $('banner').textContent = text;
  $('banner').hidden = false;
}

/** 欄のすぐ下に理由を出す。空文字で消す @param {string} id @param {string} text */
function fieldError(id, text) {
  $(id + 'Err').textContent = text;
  $(id + 'Err').hidden = !text;
  if (text) $(id).setAttribute('aria-invalid', 'true');
  else $(id).removeAttribute('aria-invalid');
}

/** 管理 API の url は完全な URL (PUBLIC_URL) の予定。相対でも動くようにしておく @param {any} h */
const fullUrl = (h) => new URL(h.url ?? h.link, location.origin).href;

/** @param {string} iso */
function when(iso) {
  const d = new Date(iso);
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${p(d.getMinutes())}`;
}

function askKey(wrong) {
  $('board').hidden = true;
  $('tools').hidden = true;
  $('keyform').hidden = false;
  $('keyerr').textContent = wrong ? 'キーが違います。班長さんに確認してください' : '';
  $('key').value = '';
  $('key').focus();
}

/** @param {string|number} [selectId] 登録直後はその回覧を選ぶ */
async function start(selectId) {
  $('msg').textContent = '';
  if (!adminKey) return askKey(false);
  try {
    const list = await api('/api/admin/circulars');
    $('keyform').hidden = true;
    try { localStorage.setItem(KEY, adminKey); } catch {}
    $('tools').hidden = false;
    if (!list.length) {
      $('board').hidden = false;
      $('circular').hidden = true;
      $('rows').replaceChildren();
      $('summary').textContent = '';
      $('empty').hidden = false;
      $('empty').textContent = 'まだ回覧がありません。上の「＋ 回覧を登録」から登録すると、ここに読んだ人の一覧が出ます。';
      return;
    }
    const sel = $('circular');
    sel.hidden = false;
    sel.replaceChildren(...list.map((/** @type {any} */ c) => new Option(c.title, c.id)));
    if (selectId !== undefined) sel.value = String(selectId);
    $('board').hidden = false;
    await loadCircular(sel.value);
  } catch (e) {
    if (e instanceof AuthError) {
      try { localStorage.removeItem(KEY); } catch {}
      adminKey = '';
      askKey(true);
    } else {
      $('msg').textContent = '一覧を読み込めませんでした。少し待って、画面を開き直してください。';
    }
  }
}

/** @param {string} id */
async function loadCircular(id) {
  current = await api(`/api/admin/circulars/${encodeURIComponent(id)}`);
  render();
}

function render() {
  if (!current) return;
  const hs = current.households;
  const read = hs.filter((h) => h.status !== 'unread').length;
  $('summary').textContent = `読了 ${read}/${hs.length}世帯`;
  const shown = $('onlyUnread').checked ? hs.filter((h) => h.status === 'unread') : hs;
  $('empty').hidden = shown.length > 0;
  $('empty').textContent = hs.length === 0 ? '世帯がまだ登録されていません。' : '未読の世帯はありません。全員が読みました。';
  $('rows').replaceChildren(...shown.map(row));
}

/** @param {any} h */
function row(h) {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = h.name;
  const badge = document.createElement('span');
  badge.className = `badge ${h.status}`;
  badge.textContent = LABEL[h.status];
  li.append(name, badge);
  if (h.status !== 'unread' && h.readAt) {
    const t = document.createElement('span');
    t.className = 'when';
    t.textContent = when(h.readAt);
    li.append(t);
  }

  if (h.status === 'unread') {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '紙で読んだと記録する';
    b.addEventListener('click', () => proxy(h));
    li.append(b);
  }
  const fresh = reissued === h.id;
  const copyLabel = fresh ? '新しいリンクをコピー' : 'リンクをコピー';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'sub copy';
  copy.dataset.hid = String(h.id);
  copy.textContent = copyLabel;
  copy.setAttribute('aria-label', `${h.name}の${copyLabel}`);
  copy.addEventListener('click', () => copyLink(h, copy, copyLabel));
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'sub';
  again.textContent = 'リンクを作り直す';
  again.setAttribute('aria-label', `${h.name}のリンクを作り直す`);
  again.addEventListener('click', () => reissue(h));
  li.append(copy, again);

  return li;
}

/** @param {any} h */
async function proxy(h) {
  if (!current) return;
  if (!confirm(`${h.name}を「紙で読んだ」と記録します。よろしいですか？`)) return;
  try {
    await api(`/api/admin/circulars/${encodeURIComponent(current.id)}/households/${encodeURIComponent(h.id)}/proxy`, { method: 'POST' });
    await loadCircular(current.id);
  } catch {
    $('msg').textContent = '記録できませんでした。もう一度試してください。';
  }
}

/** 作り直した直後の世帯 id。その行のコピーボタンを「新しいリンクをコピー」にする */
let reissued = /** @type {number|null} */ (null);

/** @param {any} h */
async function reissue(h) {
  if (!current) return;
  if (!confirm(`前のリンクは使えなくなります。よろしいですか？\n（${h.name}）`)) return;
  try {
    await post(`/api/households/${encodeURIComponent(h.id)}/reissue`, {});
    reissued = h.id;
    $('onlyUnread').checked = false;
    await loadCircular(current.id);
    showBanner(`${h.name}のリンクを作り直しました。前のリンクは使えません。新しいリンクをコピーして渡してください。`);
    document.querySelector(`button.copy[data-hid="${h.id}"]`)?.focus();
  } catch (e) {
    if (e instanceof AuthError) return start();
    $('msg').textContent = '作り直せませんでした。もう一度試してください。';
  }
}

/** @param {any} h @param {HTMLButtonElement} btn @param {string} label */
async function copyLink(h, btn, label) {
  const url = fullUrl(h);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // clipboard が使えない環境 (http の LAN など) は選択コピーにフォールバック
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  btn.textContent = 'コピーしました ✓';
  setTimeout(() => { btn.textContent = label; }, 2000);
}

$('keyform').addEventListener('submit', (/** @type {Event} */ e) => {
  e.preventDefault();
  adminKey = $('key').value.trim();
  start();
});
$('circular').addEventListener('change', () => loadCircular($('circular').value));

$('circularForm').addEventListener('submit', async (/** @type {Event} */ e) => {
  e.preventDefault();
  const title = $('ctitle').value.trim(), body = $('cbody').value.trim();
  fieldError('ctitle', title ? '' : 'タイトルを入れてください');
  fieldError('cbody', body ? '' : '本文を入れてください');
  if (!title) return $('ctitle').focus();
  if (!body) return $('cbody').focus();
  try {
    const c = await post('/api/circulars', { title, body });
    $('ctitle').value = ''; $('cbody').value = '';
    $('newCircular').open = false;
    $('onlyUnread').checked = false;
    reissued = null;
    await start(c.id);
    showBanner(`「${c.title}」を登録しました。下の一覧で、読んだ世帯が分かります。`);
    $('circular').focus();
  } catch (err) {
    if (err instanceof InputError) fieldError(String(err.message).startsWith('本文') ? 'cbody' : 'ctitle', err.message);
    else if (err instanceof AuthError) start();
    else $('msg').textContent = '登録できませんでした。もう一度試してください。';
  }
});

$('householdForm').addEventListener('submit', async (/** @type {Event} */ e) => {
  e.preventDefault();
  const name = $('hname').value.trim();
  fieldError('hname', name ? '' : '表示名を入れてください（例：山田さん）');
  if (!name) return $('hname').focus();
  try {
    // 同じ名前が2つあると、紙の QR がどちらの家のものか分からなくなる
    const { households } = await api('/api/households');
    if (households.some((/** @type {any} */ x) => x.name === name)) {
      fieldError('hname', `${name}はもう登録されています。区別できる名前にしてください（例：${name.replace(/さん$/, '')}さん（2丁目））`);
      return $('hname').focus();
    }
    const h = await post('/api/households', { name });
    $('hname').value = '';
    $('onlyUnread').checked = false;
    if (current) {
      await loadCircular(current.id);
      showBanner(`${h.name}を追加しました。一覧の一番下に出ています。続けて追加できます。`);
    } else {
      showBanner(`${h.name}を追加しました。回覧を登録すると、一覧に出ます。続けて追加できます。`);
    }
    $('hname').focus();
  } catch (err) {
    if (err instanceof InputError) fieldError('hname', err.message);
    else if (err instanceof AuthError) start();
    else $('msg').textContent = '追加できませんでした。もう一度試してください。';
  }
});
$('onlyUnread').addEventListener('change', render);

start();
