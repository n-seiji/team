import { buildTestLink, aggregateResults, toCsv } from './src/teacher.js';

const $ = (id) => document.getElementById(id);
const KEY = { list: 'trial-tango:teacher:list:v1', form: 'trial-tango:teacher:form:v1', codes: 'trial-tango:teacher:codes:v1' };
const TEST_PAGE = new URL('test.html', location.href).href; // 生徒がテストを開くページ

const load = (k) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } };
const li = (text) => Object.assign(document.createElement('li'), { textContent: text });

async function copy(text, input) {
  try { await navigator.clipboard.writeText(text); return true; } catch { input.select(); return false; }
}

// ---- 1. リンク作成 ----
$('make').onclick = async () => {
  save(KEY.list, $('list').value); save(KEY.form, $('form-url').value);
  const r = await buildTestLink($('list').value, TEST_PAGE, $('form-url').value);
  $('make-errors').replaceChildren(...r.errors.map((e) => li(`${e.line}行目: ${e.reason}`)));
  if (r.truncated) $('make-errors').append(li('31行目以降は使っていません (30問まで)'));
  $('make-out').hidden = !r.ok;
  if (!r.ok) { $('make-msg').textContent = r.reason; return; }
  $('link').value = r.url; $('make-id').textContent = r.id;
  $('make-msg').textContent = `${r.words.length}問のリンクができました。` +
    (r.errors.length ? `無効な ${r.errors.length} 行は除いてあります。` : '') +
    (r.form ? '結果画面からフォームを開けます。' : '');
};
$('copy-link').onclick = async () => {
  $('make-msg').textContent = (await copy($('link').value, $('link'))) ? 'コピーしました。' : 'コピーできませんでした。選択した文字をコピーしてください。';
};

// ---- 2. 集計 ----
let last = null;
function renderAgg() {
  save(KEY.codes, $('codes').value);
  const text = $('codes').value;
  const picked = $('id-pick').value || undefined;
  const r = aggregateResults(text, r_has(picked, text) ? picked : undefined);
  last = r;
  const hasRows = r.rows.length > 0;
  $('agg-table').hidden = !hasRows; $('csv').hidden = !hasRows; $('clear').hidden = text === '';
  $('id-label').hidden = r.ids.length < 2;
  $('agg-table').classList.toggle('no-time', !r.hasTime); // コードだけ貼ったときは提出時刻の列を隠す
  $('id-pick').replaceChildren(...r.ids.map((id) => Object.assign(new Option(id, id), { selected: id === r.id })));
  const td = (textContent, className = '') => Object.assign(document.createElement('td'), { textContent, className });
  $('agg-table').tBodies[0].replaceChildren(...r.rows.map((x) => {
    const tr = Object.assign(document.createElement('tr'), { className: x.dup ? 'dup' : '' });
    tr.append(td(x.kumi), td(x.no, 'num'), td(x.nick), td(`${x.score} / ${x.total}`, 'num'), td(x.dup ? '2回以上' : ''), td(x.at, 'at'));
    return tr;
  }));
  $('agg-summary').textContent = hasRows
    ? `${r.rows.length}件 / 平均 ${r.average.toFixed(1)} 点 (${r.total}点満点)` +
      (r.rows.some((x) => x.dup) ? ' / 同じ組・番号が2回以上の行に印を付けています' : '')
    : (text.trim() ? '集計できるコードがありません。' : '');
  $('agg-skipped').replaceChildren(...r.skipped.map((s) => li(`${s.line}行目: ${s.reason}`)));
}
const r_has = (id, text) => id !== undefined && aggregateResults(text).ids.includes(id);

$('codes').oninput = renderAgg;
$('id-pick').onchange = renderAgg;
$('clear').onclick = () => { $('codes').value = ''; renderAgg(); };
$('csv').onclick = () => {
  const blob = new Blob([toCsv(last.rows)], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `result-${last.id}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
};

$('list').value = load(KEY.list);
$('form-url').value = load(KEY.form);
$('codes').value = load(KEY.codes);
renderAgg();

// オフライン用: 一度開けば、次からは通信なしで開ける
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
