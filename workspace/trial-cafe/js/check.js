// #/check 在庫チェック画面(蓮さん向け)
import { LEVELS, prevText, countUnfilled, stepCount, groupBySupplier, parseCount, latestRecord, shortDateTime, orderedAfterText } from './format.js';

const NAME_KEY = 'cafe.recorder';

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) el.append(c);
  return el;
}

function loadName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* 覚えられなくても記録は続ける */ }
}

export function renderCheck(root, store, now = () => new Date()) {
  const suppliers = store.listSuppliers();
  const items = store.listItems();
  const values = new Map(); // itemId -> 入力値。キーがなければ未入力。
  const rowUpdaters = [];

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const unfilledEl = h('span', { class: 'unfilled-count' });
  const nameInput = h('input', {
    id: 'recorder', type: 'text', autocomplete: 'off', value: loadName(),
    placeholder: '例: 蓮', 'aria-describedby': 'recorder-hint',
  });
  nameInput.addEventListener('change', () => saveName(nameInput.value.trim()));
  // 直したら古い案内は消す。残っていると「まだダメなのか」と迷う。
  const clearError = () => { if (status.classList.contains('error')) { status.textContent = ''; status.className = 'status'; } };
  nameInput.addEventListener('input', clearError);

  // 上部: 直近の記録のあと、彩さんが発注したか。蓮さんが LINE で確かめなくて済むように。
  const afterEl = h('p', { class: 'after-order', role: 'status' });
  function refreshAfter() {
    const rec = latestRecord(items, store.latestStock);
    afterEl.replaceChildren();
    afterEl.hidden = !rec;
    if (!rec) return;
    const ordered = store.orderedAfter(rec.at);
    afterEl.classList.toggle('done', !!ordered);
    afterEl.append(h('small', {}, `直近の記録: ${shortDateTime(rec.at)}・${rec.recorder}`), orderedAfterText(ordered));
  }

  function refreshCount() {
    clearError();
    const n = countUnfilled(items, values);
    unfilledEl.textContent = n === 0 ? '全部入力済み' : `未入力 ${n}件`;
    unfilledEl.classList.toggle('all-done', n === 0);
  }

  function itemRow(item) {
    const prev = h('span', { class: 'prev' });
    const badge = h('span', { class: 'badge' }, '未入力');
    const controls = h('div', { class: 'controls' });
    const row = h('li', { class: 'item' },
      h('div', { class: 'item-head' }, h('span', { class: 'item-name' }, item.name), badge),
      prev, controls);

    // 数える品目: 数字をタップすると数字キーボードで直接入れられる。+/- も使える。
    // 入力中に作り直すとキーボードが閉じるので、欄は一度だけ作って値だけ差し替える。
    let countInput = null;
    let levelGroup = null;
    if (item.kind === 'count') {
      const set = (d) => { values.set(item.id, stepCount(values.get(item.id), d)); draw(); refreshCount(); };
      countInput = h('input', {
        type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', class: 'count-input',
        'aria-label': `${item.name}の数(${item.unit})`, placeholder: '—',
      });
      countInput.addEventListener('input', () => {
        const n = parseCount(countInput.value);
        if (n === null) { countInput.value = values.has(item.id) ? String(values.get(item.id)) : ''; return; } // 数字以外は受け付けない
        if (n === undefined) values.delete(item.id); else values.set(item.id, n);
        draw({ keepInput: true });
        refreshCount();
      });
      countInput.addEventListener('focus', () => countInput.select());
      controls.append(
        h('button', { type: 'button', class: 'step', 'aria-label': `${item.name}を1減らす`, onclick: () => set(-1) }, '−'),
        h('label', { class: 'count' }, countInput, h('small', {}, item.unit)),
        h('button', { type: 'button', class: 'step', 'aria-label': `${item.name}を1増やす`, onclick: () => set(1) }, '+'),
      );
    } else {
      levelGroup = h('div', { class: 'levels', role: 'group', 'aria-label': `${item.name}の量` });
      for (const l of LEVELS) {
        levelGroup.append(h('button', {
          type: 'button', class: 'level', 'data-value': l.value,
          onclick: () => { values.set(item.id, l.value); draw(); refreshCount(); },
        }, l.label));
      }
      controls.append(levelGroup);
    }

    function draw({ keepInput = false } = {}) {
      const v = values.get(item.id);
      row.classList.toggle('empty', v === undefined);
      badge.hidden = v !== undefined;
      prev.textContent = prevText(item, store.latestStock(item.id), now());
      if (countInput && !keepInput) countInput.value = v === undefined ? '' : String(v);
      if (levelGroup) for (const b of levelGroup.children) b.setAttribute('aria-pressed', String(v === b.dataset.value));
    }
    draw();
    rowUpdaters.push(draw);
    return row;
  }

  async function submit(btn) {
    const recorder = nameInput.value.trim();
    status.className = 'status';
    if (!recorder) {
      status.textContent = '上の「記録する人」に名前を入れてください';
      status.classList.add('error');
      nameInput.focus();
      return;
    }
    const entries = items.filter((i) => values.has(i.id)).map((i) => ({ itemId: i.id, value: values.get(i.id) }));
    if (entries.length === 0) {
      status.textContent = 'まだ何も入力されていません';
      status.classList.add('error');
      return;
    }
    btn.disabled = true;
    try {
      store.recordStocks({ entries, recorder });
    } catch (err) {
      console.error(err);
      status.textContent = '記録できませんでした';
      status.classList.add('error');
      btn.disabled = false;
      return; // 入力は残す。もう一度押せる。
    }
    saveName(recorder);
    values.clear();
    rowUpdaters.forEach((d) => d());
    refreshCount();
    refreshAfter();
    status.textContent = '記録しました';
    status.classList.add('ok');
    btn.disabled = false;
  }

  const submitBtn = h('button', { type: 'button', class: 'primary', onclick: () => submit(submitBtn) }, '記録する');

  root.replaceChildren(
    h('h1', {}, '在庫チェック'),
    afterEl,
    h('div', { class: 'recorder' },
      h('label', { for: 'recorder' }, '記録する人'),
      nameInput,
      h('small', { id: 'recorder-hint' }, '次回も覚えています')),
    ...groupBySupplier(suppliers, items).map(({ supplier, items: its }) =>
      h('section', { class: 'supplier' },
        h('h2', {}, supplier.name, h('small', {}, supplier.channel === 'line' ? ' LINE' : ' 電話')),
        h('ul', {}, its.map(itemRow)))),
    h('div', { class: 'bar' }, unfilledEl, status, submitBtn),
  );
  refreshCount();
  refreshAfter();
}
