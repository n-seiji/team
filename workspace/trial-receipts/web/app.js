import { createApi } from './api.js';
import { createMockApi } from './mock-api.js';
import {
  FIELD_KEYS, FIELD_LABELS, CATEGORIES, MAX_SIDE,
  fitSize, flaggedKeys, needsReview, visibleReceipts, flagText, countText, validateInput,
} from './logic.js';

const $ = (s) => document.querySelector(s);
const els = { list: $('#list'), empty: $('#empty'), bar: $('#bar'), count: $('#count'), filter: $('#filter'),
  camera: $('#camera'), toast: $('#toast'), noMatch: $('#no-match'), banner: $('#demo-banner') };

const state = { api: null, receipts: [], count: 0, onlyReview: false, pending: [], rowSig: new Map() };
let shotNo = 0;

// ---- 縮小（長辺 MAX_SIDE px）。失敗したら元画像をそのまま送る ----
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height, scaled } = fitSize(bmp.width, bmp.height, MAX_SIDE);
    if (!scaled) return file;
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    cv.getContext('2d').drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
    return blob || file;
  } catch { return file; }
}

// ---- 登録（一覧に行を足すだけ。画面は切り替えない） ----
async function register(file) {
  const p = { key: `p${++shotNo}`, file, url: URL.createObjectURL(file), error: '' };
  state.pending.unshift(p);
  render();
  try {
    const blob = await shrink(file);
    await state.api.upload(blob, file.name || 'receipt.jpg');
    state.pending = state.pending.filter((x) => x !== p);
    URL.revokeObjectURL(p.url);
    await refresh();
    say(`${shotNo}枚目を登録しました`);
  } catch (e) {
    p.error = e.message || '送れませんでした';
    render();
  }
}

els.camera.addEventListener('change', () => {
  const files = [...els.camera.files];
  els.camera.value = ''; // 続けて同じ操作で10枚撮れるように
  files.forEach(register);
});
document.querySelectorAll('.shoot').forEach((b) => b.addEventListener('click', () => els.camera.click()));
els.filter.addEventListener('click', () => {
  state.onlyReview = !state.onlyReview;
  els.filter.setAttribute('aria-pressed', String(state.onlyReview));
  render();
});

function say(text) { els.toast.textContent = ''; setTimeout(() => (els.toast.textContent = text), 50); }

// ---- 取得と定期更新（読み取り待ちがある間だけ） ----
async function refresh() {
  const res = await state.api.list();
  state.receipts = res.receipts;
  state.count = res.needs_review_count;
  render();
}
let timer;
function schedulePoll() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try { if (state.receipts.some((r) => r.status === 'reading')) await refresh(); } catch {}
    schedulePoll();
  }, 1500);
}

// ---- 描画 ----
function render() {
  const total = state.receipts.length + state.pending.length;
  els.count.textContent = countText(state.count);
  els.count.classList.toggle('has', state.count > 0);
  els.filter.hidden = total === 0;
  els.empty.hidden = total !== 0;
  els.bar.hidden = total === 0;

  const rows = visibleReceipts(state.receipts, state.onlyReview);
  els.noMatch.hidden = !(state.onlyReview && total > 0 && rows.length === 0 && state.pending.length === 0);

  const want = [
    ...(state.onlyReview ? [] : state.pending).map((p) => ({ key: p.key, sig: JSON.stringify([p.error]), build: () => pendingRow(p) })),
    ...rows.map((r) => ({ key: r.id, sig: JSON.stringify([r.status, r.fields, r.edited]), build: () => receiptRow(r) })),
  ];
  const keep = new Set(want.map((w) => w.key));
  for (const [k] of state.rowSig) if (!keep.has(k)) { document.getElementById(`r-${k}`)?.remove(); state.rowSig.delete(k); }

  let prev = null;
  for (const w of want) {
    let li = document.getElementById(`r-${w.key}`);
    // 入力中の行は上書きしない（打っている途中の文字が消えるのを防ぐ）
    const editing = li && li.contains(document.activeElement) && state.rowSig.has(w.key);
    if (!li || (state.rowSig.get(w.key) !== w.sig && !editing)) {
      const fresh = w.build();
      fresh.id = `r-${w.key}`;
      if (li) li.replaceWith(fresh); else els.list.append(fresh);
      li = fresh;
      state.rowSig.set(w.key, w.sig);
    }
    // 並び順をそろえる
    if (prev ? prev.nextElementSibling !== li : els.list.firstElementChild !== li) els.list.insertBefore(li, prev ? prev.nextElementSibling : els.list.firstChild);
    prev = li;
  }
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  e.append(...kids.filter((x) => x != null));
  return e;
}

