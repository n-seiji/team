// テストの出題と採点。画面から分けてあり、進捗 (progress.js) は呼ばない。
// → 何度やり直しても、学習画面の「覚えた」は減らない。

export const meanings = (ja) => String(ja).split('、').map((s) => s.trim()).filter(Boolean);

const norm = (s) => String(s).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');

// 入力式: 書かれた意味のどれか1つ、または全文に合えば正解
export function isCorrectInput(word, input) {
  const a = norm(input);
  if (a === '') return false;
  return [word.ja, ...meanings(word.ja)].some((m) => norm(m) === a);
}

// 4択にできるのは、日本語がちがう単語が4つ以上あるとき
export const canChoose = (words) => new Set(words.map((w) => w.ja)).size >= 4;

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 選択肢は全文 (word.ja) をそのまま使う。正解1つ + まちがい3つ。
export function makeChoices(words, index, rng = Math.random) {
  const right = words[index].ja;
  const others = [...new Set(words.filter((_, i) => i !== index).map((w) => w.ja))].filter((j) => j !== right);
  return shuffle([right, ...shuffle(others, rng).slice(0, 3)], rng);
}

// answers[i] は選んだ文字列か入力した文字列。mode は 'choice' | 'input'
export function grade(words, answers, mode) {
  const wrong = [];
  words.forEach((w, i) => {
    const a = answers[i] ?? '';
    const ok = mode === 'choice' ? a === w.ja : isCorrectInput(w, a);
    if (!ok) wrong.push({ en: w.en, ja: w.ja, answer: a });
  });
  return { score: words.length - wrong.length, total: words.length, wrong };
}
