import { parseWordList } from './src/tango.js';
import { loadProgress, saveProgress, markKnown, countKnown, exportCode, importCode } from './src/progress.js';

const $ = (id) => document.getElementById(id);
const WORDS_KEY = 'trial-tango:words:v1';
let words = [];
let progress = loadProgress(localStorage);
let flipped = false;
let editing = false;

function readWords() {
  try { return JSON.parse(localStorage.getItem(WORDS_KEY)) || []; } catch { return []; }
}
function remaining() { return words.filter((w) => !progress.known[w.key]); }
function current() { const r = remaining(); return r.length ? r[progress.pos % r.length] : null; }

function render() {
  $('count').textContent = `覚えた単語: ${countKnown(progress)}`;
  const empty = words.length === 0 || editing;
  $('empty').hidden = !empty; $('card').hidden = empty; $('actions').hidden = empty;
  $('cancel').hidden = words.length === 0; $('change').hidden = empty;
  // 初めての人にはリンクからの入り方を主に出す。入れ替えのときは貼り付け欄を開いておく。
  $('welcome').hidden = editing;
  if (empty) { $('pos').textContent = ''; return; }
  const w = current();
  if (!w) {
    $('card').innerHTML = '<p class="en">ぜんぶ覚えました 🎉</p><p>下の「単語リストを入れ替える」から、新しい単語で続けられます。</p>';
    $('actions').hidden = true; $('pos').textContent = ''; return;
  }
  $('pos').textContent = `残り ${remaining().length}`;
  $('card').replaceChildren();
  const en = Object.assign(document.createElement('div'), { className: 'en', textContent: w.en });
  $('card').append(en);
  if (flipped) $('card').append(Object.assign(document.createElement('div'), { className: 'ja', textContent: w.ja }));
  $('flip').textContent = flipped ? 'もう一度見る' : 'めくる';
}
function persist() { saveProgress(localStorage, progress); render(); }

function flip() { flipped = !flipped; render(); }
function answer(known) {
  const w = current(); if (!w) return;
  progress = known ? markKnown(progress, w.key) : { ...progress, pos: progress.pos + 1 };
  flipped = false; persist();
}

$('flip').onclick = flip;
$('known').onclick = () => answer(true);
$('again').onclick = () => answer(false);
document.addEventListener('keydown', (e) => {
  if (/TEXTAREA|INPUT/.test(e.target.tagName)) return;
  if (e.key === ' ' || e.key === 'Enter') { if (e.target.tagName !== 'BUTTON') { e.preventDefault(); flip(); } }
  else if (e.key === 'ArrowRight') answer(true);
  else if (e.key === 'ArrowLeft') answer(false);
});

$('load').onclick = () => {
  const r = parseWordList($('paste').value);
  const notes = r.errors.map((x) => `${x.line}行目: ${x.reason}`);
  if (r.truncated) notes.push('31行目以降は使っていません');
  if (!r.words.length) { $('msg').textContent = notes.join(' / ') || '単語が見つかりません。'; return; }
  words = r.words; localStorage.setItem(WORDS_KEY, JSON.stringify(words));
  progress = { ...progress, pos: 0 }; flipped = false; editing = false; $('msg').textContent = ''; persist();
};
$('change').onclick = () => { editing = true; $('paste-box').open = true; render(); $('paste').focus(); };
$('cancel').onclick = () => { editing = false; $('paste-box').open = false; $('msg').textContent = ''; render(); $('change').focus(); };

$('copy').onclick = async () => {
  const code = exportCode(progress);
  try { await navigator.clipboard.writeText(code); $('bmsg').textContent = 'コピーしました。メモ帳などに貼っておくと、あとで戻せます。'; }
  catch { $('restore').value = code; $('restore').select(); $('bmsg').textContent = '下の欄に出しました。長押しでコピーしてください。'; }
};
$('apply').onclick = () => {
  const r = importCode(progress, $('restore').value);
  if (!r.ok) { $('bmsg').textContent = r.reason; return; }
  progress = r.progress; $('bmsg').textContent = `${r.added} 語を戻しました。`; persist();
};

words = readWords();
render();
