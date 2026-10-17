import { createApi } from './api.js';
import { createMockApi } from './mock-api.js';
import {
  FIELD_KEYS, FIELD_LABELS, CATEGORIES, maxSideFrom,
  fitSize, needsReview, visibleReceipts, flagText, countText, validateInput,
  fieldsFor, orderForScreen, monthOptions, monthLabel, totalText, isPending, statusText, printSheet, noAmountCount, noAmountText,
  searchReceipts, searchText, isUndated,
} from './logic.js';

const $ = (s) => document.querySelector(s);
const els = { list: $('#list'), empty: $('#empty'), bar: $('#bar'), count: $('#count'), filter: $('#filter'),
  camera: $('#camera'), toast: $('#toast'), noMatch: $('#no-match'), banner: $('#demo-banner'),
  monthbar: $('#monthbar'), month: $('#month'), total: $('#total'), undated: $('#undated'), csv: $('#csv'), csvOff: $('#csv-off'), print: $('#print'), printout: $('#printout'),
  searchbar: $('#searchbar'), search: $('#search'), searchMsg: $('#search-msg'), showUndated: $('#show-undated') };

const state = { api: null, receipts: [], all: [], search: '', showUndated: false, count: 0, table: null, months: [], month: '', onlyReview: false, pending: [], rowSig: new Map() };
let shotNo = 0;
const maxSide = maxSideFrom(new URLSearchParams(location.search).get('maxside'));

// ---- 縮小（長辺 maxSide px。既定 2000）。失敗したら元画像をそのまま送る ----
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height, scaled } = fitSize(bmp.width, bmp.height, maxSide);
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
    state.reading = true;
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
// ---- 探す（T9）。打つたびに全件から絞る。Esc で消して一覧に戻る ----
els.search.addEventListener('input', () => { state.search = els.search.value; state.showUndated = false; render(); });
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { els.search.value = ''; state.search = ''; state.showUndated = false; render(); }
  if (e.key === 'Enter') els.search.blur(); // スマホのキーボードを閉じて結果を見せる
});
els.showUndated.addEventListener('click', () => { state.showUndated = !state.showUndated; render(); });
els.month.addEventListener('change', async () => {
  state.month = els.month.value;
  try { await refresh(); } catch (e) { say(`読み込めませんでした：${e.message}`); }
});

// ---- 印刷（月の表を紙用の5列で組み、ブラウザの印刷を開く。Ctrl+P でも同じ表になる） ----
function buildPrintout() {
  if (!state.table) return;
  const s = printSheet({ month: state.month, ...state.table });
  const numCol = s.head.indexOf('金額');
  const cell = (tag, text, i) => el(tag, i === numCol ? { class: 'num' } : i === 0 ? { class: 'date' } : {}, text);
  els.printout.replaceChildren(
    el('h1', {}, s.title),
    el('table', {},
      el('thead', {}, el('tr', {}, ...s.head.map((h, i) => cell('th', h, i)))),
      el('tbody', {}, ...s.rows.map((r) => el('tr', {}, ...r.map((v, i) => cell('td', v, i))))),
      el('tfoot', {}, el('tr', {}, el('td', { colspan: String(numCol) }, ''), el('td', { class: 'num' }, s.total), el('td', { colspan: String(s.head.length - numCol - 1) }, '')))),
    s.no_amount ? el('p', { class: 'p-note' }, `⚠ ${s.no_amount}`) : null,
    s.note ? el('p', { class: 'p-note' }, `⚠ ${s.note}`) : null);
}
els.print.addEventListener('click', () => { buildPrintout(); window.print(); });
window.addEventListener('beforeprint', buildPrintout);

// 入力中の行は描画を後回しにしているので、行からフォーカスが出たら描き直す
els.list.addEventListener('focusout', (e) => {
  const row = e.target.closest('li');
  setTimeout(() => { if (row && !row.contains(document.activeElement)) render(); }, 0);
});

function say(text) { els.toast.textContent = ''; setTimeout(() => (els.toast.textContent = text), 50); }

// ---- 取得と定期更新（読み取り待ちがある間だけ） ----
// 月の選択肢は全件から作るので、月で絞っているときは全件も取る。
async function refresh() {
  const [res, all] = await Promise.all([state.api.list(state.month), state.month ? state.api.list() : null]);
  apply(res, all || res);
  render();
}
function apply(res, all) {
  state.receipts = orderForScreen(res.receipts);
  state.count = res.needs_review_count; // 月に関係なく全体
  state.table = res;
  state.all = orderForScreen(all.receipts);
  state.months = monthOptions(all.receipts);
  state.waiting = all.receipts.filter(isPending).length;
  state.reading = state.waiting > 0;
}
let timer;
function schedulePoll() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    // 月で絞っていると読み取り中の行（日付なし）は見えないので、全件側で待ちがあるかを見る
    try { if (state.reading) await refresh(); } catch {}
    schedulePoll();
  }, 1500);
}