function thumb(url, alt) {
  return el('div', {}, el('a', { class: 'thumb', href: url, target: '_blank', rel: 'noopener', 'aria-label': `${alt}の元の写真を開く` }, el('img', { src: url, alt })), el('div', { class: 'thumb-label' }, '写真を開く'));
}

function pendingRow(p) {
  const li = el('li', { class: 'row' }, thumb(p.url, '撮影した領収書'));
  if (!p.error) return li.appendChild(el('p', { class: 'status', role: 'status' }, '読み取り中…')).parentElement;
  li.append(el('div', {},
    el('p', { class: 'status fail' }, `送れませんでした：${p.error}`),
    el('button', { class: 'btn', type: 'button', onclick: () => { state.pending = state.pending.filter((x) => x !== p); register(p.file); } }, 'もう一度送る'),
    ' ',
    el('button', { class: 'btn ghost', type: 'button', onclick: () => { state.pending = state.pending.filter((x) => x !== p); render(); } }, '取り消す')));
  return li;
}

function receiptRow(r) {
  const url = state.api.imageUrl(r);
  const label = r.fields?.payee?.value || '領収書';
  const li = el('li', { class: 'row' + (needsReview(r) ? ' flag' : '') }, thumb(url, label));
  if (r.status === 'reading') { li.append(el('p', { class: 'status', role: 'status' }, '読み取り中…')); return li; }
  if (r.status === 'failed') { li.append(el('p', { class: 'status fail' }, '読み取れませんでした。写真を見て手で入力してください')); return li; }
  const box = el('div', { class: 'fields' });
  FIELD_KEYS.forEach((k) => box.append(fieldBox(r, k)));
  if (r.edited) box.append(el('p', { class: 'edited wide' }, '✓ 手で直しました'));
  li.append(box);
  return li;
}

function fieldBox(r, key) {
  const f = r.fields[key];
  const id = `f-${r.id}-${key}`;
  const msgId = `m-${r.id}-${key}`;
  const flagged = f.needs_review;
  const common = { id, 'aria-describedby': msgId };
  if (flagged) common['aria-invalid'] = 'true';
  const msg = el('p', { id: msgId, class: flagged ? 'flag-msg' : 'sr-only' }, flagged ? `⚠ ${flagText(key, f)}` : '');
  const save = async (input) => {
    const next = input.value;
    if (next === (f.value ?? '')) return;
    const bad = validateInput(key, next);
    if (bad) { msg.className = 'err-msg'; msg.textContent = bad; input.setAttribute('aria-invalid', 'true'); return; }
    try {
      await state.api.patch(r.id, { [key]: next.trim() });
      await refresh();
      say(`${FIELD_LABELS[key]}を直しました`);
    } catch (e) { msg.className = 'err-msg'; msg.textContent = `保存できませんでした：${e.message}`; }
  };
  let control;
  if (key === 'category') {
    control = el('select', { ...common, onchange: (e) => save(e.target) },
      el('option', { value: '' }, '選んでください'),
      ...CATEGORIES.map((c) => el('option', { value: c }, c)));
    control.value = f.value || '';
  } else {
    control = el('input', { ...common, type: 'text', value: f.value ?? '', onchange: (e) => save(e.target),
      inputmode: key === 'amount' ? 'numeric' : 'text', placeholder: key === 'date' ? '2026-03-05' : '', enterkeyhint: 'done' });
  }
  return el('div', { class: 'field' + (flagged ? ' flag' : '') + (key === 'payee' ? ' wide' : '') },
    el('label', { for: id }, FIELD_LABELS[key]), control, msg);
}

// ---- 起動：実 API を試し、つながらなければモック（バナー付き） ----
async function boot() {
  const q = new URLSearchParams(location.search);
  let api = q.get('mock') === '1' ? null : createApi(q.get('api') || '');
  try {
    if (!api) throw new Error('mock');
    const res = await api.list();
    state.receipts = res.receipts; state.count = res.needs_review_count;
  } catch {
    api = createMockApi();
    els.banner.hidden = false;
  }
  state.api = api;
  render();
  schedulePoll();
}
boot();
