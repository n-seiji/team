import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meanings, isCorrectInput, canChoose, makeChoices, grade, shuffle } from '../src/quiz.js';
import { makeResultCode, parseResultCode, testId } from '../src/tango.js';

const W = [
  { en: 'run', ja: '走る、運営する' }, { en: 'cat', ja: '猫' },
  { en: 'dog', ja: '犬' }, { en: 'bird', ja: '鳥' }, { en: 'fish', ja: '魚' },
];

test('複数の意味はどれか1つで正解、全文でも正解', () => {
  assert.deepEqual(meanings('走る、運営する'), ['走る', '運営する']);
  assert.ok(isCorrectInput(W[0], '運営する'));
  assert.ok(isCorrectInput(W[0], ' 走る '));
  assert.ok(isCorrectInput(W[0], '走る、運営する'));
  assert.ok(!isCorrectInput(W[0], '歩く'));
  assert.ok(!isCorrectInput(W[0], ''));
});
test('英字は大文字小文字・全角半角を許す', () => {
  assert.ok(isCorrectInput({ en: 'x', ja: 'Apple' }, 'ＡＰＰＬＥ'));
});
test('4択は正解を含み、重複せず4つ', () => {
  for (let i = 0; i < W.length; i++) {
    const c = makeChoices(W, i);
    assert.equal(c.length, 4);
    assert.equal(new Set(c).size, 4);
    assert.ok(c.includes(W[i].ja));
  }
});
test('日本語がちがう単語が4つ未満なら4択にしない', () => {
  assert.ok(canChoose(W));
  assert.ok(!canChoose(W.slice(0, 3)));
  assert.ok(!canChoose([...W.slice(0, 3), { en: 'kitty', ja: '猫' }]));
});
test('採点: 点数と間違えた単語', () => {
  const r = grade(W, ['走る', '猫', '鳥', '鳥', ''], 'input');
  assert.equal(r.score, 3);
  assert.deepEqual(r.wrong.map((x) => x.en), ['dog', 'fish']);
  assert.equal(grade(W, W.map((w) => w.ja), 'choice').score, 5);
});
test('shuffle は元を壊さない', () => {
  const a = [1, 2, 3]; shuffle(a); assert.deepEqual(a, [1, 2, 3]);
});
test('採点結果から結果コードが作れて読める', () => {
  const r = grade(W, ['走る', '', '', '', ''], 'input');
  const code = makeResultCode({ id: testId(W), kumi: '2B', no: 14, score: r.score, total: r.total, nick: 'ひなた' });
  assert.equal(parseResultCode(code).ok, true);
});
