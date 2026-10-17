import { adaptList, adaptDetail, adaptGroups, JA } from './adapt.js';
import { STATUS, isStale, stayText, noReceipt, modeLabel, actionsFor, pendingImportant, progressText, sortGroups } from './logic.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても動く */ } },
};
const api = async (path, opt) => {
  const r = await fetch('/api' + path, opt && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opt) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json();
};

let circulars = [], detail = null, me = store.get('me'); // me = {group, name, pass}
let toastTimer;

const impBadge = '<span class="badge imp">重要</span>';

async function loadList() {
  try { circulars = adaptList(await api('/circulars')); }
  catch { $('summary').innerHTML = '<div class="empty">回覧の一覧を読み込めませんでした。通信を確認して、ページを開き直してください。</div>'; return; }
  const sel = $('circular');
  if (!circulars.length) { sel.innerHTML = ''; $('groups').innerHTML = ''; $('summary').innerHTML = '<div class="empty">まだ回覧がありません。会長が回覧を作成すると、ここに表示されます。</div>'; return; }
  sel.innerHTML = circulars.map((c) => `<option value="${esc(c.id)}">${c.importance === 'important' ? '【重要】' : ''}${esc(c.title)}${c.completed ? '(完了)' : ''}</option>`).join('');
  sel.value = store.get('circular') ?? circulars[0].id;
  if (sel.value !== String(store.get('circular') ?? circulars[0].id)) sel.selectedIndex = 0;
  await loadDetail();
}

async function loadDetail() {
  const id = $('circular').value;
  store.set('circular', id);
  try { detail = adaptDetail(await api(`/circulars/${encodeURIComponent(id)}`)); }
  catch { $('groups').innerHTML = '<li class="empty">状況を読み込めませんでした。少し待ってからもう一度開いてください。</li>'; return; }
  render();
}

function render() {
  const c = detail;
  const pend = pendingImportant(circulars);
  $('summary').innerHTML =
    (c.importance === 'important'
      ? `<div class="banner">${impBadge} <strong>${esc(c.title)}</strong> — ${c.completed ? '全家が受取済になりました(完了)' : '未完了:全家が「受取済」になるまで表示します'}</div>`
      : `<div><strong>${esc(c.title)}</strong>${c.completed ? ' — 完了' : ''}</div>`) +
    (pend ? `<p class="hint">未完了の重要な回覧: ${pend}件</p>` : '');
  const stale = c.groups.filter((g) => isStale(g.current)).length;
  $('groups').setAttribute('aria-label', stale ? `${stale}班が3日以上止まっています` : '止まっている班はありません');
  $('groups').innerHTML = (stale ? `<li class="hint" style="list-style:none">⚠ ${stale}班が3日以上止まっています(上に表示)</li>` : '') +
    sortGroups(c.groups).map(groupRow).join('');
  renderMine();
}

function groupRow(g) {
  const cur = g.current, st = isStale(cur);
  if (!cur) return `<li class="g"><span class="no">${esc(g.name)}</span><span class="house">✓ 完了(全家が受取済か次へ渡し済み)</span><span class="meta">${progressText(g)}</span></li>`;
  return `<li class="g${st ? ' stale' : ''}">
    <span class="no">${esc(g.name)}</span>
    <span class="house">${esc(cur.houseName)} <span class="badge ${cur.mode}">${modeLabel(cur.mode)}</span></span>
    <span class="meta"><span>${stayText(cur)}</span>
      ${st ? `<span class="alert">⚠ 3日以上</span>` : '<span></span>'}
      <span>${STATUS[cur.status]}${noReceipt(cur) ? '(受取の記録なし)' : ''} ・ ${progressText(g)}</span></span>
  </li>`;
}

function renderMine() {
  const el = $('mine');
  if (!me) { el.innerHTML = '<button id="openSetup">班長さんはこちら(最初の1回だけ設定)</button>'; $('openSetup').onclick = openSetup; return; }
  const g = detail.groups.find((x) => x.group === me.group);
  if (!g || !g.current) { el.innerHTML = `<div class="mine"><h2>${esc(g.name)}(${esc(me.name)}さん)</h2><p>この回覧は、${esc(g.name)}では完了しています。</p></div>`; return; }
  const cur = g.current;
  el.innerHTML = `<div class="mine"><h2>${esc(g.name)} — ${esc(me.name)}さん <button id="reset" class="hint" style="min-height:32px">設定を変える</button></h2>
    <p class="big">いま: ${esc(cur.houseName)} <span class="badge ${cur.mode}">${modeLabel(cur.mode)}</span></p>
    <p>${STATUS[cur.status]} ・ ${stayText(cur)}${cur.mode === 'paper' ? ' ・ 紙の家です。紙の動きを見て、ここに記録します' : ''}</p>
    <div class="actions">${actionsFor(cur.status).map((a) => `<button data-s="${a.status}" aria-pressed="${a.current}">${a.label}</button>`).join('')}</div>
    <p class="hint">「次へ渡した」を押しても、5秒の間なら取り消せます。</p></div>`;
  el.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => record(g, b.dataset.s)));
  $('reset').onclick = openSetup;
}

async function record(g, status) {
  const cur = g.current, prev = { house: cur.house, status: cur.status };
  if (status === cur.status) return;
  try {
    await api(`/circulars/${encodeURIComponent(detail.id)}/records`, { houseId: cur.house, status: JA[status], by: me.name, passphrase: me.pass });
  } catch (e) {
    if (e.status === 403) { me = null; store.set('me', null); toast('合言葉が違うようです。もう一度設定してください。'); openSetup(); }
    else toast('記録できませんでした。通信を確認して、もう一度押してください。');
    return;
  }
  await loadDetail();
  toast(`${cur.houseName}を「${STATUS[status]}」に記録しました`, {
    label: '元に戻す',
    fn: async () => {
      // 追記専用ログなので、元の状態をもう一度記録して戻す
      await api(`/circulars/${encodeURIComponent(detail.id)}/records`, { houseId: prev.house, status: JA[prev.status], by: me.name, passphrase: me.pass }).catch(() => toast('取り消せませんでした'));
      await loadDetail(); toast('元に戻しました');
    },
  });
}

function toast(msg, undo) {
  const t = $('toast'); clearTimeout(toastTimer);
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button id="undo">元に戻す</button>' : ''}`;
  t.classList.add('show');
  if (undo) $('undo').onclick = () => { t.classList.remove('show'); undo.fn(); };
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 5000 : 3500);
}

async function openSetup() {
  const dlg = $('setup');
  let roster = [];
  try { roster = adaptGroups(await api('/groups')); } catch { toast('班長名簿を読み込めませんでした'); return; }
  $('sGroup').innerHTML = roster.map((r) => `<option value="${esc(r.group)}">${esc(r.name)}</option>`).join('');
  const fillNames = () => { const r = roster.find((x) => x.group === $('sGroup').value); $('sName').innerHTML = r.leaders.map((n) => `<option>${esc(n)}</option>`).join(''); };
  $('sGroup').onchange = fillNames; fillNames(); $('sErr').textContent = ''; $('sPass').value = '';
  $('setupForm').onsubmit = () => {};
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    me = { group: $('sGroup').value, name: $('sName').value, pass: $('sPass').value };
    store.set('me', me); renderMine();
  };
  dlg.showModal();
}

$('circular').onchange = loadDetail;
loadList();
setInterval(() => { if (document.visibilityState === 'visible' && circulars.length) loadDetail(); }, 60000);
