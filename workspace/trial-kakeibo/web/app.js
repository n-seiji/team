'use strict';
// API 契約（eng-backend と合意済み。詳細は README の API 表）:
//  GET /members -> {members:[{id,name}]}
//  GET /entries -> {entries:[{id,date,amount,payerId,participantIds,memo,category:'home'|'work',deleted,settled,revisions}], lastCategory, lastPayerId}
//  GET /settlement -> {transfers:[{from,to,amount}], approximate, entryCount, total, undoable}
//  POST /members {name} -> {id,name} / PATCH /members/:id {name} -> {id,name}
//  PATCH /entries/:id {amount,payerId,memo,category} / DELETE /entries/:id
//  POST /entries {amount,payerId,category,memo?,date?,participantIds?}
//  POST /settle -> {batchId,settledCount} / POST /settle/undo
const $ = (s) => document.querySelector(s);
const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP');
const state = { members: [], entries: [], lastCategory: null, lastPayerId: null, editingId: null };
const name = (id) => (state.members.find((m) => m.id === id) || { name: id }).name;
const CAT = { home: '家庭', work: '仕事' };

async function api(path, opts) {
  let res;
  try {
    res = await fetch(path, opts && { ...opts, headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) });
  } catch {
    throw { message: 'サーバーにつながりません。起動しているか確認してください。' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data.error || { message: '保存できませんでした。もう一度お試しください。' };
  return data;
}

function validate(amountText, payer) {
  const t = amountText.replace(/[,，\s]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (t === '') return { field: 'amount', message: '金額を入力してください。' };
  if (!/^\d+$/.test(t)) return { field: 'amount', message: '金額は数字だけで入力してください（例：1200）。' };
  if (Number(t) <= 0) return { field: 'amount', message: '金額は1円以上にしてください。' };
  if (!payer) return { field: 'payer', message: '払った人を選んでください。' };
  return { amount: Number(t) };
}

function show(view) {
  for (const v of ['input', 'history', 'settle', 'members']) $('#view-' + v).hidden = v !== view;
  document.querySelectorAll('nav button').forEach((b) => (b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (view === 'history') renderHistory();
  if (view === 'settle') renderSettle();
  if (view === 'members') renderMembers();
  if (view === 'input') $('#amount').focus();
}

async function load() {
  const [m, e] = await Promise.all([api('/members'), api('/entries')]);
  state.members = m.members || [];
  state.entries = e.entries || [];
  state.lastCategory = e.lastCategory;
  state.lastPayerId = e.lastPayerId;
}

function renderForm() {
  const empty = state.members.length === 0;
  $('#empty-members').hidden = !empty;
  if (empty) { for (const v of ['input', 'history', 'settle', 'members']) $('#view-' + v).hidden = true; $('#name-empty').focus(); return; }
  $('#payer').innerHTML = state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  if (state.lastPayerId) $('#payer').value = state.lastPayerId;
  const cat = state.lastCategory || 'home';
  document.querySelector(`input[name=category][value=${cat}]`).checked = true;
  $('#participants').innerHTML = '<legend>負担する人</legend>' + state.members.map((m) => `<label><input type="checkbox" value="${esc(m.id)}" checked> ${esc(m.name)}</label>`).join('');
  $('#date').value = new Date().toLocaleDateString('sv-SE');
  updateHint();
}

function updateHint() {
  const ids = [...document.querySelectorAll('#participants input:checked')].map((i) => i.value);
  $('#split-hint').textContent = ids.length === state.members.length ? '全員で割ります' : ids.length ? `${ids.map(name).join('・')} で割ります` : '';
}

function clearErrors() { document.querySelectorAll('.err').forEach((e) => (e.textContent = '')); document.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid')); }
function fail(field, message) {
  const el = { amount: '#amount', payer: '#payer' }[field];
  $(el ? '#err-' + field : '#err-form').textContent = message;
  if (el) { $(el).setAttribute('aria-invalid', 'true'); $(el).focus(); }
}

$('#form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clearErrors();
  $('#saved').textContent = '';
  const payer = $('#payer').value;
  const v = validate($('#amount').value, payer);
  if (!v.amount) return fail(v.field, v.message);
  const participants = [...document.querySelectorAll('#participants input:checked')].map((i) => i.value);
  if (!participants.length) { $('#more').open = true; return fail('form', '負担する人を1人以上選んでください。'); }
  const body = { amount: v.amount, payerId: payer, category: document.querySelector('input[name=category]:checked').value, participantIds: participants, memo: $('#memo').value, date: $('#date').value };
  const editing = state.editingId;
  try {
    if (editing) await api('/entries/' + editing, { method: 'PATCH', body });
    else await api('/entries', { method: 'POST', body });
  } catch (e) {
    return fail(/^amount_/.test(e.code || '') ? 'amount' : e.code === 'payer_required' ? 'payer' : 'form', e.message);
  }
  await load();
  $('#saved').textContent = `${CAT[body.category]} ${yen(body.amount)} を${editing ? '直しました' : '保存しました'}（${name(payer)}が払った）`;
  endEdit();
  if (editing) show('history');
  else $('#amount').focus();
});

function startEdit(e) {
  state.editingId = e.id;
  show('input');
  $('#edit-banner').hidden = false;
  $('#edit-label').textContent = `${e.date} ${yen(e.amount)} の記録を直しています`;
  $('#t-input').textContent = '記録を直す';
  $('#submit').textContent = '直して保存';
  document.querySelector(`input[name=category][value=${e.category}]`).checked = true;
  $('#amount').value = String(e.amount);
  $('#payer').value = e.payerId;
  $('#memo').value = e.memo || '';
  $('#date').value = e.date;
  document.querySelectorAll('#participants input').forEach((i) => (i.checked = e.participantIds.includes(i.value)));
  updateHint();
  $('#saved').textContent = '';
  clearErrors();
  $('#amount').focus();
}
function endEdit() {
  state.editingId = null;
  $('#edit-banner').hidden = true;
  $('#t-input').textContent = '立て替えを記録';
  $('#submit').textContent = '保存';
  $('#amount').value = '';
  $('#memo').value = '';
  renderForm();
}
$('#cancel-edit').addEventListener('click', () => { endEdit(); show('history'); });
$('#participants').addEventListener('change', updateHint);

function renderHistory() {
  const list = [...state.entries].sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
  $('#history').innerHTML = list.length
    ? list.map((e) => `<li class="${e.category}${e.deleted ? ' deleted' : ''}" data-id="${e.id}">
        <span class="main"><span class="tag ${e.category}">${CAT[e.category]}</span>${e.settled ? '<span class="tag">精算済み</span>' : ''}${e.deleted ? '<span class="tag">削除済み</span>' : ''}<span class="memo">${esc(e.memo || '（メモなし）')}</span></span>
        <span class="amt">${yen(e.amount)}</span>
        <span class="meta">${e.date} ・ ${esc(name(e.payerId))}が払った${e.revisions ? ` ・ 修正${e.revisions}回` : ''}</span>
        ${e.deleted ? '' : '<span class="actions"><button class="sub" data-act="edit">修正</button><button class="sub" data-act="del">削除</button></span>'}
        <span class="row-msg" role="alert"></span></li>`).join('')
    : '<li class="empty">まだ記録がありません。「入力」から最初の1件を記録しましょう。</li>';
}
$('#history').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  const li = ev.target.closest('li[data-id]');
  if (!li) return;
  const entry = state.entries.find((x) => String(x.id) === li.dataset.id);
  const msg = li.querySelector('.row-msg');
  const act = btn?.dataset.act;
  if (act === 'edit' || act === 'del') {
    if (entry.settled) { msg.textContent = '精算済みの記録は直せません。先に精算済みを取り消してください（精算画面の「取り消す」）。'; return; }
    if (act === 'edit') return startEdit(entry);
    msg.innerHTML = `<span class="confirm">${yen(entry.amount)} の記録を削除しますか？（履歴には「削除済み」で残ります）</span> <button class="danger" data-act="del-yes">削除する</button> <button class="sub" data-act="del-no">やめる</button>`;
    msg.querySelector('[data-act=del-no]').focus();
    return;
  }
  if (act === 'del-no') { msg.textContent = ''; li.querySelector('[data-act=del]').focus(); return; }
  if (act === 'del-yes') {
    try { await api('/entries/' + entry.id, { method: 'DELETE' }); await load(); renderHistory(); }
    catch (e) { msg.textContent = e.message; }
  }
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function renderSettle() {
  const body = $('#settle-body');
  let s;
  try { s = await api('/settlement'); } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const t = s.transfers || [];
  const undoable = s.undoable === true;
  let html = `<p class="print-date">精算日：${new Date().toLocaleDateString('sv-SE')}</p>`;
  if (undoable) html += '<p class="ok noprint" role="status">精算済みにしました。<button class="sub" id="undo">取り消す</button></p><p class="err" id="undo-err" role="alert"></p>';
  if (!t.length) html += '<p class="empty">いま精算するものはありません。🎉</p>';
  else {
    html += t.map((x) => `<div class="xfer"><strong>${esc(name(x.from))}</strong> → <strong>${esc(name(x.to))}</strong>　${yen(x.amount)}</div>`).join('');
    if (s.approximate) html += '<p class="note">人数が多いため、渡す回数が最小でない場合があります（近似）。</p>';
    html += `<p class="note">家庭の未精算 ${s.entryCount} 件・合計 ${yen(s.total)}。仕事の記録は含まれません。</p><div class="noprint"><button class="primary" id="settle">精算しました</button> <button class="sub" id="print">印刷する</button></div>`;
  }
  body.innerHTML = html;
  $('#settle')?.addEventListener('click', () => {
    body.innerHTML = `<p>上の ${t.length} 件を渡し終えましたか？家庭の未精算分がすべて「精算済み」になります。</p><button class="primary" id="yes">はい、精算済みにする</button> <button class="sub" id="no">やめる</button>`;
    $('#no').onclick = renderSettle;
    $('#yes').onclick = async () => { try { await api('/settle', { method: 'POST', body: {} }); await load(); } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; } renderSettle(); };
    $('#yes').focus();
  });
  $('#print')?.addEventListener('click', () => window.print());
  $('#undo')?.addEventListener('click', async () => {
    try { await api('/settle/undo', { method: 'POST', body: {} }); await load(); } catch (e) {
      await renderSettle();
      const msg = e.code === 'nothing_to_undo' ? '取り消せる精算がありません。すでに取り消したか、精算していません。' : e.message;
      body.insertAdjacentHTML('afterbegin', `<p class="err" role="alert">${esc(msg)}</p>`);
      return;
    }
    renderSettle();
  });
}

function renderMembers() {
  $('#member-list').innerHTML = state.members.map((m) => `<li data-id="${esc(m.id)}"><input aria-label="名前" value="${esc(m.name)}" autocomplete="off"><button class="sub" data-act="rename">変更</button><span class="row-msg" role="alert"></span></li>`).join('');
}
$('#member-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act=rename]');
  if (!btn) return;
  const li = btn.closest('li');
  const msg = li.querySelector('.row-msg');
  msg.textContent = '';
  try {
    await api('/members/' + li.dataset.id, { method: 'PATCH', body: { name: li.querySelector('input').value } });
    await load();
    renderMembers();
    $('#member-list li[data-id="' + li.dataset.id + '"] .row-msg').textContent = '名前を変えました。';
    $('#member-list li[data-id="' + li.dataset.id + '"] .row-msg').setAttribute('role', 'status');
  } catch (e) { msg.textContent = e.message; li.querySelector('input').focus(); }
});
function bindAddMember(form, input, err, after) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    if (!input.value.trim()) { err.textContent = '名前を入力してください。'; input.focus(); return; }
    try { await api('/members', { method: 'POST', body: { name: input.value } }); }
    catch (e) { err.textContent = e.message; input.focus(); return; }
    input.value = '';
    await load();
    renderForm();
    after();
    input.focus();
  });
}
bindAddMember($('#add-member'), $('#new-name'), $('#err-new-name'), renderMembers);
bindAddMember($('#add-first'), $('#name-empty'), $('#err-name-empty'), () => { if (state.members.length) show('input'); });

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
load().then(renderForm).catch((e) => { $('#err-form').textContent = e.message; });
