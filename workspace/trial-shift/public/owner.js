import { api, daysOfMonth, nextMonth, mdLabel } from './common.js';
import { buildShifts, ngWarnings, overLimitText, yen, pct, lineText } from './shift-logic.js';

const $ = (id) => document.getElementById(id);
const KEY = 'owner-key';
const state = { month: nextMonth(), staff: [], cells: {}, calc: null, seq: 0 };
let ownerKey = '';
try { ownerKey = sessionStorage.getItem(KEY) || ''; } catch { /* 使えなくても動く */ }

const draftKey = () => `shift-draft-${state.month}`;
function saveDraft() { try { localStorage.setItem(draftKey(), JSON.stringify({ cells: state.cells, revenue: $('revenue').value, target: $('target').value })); } catch { /* 無視 */ } }
function loadDraft() {
  state.cells = {};
  try {
    const d = JSON.parse(localStorage.getItem(draftKey()) || 'null');
    if (d) { state.cells = d.cells || {}; $('revenue').value = d.revenue || ''; $('target').value = d.target || '30'; }
  } catch { /* 無視 */ }
}

const num = (s) => Number(String(s).replace(/[,\s円]/g, ''));

async function ownerApi(path, opts = {}) {
  return api(path, { ...opts, ownerKey });
}

function askKey(message = '') {
  return new Promise((resolve) => {
    const dlg = $('keydlg');
    $('keyerr').textContent = message;
    dlg.showModal();
    $('keyform').onsubmit = () => { ownerKey = $('keyinput').value; resolve(); };
  });
}

async function load() {
  $('loadErr').textContent = '';
  loadDraft();
  let r;
  for (;;) {
    try {
      if (!ownerKey) await askKey();
      r = await ownerApi(`/api/owner/requests?month=${state.month}`);
      try { sessionStorage.setItem(KEY, ownerKey); } catch { /* 無視 */ }
      break;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { ownerKey = ''; await askKey('合言葉が違います。もう一度入力してください。'); continue; }
      $('loadErr').textContent = `希望を読み込めませんでした(${e.message})。ページを開き直してください。`;
      return;
    }
  }
  state.staff = r.staff;
  renderGrid();
  recalc();
}

function renderGrid() {
  const head = document.querySelector('#grid thead');
  const body = document.querySelector('#grid tbody');
  head.textContent = ''; body.textContent = '';
  const tr = document.createElement('tr');
  tr.innerHTML = '<th scope="col" class="datecol">日付</th>';
  for (const s of state.staff) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.className = s.submittedAt ? '' : 'missing';
    th.innerHTML = `<span class="nm"></span><span class="badge ${s.submittedAt ? 'done' : 'none'}">${s.submittedAt ? '提出済' : '未提出'}</span>`;
    th.querySelector('.nm').textContent = s.name;
    tr.append(th);
  }
  head.append(tr);
  for (const d of daysOfMonth(state.month)) {
    const row = document.createElement('tr');
    row.className = `wd${d.wd}`;
    row.innerHTML = `<th scope="row" class="datecol">${mdLabel(d.date)}(${d.wdLabel})</th>`;
    for (const s of state.staff) {
      const req = s.days && s.days[d.date];
      const td = document.createElement('td');
      const key = `${d.date}|${s.id}`;
      let tag = '';
      if (req && req.available === true) tag = '<span class="req ok">○ 入れる</span>';
      else if (req && req.available === false) tag = '<span class="req ng">× 入れない</span>';
      else if (!s.submittedAt) tag = '<span class="req none">未提出</span>';
      td.innerHTML = `${tag}${req && req.note ? '<span class="memo"></span>' : ''}<input type="text" class="shift" inputmode="numeric" placeholder="09:00-14:00">`;
      if (req && req.note) td.querySelector('.memo').textContent = req.note;
      const input = td.querySelector('input');
      input.value = state.cells[key] || '';
      input.setAttribute('aria-label', `${s.name} ${mdLabel(d.date)}のシフト`);
      input.dataset.key = key;
      input.addEventListener('change', () => { state.cells[key] = input.value; saveDraft(); recalc(); });
      input.addEventListener('keydown', navigate);
      row.append(td);
    }
    body.append(row);
  }
  refreshCellMarks();
}

