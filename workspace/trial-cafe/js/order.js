// #/order 発注画面(彩さん向け)。発注量は人が入れる。画面は提案しない。
import { groupBySupplier, stockLine, lastOrderText, warnText, orderEntries, lineMessage, phoneList } from './format.js';

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

export function renderOrder(root, store, now = () => new Date()) {
  const quantities = new Map(); // itemId -> 入力文字
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const setStatus = (text, kind) => { status.textContent = text; status.className = `status ${kind || ''}`; };

  function supplierSection({ supplier, items }) {
    const out = h('div', { class: 'copy-out' });
    // 押し忘れ防止。コピーした後に出し、「発注した」が成功するまで消さない。
    const reminder = h('p', { class: 'reminder', role: 'status', hidden: true }, '送ったら『発注した』を押してください');
    const section = h('section', { class: 'supplier' });
    const rows = h('ul', {});
    const entriesNow = () => orderEntries(items, quantities);

    function drawRow(item) {
      const recent = store.recentOrder(item.id, 2);
      const warn = h('p', { class: 'warn', role: 'status' }, warnText(item, recent, now()));
      warn.hidden = !recent;
      const input = h('input', {
        type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off',
        'aria-label': `${item.name}の発注量(${item.unit})`,
      });
      input.value = quantities.get(item.id) ?? '';
      input.addEventListener('input', () => { quantities.set(item.id, input.value); out.replaceChildren(); });
      return h('li', { class: 'item order-item' },
        h('div', { class: 'item-head' }, h('span', { class: 'item-name' }, item.name),
          h('label', { class: 'qty' }, input, h('span', {}, item.unit))),
        h('span', { class: 'prev' }, stockLine(item, store.latestStock(item.id), now())),
        h('span', { class: 'prev' }, lastOrderText(item, store.lastOrder(item.id), now())),
        warn);
    }
    const drawRows = () => rows.replaceChildren(...items.map(drawRow));

    function showText(text) {
      const area = h('textarea', { readonly: true, rows: Math.min(12, text.split('\n').length + 1), 'aria-label': `${supplier.name}の文面` }, text);
      out.replaceChildren(area);
      area.focus(); area.select(); area.setSelectionRange(0, text.length);
    }

    async function copy() {
      const entries = entriesNow();
      if (entries.length === 0) { setStatus('発注量が入っている品目がありません', 'error'); return; }
      reminder.hidden = false;
      if (supplier.channel === 'phone') {
        out.replaceChildren(h('p', {}, '電話で読み上げる内容'), h('ol', { class: 'read-list' }, phoneList(entries).map((l) => h('li', {}, l))));
        setStatus('', ''); return;
      }
      const text = lineMessage(supplier, entries);
      try {
        await navigator.clipboard.writeText(text);
        out.replaceChildren(h('pre', { class: 'preview' }, text));
        setStatus(`${supplier.name}の文面をコピーしました`, 'ok');
      } catch {
        showText(text);
        setStatus('コピーできませんでした。下の文面を長押ししてコピーしてください', 'error');
      }
    }

    function order(btn) {
      const entries = entriesNow();
      if (entries.length === 0) { setStatus('発注量が入っている品目がありません', 'error'); return; }
      btn.disabled = true;
      try {
        store.recordOrders({ entries: entries.map((e) => ({ itemId: e.item.id, quantity: e.quantity })), supplierId: supplier.id });
      } catch (err) {
        console.error(err);
        setStatus('記録できませんでした', 'error');
        btn.disabled = false;
        return;
      }
      items.forEach((i) => quantities.delete(i.id));
      out.replaceChildren();
      reminder.hidden = true;
      drawRows();
      setStatus(`${supplier.name}に発注しました`, 'ok');
      btn.disabled = false;
    }

    const orderBtn = h('button', { type: 'button', class: 'primary inline', onclick: () => order(orderBtn) }, '発注した');
    drawRows();
    section.append(
      h('h2', {}, supplier.name, h('small', {}, supplier.channel === 'line' ? ' LINE' : ' 電話')),
      rows,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'secondary', onclick: copy }, supplier.channel === 'line' ? '文面をコピー' : '読み上げ用の一覧を出す'),
        orderBtn),
      reminder,
      out);
    return section;
  }

  root.replaceChildren(
    h('h1', {}, '発注'),
    h('p', { class: 'note' }, '量はここで決めて入れてください。空の品目は頼みません。'),
    status,
    ...groupBySupplier(store.listSuppliers(), store.listItems()).map(supplierSection));
}
