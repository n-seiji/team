import { api, daysOfMonth, formatReceived, nextMonth, mdLabel } from './common.js';

const $ = (id) => document.getElementById(id);
const state = { staffId: '', month: nextMonth(), days: {}, dirty: false };

function setResult(kind, text) {
  const el = $('result');
  el.className = kind ? `result ${kind}` : '';
  el.textContent = text || '';
}

function renderDays() {
  const ul = $('days');
  ul.textContent = '';
  for (const d of daysOfMonth(state.month)) {
    const cur = state.days[d.date] || {};
    const li = document.createElement('li');
    li.className = `day wd${d.wd}`;
    li.innerHTML = `<div class="dayhead"><span class="date">${mdLabel(d.date)}(${d.wdLabel})</span>
      <span class="seg" role="group" aria-label="${mdLabel(d.date)}の希望">
        <button type="button" data-v="ok" aria-pressed="${cur.available === true}">入れる</button>
        <button type="button" data-v="ng" aria-pressed="${cur.available === false}">入れない</button>
      </span></div>
      <input class="note" type="text" maxlength="60" placeholder="一言メモ(例: 17時まで)" aria-label="${mdLabel(d.date)}のメモ" value="">`;
    li.querySelector('.note').value = cur.note || '';
    li.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
      const want = b.dataset.v === 'ok';
      const day = state.days[d.date] || {};
      if (day.available === want) delete day.available; else day.available = want;
      state.days[d.date] = day;
      touched();
      li.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(day.available === (x.dataset.v === 'ok'))));
    }));
    li.querySelector('.note').addEventListener('input', (e) => {
      state.days[d.date] = { ...(state.days[d.date] || {}), note: e.target.value };
      touched();
    });
    ul.append(li);
  }
}

function touched() {
  state.dirty = true;
  setResult('', ''); // 直したら、前回の受け付け表示は消す(古い表示を信じさせない)
}

// 空の日(未選択でメモもなし)は送らない
function payloadDays() {
  const out = {};
  for (const [date, v] of Object.entries(state.days)) {
    const note = (v.note || '').trim();
    if (typeof v.available !== 'boolean') continue; // サーバーは入れる/入れないが決まった日だけ受ける
    out[date] = { available: v.available, ...(note ? { note } : {}) };
  }
  return out;
}

async function load() {
  setResult('', '');
  $('form').hidden = !state.staffId;
  $('empty').hidden = !!state.staffId;
  if (!state.staffId) return;
  $('prev').textContent = '読み込み中…';
  try {
    const r = await api(`/api/staff/${encodeURIComponent(state.staffId)}/requests?month=${state.month}`);
    state.days = r.days || {};
    $('prev').textContent = r.submitted
      ? `前回の提出(${formatReceived(r.submittedAt)})の内容です。直して、もう一度提出できます。`
      : 'まだ提出していません。';
  } catch (e) {
    state.days = {};
    $('prev').textContent = `前回の内容を読み込めませんでした(${e.message})。入力して提出することはできます。`;
  }
  state.dirty = false;
  renderDays();
}

async function submit() {
  const btn = $('submit');
  btn.disabled = true;
  btn.textContent = '送信中…';
  setResult('', '');
  try {
    const r = await api(`/api/staff/${encodeURIComponent(state.staffId)}/requests?month=${state.month}`, {
      method: 'PUT', body: { days: payloadDays() },
    });
    if (!r || !r.receivedAt) throw new Error('受付の返事がありませんでした');
    state.dirty = false;
    setResult('ok', `受け付けました(${formatReceived(r.receivedAt)})`);
  } catch (e) {
    // 入力は残したまま、受け付け表示は出さない
    setResult('err', '保存できませんでした。まだ受け付けていません。通信を確かめて、もう一度「提出する」を押してください。');
  } finally {
    btn.disabled = false;
    btn.textContent = '提出する';
  }
}

async function init() {
  $('month').value = state.month;
  try {
    const list = await api('/api/staff');
    for (const s of list) {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = s.name;
      $('who').append(o);
    }
    if (!list.length) $('empty').textContent = 'まだスタッフが登録されていません。お店の人に伝えてください。';
  } catch {
    $('empty').textContent = '名前の一覧を読み込めませんでした。ページを開き直してください。';
  }
  $('who').addEventListener('change', (e) => { state.staffId = e.target.value; load(); });
  $('month').addEventListener('change', (e) => { if (e.target.value) { state.month = e.target.value; load(); } });
  $('submit').addEventListener('click', submit);
  window.addEventListener('beforeunload', (e) => { if (state.dirty) e.preventDefault(); });
}
init();
