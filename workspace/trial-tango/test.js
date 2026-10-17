import { decodeTest, makeResultCode } from './src/tango.js';
import { loadSeat, saveSeat, checkSeat } from './src/seat.js';
import { canChoose, makeChoices, grade, shuffle } from './src/quiz.js';

const $ = (id) => document.getElementById(id);
const NICK_KEY = 'trial-tango:nick:v1';
const WORDS_KEY = 'trial-tango:words:v1';
const show = (name) => ['loading', 'error', 'start', 'quiz', 'result'].forEach((n) => { $(n).hidden = n !== name; });
const li = (text) => Object.assign(document.createElement('li'), { textContent: text });

let test, order, mode, answers, i, seat;

async function init() {
  const r = await decodeTest(location.hash);
  if (!r.ok) { $('error-msg').textContent = r.reason; show('error'); return; }
  test = r;
  mode = canChoose(r.words) ? 'choice' : 'input';
  $('start-info').textContent = `${r.words.length}問 (${mode === 'choice' ? '4択' : '入力'})`;
  try { $('nick').value = localStorage.getItem(NICK_KEY) ?? ''; } catch { /* なくてよい */ }
  const s = loadSeat(localStorage);
  $('kumi').value = s.kumi; $('no').value = s.no;
  show('start');
  // 前回の組・番号が入っていれば、すぐ「はじめる」を押せるようにする
  (s.kumi && s.no ? $('begin') : $('kumi')).focus();
}

// 組・番号がないか範囲外なら、その欄の真下に理由を出してフォーカスを移す
function checkStart() {
  const r = checkSeat($('kumi').value, $('no').value);
  for (const f of ['kumi', 'no']) {
    $(`${f}-err`).textContent = r.errors[f] ?? '';
    $(f).setAttribute('aria-invalid', r.errors[f] ? 'true' : 'false');
  }
  if (!r.ok) { $(r.errors.kumi ? 'kumi' : 'no').focus(); return null; }
  $('kumi').value = r.kumi; $('no').value = String(r.no);
  return r;
}

function start() {
  const r = checkStart();
  if (!r) return;
  seat = { kumi: r.kumi, no: r.no };
  saveSeat(localStorage, seat);
  try { localStorage.setItem(NICK_KEY, $('nick').value); } catch { /* なくてよい */ }
  begin();
}

function begin() {
  order = shuffle(test.words); answers = []; i = 0;
  show('quiz'); ask();
}

function ask() {
  const w = order[i];
  $('qpos').textContent = `${i + 1} / ${order.length}`;
  $('qcard').replaceChildren(Object.assign(document.createElement('div'), { className: 'en', textContent: w.en }));
  $('choices').hidden = mode !== 'choice'; $('typing').hidden = mode !== 'input';
  if (mode === 'choice') {
    $('choices').replaceChildren(...makeChoices(order, i).map((c) =>
      Object.assign(document.createElement('button'), { className: 'btn', textContent: c, onclick: () => next(c) })));
  } else { $('answer').value = ''; $('answer').focus(); }
}

function next(a) {
  answers.push(a); i++;
  if (i < order.length) ask(); else finish();
}

function finish() {
  const r = grade(order, answers, mode === 'choice' ? 'choice' : 'input');
  $('score').textContent = `${r.total}問中 ${r.score}問 正解`;
  $('wrong-box').hidden = r.wrong.length === 0;
  $('wrong').replaceChildren(...r.wrong.map((x) => li(`${x.en} = ${x.ja}${x.answer ? ` (あなた: ${x.answer})` : ''}`)));
  $('code').value = makeResultCode({ id: test.id, ...seat, score: r.score, total: r.total, nick: $('nick').value });
  // フォームの URL が入ったテストでは「コピーしてフォームを開く」だけ、ないテストでは「コピー」だけ
  $('form-link').hidden = !test.form; $('copy').hidden = !!test.form;
  if (test.form) $('form-link').href = test.form;
  $('code-help').textContent = test.form
    ? '下のボタンで結果コードをコピーしてフォームを開き、貼って送ると提出になります。'
    : 'この結果コードを先生に送ると提出になります。';
  $('cmsg').textContent = ''; show('result');
}

$('seat').onsubmit = (e) => { e.preventDefault(); start(); };
// 日本語入力の変換確定の Enter では始めない
$('nick').onkeydown = (e) => { if (e.key === 'Enter' && e.isComposing) e.preventDefault(); };
$('typing').onsubmit = (e) => { e.preventDefault(); next($('answer').value); };
// コピーに失敗したら、コードを全選択して手でコピーしてもらう
async function copyCode(ok) {
  try { await navigator.clipboard.writeText($('code').value); $('cmsg').textContent = ok; }
  catch { $('code').focus(); $('code').setSelectionRange(0, $('code').value.length); $('cmsg').textContent = '長押しでコピーしてください'; }
}
$('copy').onclick = () => copyCode('コピーしました。先生に送ってください。');
// リンクのまま開く (タップの中で開くので、iPhone や LINE でも止められにくい)。同じタップでコピーも走らせる
$('form-link').onclick = () => { copyCode('コピーしました。フォームの欄に貼って送ってください。'); };
$('retry').onclick = begin;
// 単語だけを学習画面に渡す。進捗 (progress.js) には触れない。
$('study').onclick = () => {
  try { localStorage.setItem(WORDS_KEY, JSON.stringify(test.words)); } catch { /* なくてよい */ }
  location.href = 'index.html';
};

init();
