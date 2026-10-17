// @ts-check
// 住民画面 /r/<token>。API: GET /api/r/<token>, POST /api/r/<token>/read
const token = location.pathname.split('/').filter(Boolean)[1] ?? '';
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const readBtn = /** @type {HTMLButtonElement} */ ($('read'));
/** 表示中の回覧。読了はこの回覧に付ける（開いた後に新しい回覧が登録されても取り違えない） */
let circularId = /** @type {number | null} */ (null);

/** @param {string} iso */
function md(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** @param {string} readAt */
function showDone(readAt) {
  readBtn.disabled = true;
  readBtn.textContent = `読みました（${md(readAt)}）`;
}

function showInvalid() {
  $('title').textContent = 'このリンクは使えません';
  $('content').className = 'notice';
  $('content').textContent = '班長さんに新しいリンクをもらってください。';
  readBtn.hidden = true;
}

/** @param {string} [search] 「次を読む」では空にして、一番古い未読を出してもらう */
async function load(search = location.search) {
  try {
    const res = await fetch(`/api/r/${encodeURIComponent(token)}${search}`);
    if (res.status === 404 || res.status === 400) return showInvalid();
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!data.circular) {
      $('title').textContent = 'まだ回覧はありません';
      $('content').className = 'notice';
      $('content').textContent = '新しい回覧が届いたら、このリンクで読めます。';
      readBtn.hidden = true;
      return;
    }
    circularId = data.circular.id;
    document.title = data.title;
    $('title').textContent = data.title;
    $('content').textContent = data.body;
    readBtn.hidden = false;
    if (data.status === 'self' && data.readAt) showDone(data.readAt);
  } catch {
    $('content').className = 'notice error';
    $('content').textContent = '今は開けません。少し待って、もう一度このリンクを開いてください。';
  }
}

readBtn.addEventListener('click', async () => {
  readBtn.disabled = true;
  try {
    const res = await fetch(`/api/r/${encodeURIComponent(token)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circularId }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    $('thanks').hidden = false;
    $('thanks').textContent = 'ありがとうございます。読んだことを班長さんに伝えました';
    showDone(data.readAt);
    showMore(data.unreadCount ?? 0);
  } catch {
    readBtn.disabled = false;
    $('thanks').hidden = false;
    $('thanks').className = 'thanks error';
    $('thanks').textContent = '送れませんでした。もう一度「読みました」を押してください。';
  }
});

/** 押した後に、まだ読んでいない回覧が残っていれば件数と「次を読む」を出す @param {number} n */
function showMore(n) {
  $('more').hidden = $('next').hidden = n < 1;
  $('more').textContent = n >= 1 ? `まだ読んでいない回覧があと${n}件あります` : '';
}

$('next').addEventListener('click', async () => {
  $('thanks').hidden = true;
  $('thanks').className = 'thanks';
  showMore(0);
  readBtn.disabled = false;
  readBtn.textContent = '読みました';
  if (location.search) history.replaceState(null, '', location.pathname);
  await load('');
  window.scrollTo(0, 0);
  $('title').focus();
});

load();