// ---- 描画 ----
function render() {
  const total = state.receipts.length + state.pending.length;
  els.count.textContent = countText(state.count, state.waiting);
  els.count.classList.toggle('has', state.count > 0);
  els.filter.hidden = total === 0;
  els.empty.hidden = total !== 0;
  els.bar.hidden = total === 0;

  const found = renderSearch(total);
  renderMonthbar(total, !!found);
  const rows = found ? found.rows : visibleReceipts(state.receipts, state.onlyReview);
  els.noMatch.hidden = !!found || !(state.onlyReview && total > 0 && rows.length === 0 && state.pending.length === 0);

  const want = [
    ...(state.onlyReview || found ? [] : state.pending).map((p) => ({ key: p.key, sig: JSON.stringify([p.error]), build: () => pendingRow(p) })),
    ...rows.map((r) => ({ key: r.id, sig: JSON.stringify([r.status, r.queue_position, r.fields, r.edited]), build: () => receiptRow(r) })),
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

// 探しているときは月・「要確認だけ」に関係なく全件から。見つからなければ日付のない行へ案内する。
function renderSearch(total) {
  els.searchbar.hidden = total === 0;
  const res = searchReceipts(state.all, state.search);
  const typed = state.search.trim() !== '';
  els.filter.hidden ||= typed;
  if (!res.query) {
    els.searchMsg.className = 'search-msg';
    els.searchMsg.textContent = typed ? '金額（例: 5000）か日付（例: 10/3）を入れてください' : '';
    els.showUndated.hidden = true;
    return null;
  }
  const miss = res.rows.length === 0;
  els.searchMsg.className = 'search-msg' + (miss ? ' miss' : '');
  els.searchMsg.textContent = searchText(res);
  els.showUndated.hidden = !(miss && res.undated);
  els.showUndated.setAttribute('aria-pressed', String(state.showUndated));
  els.showUndated.textContent = state.showUndated ? '日付のない領収書を閉じる' : `日付のない領収書を見る（${res.undated}枚）`;
  if (miss && state.showUndated) return { rows: state.all.filter(isUndated) };
  return res;
}

function renderMonthbar(total, searching) {
  const t = state.table;
  els.monthbar.hidden = total === 0 || !t || searching;
  if (els.monthbar.hidden) return;
  const want = ['', ...state.months];
  if (state.month && !want.includes(state.month)) want.push(state.month);
  if ([...els.month.options].map((o) => o.value).join() !== want.join()) {
    els.month.replaceChildren(...want.map((m) => el('option', { value: m }, m ? monthLabel(m) : 'すべて')));
    els.month.value = state.month;
  }
  const noAmount = noAmountText(noAmountCount(t.receipts));
  els.total.textContent = totalText({ month: state.month, total: t.total ?? 0, total_note: t.total_note ?? '' }) + (noAmount ? ` ／ ${noAmount}` : '');
  els.total.classList.toggle('has', !!t.total_note || !!noAmount);
  const undated = state.month ? t.undated_count ?? 0 : 0;
  els.undated.hidden = undated === 0;
  els.undated.textContent = `日付が入っていない領収書が${undated}枚あり、この月の表に入っていません。「すべて」で直せます`;
  const url = state.api.csvUrl?.(state.month);
  els.csv.hidden = !url;
  els.csvOff.hidden = !!url;
  if (url) els.csv.href = url;
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
  if (!p.error) return li.appendChild(el('p', { class: 'status', role: 'status' }, '送っています…')).parentElement;
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
  const fields = fieldsFor(r);
  const box = el('div', { class: 'fields' });
  // 待っている間も手で入れ始められる（直した欄は読み取り結果で上書きされない）
  if (isPending(r)) box.append(el('p', { class: 'status wide', role: 'status' }, statusText(r)));
  if (r.status === 'failed' && needsReview(r)) box.append(el('p', { class: 'status fail wide' }, '読み取れませんでした。写真を見て入力してください'));
  FIELD_KEYS.forEach((k) => box.append(fieldBox(r, fields, k)));
  if (r.edited) box.append(el('p', { class: 'edited wide' }, '✓ 手で直しました'));
  li.append(box);
  return li;
}

function fieldBox(r, fields, key) {
  const f = fields[key];
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
      // Tab で隣の欄へ移ると行ごとの描き直しは保留になるので、直した欄の要確認はここで消す
      f.value = next.trim();
      msg.className = 'sr-only'; msg.textContent = '';
      input.removeAttribute('aria-invalid');
      input.closest('.field')?.classList.remove('flag');
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
      inputmode: key === 'amount' ? 'numeric' : 'text', placeholder: key === 'date' ? '例: 2026-03-05' : '', enterkeyhint: 'done' });
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
    apply(res, res);
  } catch {
    api = createMockApi();
    els.banner.hidden = false;
  }
  state.api = api;
  if (api.kind === 'mock') { const res = await api.list(); apply(res, res); }
  render();
  schedulePoll();
}
boot();