// 矢印キー/Enter でセル移動。左右は文字の端にいるときだけ。
function navigate(e) {
  const input = e.target;
  const td = input.closest('td');
  const tr = td.parentElement;
  const col = [...tr.children].indexOf(td);
  let target = null;
  if (e.key === 'ArrowDown' || e.key === 'Enter') target = tr.nextElementSibling?.children[col];
  else if (e.key === 'ArrowUp') target = tr.previousElementSibling?.children[col];
  else if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) target = td.previousElementSibling;
  else if (e.key === 'ArrowRight' && input.selectionStart === input.value.length) target = td.nextElementSibling;
  else return;
  e.preventDefault();
  const next = target && target.querySelector('input');
  if (next) { next.focus(); next.select(); } else if (e.key === 'Enter') input.blur();
}

function refreshCellMarks() {
  const { shifts, errors } = buildShifts(state.cells);
  const ng = new Set(ngWarnings(shifts, state.staff).map((w) => `${w.date}|${w.staffId}`));
  document.querySelectorAll('#grid input.shift').forEach((inp) => {
    const k = inp.dataset.key;
    inp.classList.toggle('bad', !!errors[k]);
    inp.classList.toggle('ngday', ng.has(k));
    inp.title = errors[k] || '';
    inp.setAttribute('aria-invalid', String(!!errors[k]));
  });
  return { shifts, errors };
}

async function recalc() {
  const { shifts, errors } = refreshCellMarks();
  const warns = [];
  for (const [k, msg] of Object.entries(errors)) {
    const [date, id] = k.split('|');
    const who = state.staff.find((s) => s.id === id);
    warns.push({ kind: 'input', text: `${who?.name ?? ''}さん ${mdLabel(date)}: ${msg}` });
  }
  for (const w of ngWarnings(shifts, state.staff)) warns.push({ kind: 'ng', text: `⚠ ${w.text}` });

  const revenue = num($('revenue').value);
  const targetPct = num($('target').value);
  const my = ++state.seq;
  if (revenue > 0) {
    $('calcState').textContent = ' 計算中…';
    try {
      const c = await ownerApi('/api/calc', {
        method: 'POST',
        body: { month: state.month, shifts, revenue, targetRate: (targetPct || 30) / 100 },
      });
      if (my !== state.seq) return; // 古い応答は捨てる
      state.calc = c;
      $('calcState').textContent = '';
      showSummary(c);
      for (const o of c.overLimit || []) warns.push({ kind: 'limit', text: `⚠ 週上限超え: ${overLimitText(o)}` });
    } catch (e) {
      if (my !== state.seq) return;
      $('calcState').textContent = ` 計算できませんでした(${e.message})。前回の数字のままです。`;
    }
  } else {
    $('calcState').textContent = ' 売上見込みを入れると、人件費の率が出ます。';
  }
  const ul = $('warns');
  ul.textContent = '';
  for (const w of warns) { const li = document.createElement('li'); li.className = w.kind; li.textContent = w.text; ul.append(li); }
}

function showSummary(c) {
  $('sCost').textContent = yen(c.totalCost);
  $('sRate').textContent = pct(c.rate);
  const diff = c.diffPoints;
  $('sDiff').textContent = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}ポイント`;
  const over = c.rate > c.targetRate;
  $('summary').classList.toggle('over', over);
  $('sDiff').textContent += over ? '(目標超え)' : '';
}

function makeText() {
  const { shifts } = buildShifts(state.cells);
  const t = lineText(state.month, daysOfMonth(state.month), state.staff, shifts);
  const out = $('lineOut');
  out.hidden = false; out.value = t; $('copyText').hidden = false;
  out.focus(); out.select();
}

async function init() {
  $('month').value = state.month;
  $('month').addEventListener('change', (e) => { if (e.target.value) { state.month = e.target.value; load(); } });
  for (const id of ['revenue', 'target']) $(id).addEventListener('change', () => { saveDraft(); recalc(); });
  $('makeText').addEventListener('click', makeText);
  $('copyText').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('lineOut').value); $('copyText').textContent = 'コピーしました'; }
    catch { $('lineOut').select(); $('copyText').textContent = '選択したので Ctrl+C でコピー'; }
    setTimeout(() => { $('copyText').textContent = 'コピー'; }, 2500);
  });
  await load();
}
init();
