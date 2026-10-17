import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWordList, encodeTest, decodeTest, testId,
  makeResultCode, parseResultCode, checkKumi, checkNo, checkFormUrl, MAX_WORDS,
} from '../src/tango.js';

test('parseWordList: 正常な行と空行', () => {
  const r = parseWordList('apple,りんご\n\n  Run , 走る、運営する \r\n');
  assert.deepEqual(r.errors, []);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.words, [
    { en: 'apple', ja: 'りんご', key: 'apple' },
    { en: 'Run', ja: '走る、運営する', key: 'run' },
  ]);
});

test('parseWordList: 不正な行は行番号つきで errors、他は残る', () => {
  const r = parseWordList('apple,りんご\nnocomma\n,空\nbanana,\ncat,ねこ');
  assert.deepEqual(r.words.map((w) => w.en), ['apple', 'cat']);
  assert.deepEqual(r.errors, [
    { line: 2, reason: 'カンマがありません' },
    { line: 3, reason: '英語が空です' },
    { line: 4, reason: '日本語が空です' },
  ]);
});

test('parseWordList: 全角カンマも使え、最初のカンマで分ける', () => {
  const r = parseWordList('dog，いぬ\nhello,こんにちは,やあ');
  assert.equal(r.words[0].ja, 'いぬ');
  assert.equal(r.words[1].ja, 'こんにちは,やあ');
});

test('parseWordList: 同じ英語は2回目以降を errors にする', () => {
  const r = parseWordList('Apple,りんご\napple,林檎');
  assert.equal(r.words.length, 1);
  assert.equal(r.errors[0].line, 2);
  assert.match(r.errors[0].reason, /重複/);
});

test('parseWordList: 31問目以降は使わず truncated', () => {
  const text = Array.from({ length: 35 }, (_, i) => `w${i},い${i}`).join('\n');
  const r = parseWordList(text);
  assert.equal(r.words.length, MAX_WORDS);
  assert.equal(r.truncated, true);
  assert.equal(parseWordList(text.split('\n').slice(0, 30).join('\n')).truncated, false);
});

test('parseWordList: 空の入力', () => {
  assert.deepEqual(parseWordList(''), { words: [], errors: [], truncated: false });
});

const thirty = () =>
  parseWordList(
    Array.from({ length: 30 }, (_, i) => `vocabulary${i},語彙という意味${i}、別の意味`).join('\n'),
  ).words;

test('encodeTest/decodeTest: 往復して元に戻る', async () => {
  const words = parseWordList('apple,りんご\nrun,走る、運営する').words;
  const s = await encodeTest(words);
  assert.match(s, /^[A-Za-z0-9_.-]+$/);
  const r = await decodeTest('#' + s);
  assert.equal(r.ok, true);
  assert.deepEqual(r.words, words);
  assert.equal(r.id, testId(words));
});

test('encodeTest: 30問・日本語入りで 1500文字以内', async (t) => {
  const s = await encodeTest(thirty());
  // console.log はテストランナーとの通信に混ざり、まれに落ちる。diagnostic を使う。
  t.diagnostic(`30問のリンク文字数: ${s.length}`);
  assert.ok(s.length <= 1500);
});

test('decodeTest: 壊れたリンクは例外でなく reason を返す', async () => {
  const s = await encodeTest(thirty());
  for (const bad of ['', '#', s.slice(0, 40), s.slice(0, -10), '!!!!', 'AAAA']) {
    const r = await decodeTest(bad);
    assert.equal(r.ok, false, bad);
    assert.ok(r.reason.length > 0);
  }
  assert.match((await decodeTest(s.slice(0, 40))).reason, /途中で切れ/);
});

test('testId: 6文字・同じ内容なら同じ・違えば変わる・ハイフンなし', () => {
  const a = parseWordList('a,あ\nb,い').words;
  const b = parseWordList('a,あ\nb,う').words;
  assert.match(testId(a), /^[0-9a-z]{6}$/);
  assert.equal(testId(a), testId(parseWordList('a,あ\nb,い').words));
  assert.notEqual(testId(a), testId(b));
});

const RC = { id: 'abc123', kumi: '2B', no: 14 };
const mk = (o) => makeResultCode({ ...RC, ...o });

test('makeResultCode/parseResultCode: 組・番号つきで往復', () => {
  const code = mk({ score: 27, total: 30, nick: 'ひなた' });
  assert.match(code, /^abc123-2B-14-27-30-ひなた-[0-9a-z]{4}$/);
  assert.deepEqual(parseResultCode(code),
    { ok: true, id: 'abc123', kumi: '2B', no: 14, score: 27, total: 30, nick: 'ひなた' });
});

test('checkKumi: 全角→半角・英字は大文字、3文字までの数字か英字', () => {
  for (const [v, want] of [['2b', '2B'], ['２Ｂ', '2B'], [' 3 ', '3'], ['a1c', 'A1C'], [7, '7']]) {
    assert.deepEqual(checkKumi(v), { ok: true, value: want, reason: '' }, String(v));
  }
  for (const v of ['', '  ', '2-B', '1234', '二', '2 B']) {
    const r = checkKumi(v);
    assert.equal(r.ok, false, v);
    assert.match(r.reason, /^組/, v);
  }
});

test('checkNo: 1〜99 の整数。全角・先頭の0は許す', () => {
  for (const [v, want] of [['14', 14], ['07', 7], ['１４', 14], [99, 99], [' 1 ', 1]]) {
    assert.deepEqual(checkNo(v), { ok: true, value: want, reason: '' }, String(v));
  }
  for (const v of ['', '0', '100', '1.5', '-3', 'a', 0, 100]) {
    const r = checkNo(v);
    assert.equal(r.ok, false, String(v));
    assert.match(r.reason, /^出席番号/, String(v));
  }
});

test('makeResultCode: 組・番号はそろえてから入れる。壊れた値は欄の名前つきで例外', () => {
  assert.match(mk({ kumi: '２ｂ', no: '07', score: 1, total: 5, nick: 'a' }), /^abc123-2B-7-1-5-a-/);
  assert.throws(() => mk({ kumi: '', score: 1, total: 5 }), /組/);
  assert.throws(() => mk({ no: 0, score: 1, total: 5 }), /出席番号/);
});

test('チェック4文字は組と番号も含む (組・番号を書き換えるとコピーミス扱い)', () => {
  const code = mk({ score: 3, total: 5, nick: 'taro' });
  assert.match(parseResultCode(code.replace('-2B-', '-2C-')).reason, /コピー|切れ/);
  assert.match(parseResultCode(code.replace('-14-', '-15-')).reason, /コピー|切れ/);
  // 小文字で打ち直したコードは、そろえてから確かめる
  assert.equal(parseResultCode(code.replace('-2B-', '-2b-')).kumi, '2B');
});

test('ニックネーム: - タブ 改行を除き12文字まで、空なら名無し', () => {
  const p = (nick) => parseResultCode(mk({ score: 1, total: 5, nick }));
  assert.equal(p('a-b\nc\td').nick, 'abcd');
  assert.equal(p('あ'.repeat(20)).nick, 'あ'.repeat(12));
  assert.equal(p('').nick, '名無し');
  assert.equal(p('--\n').nick, '名無し');
  assert.equal(p(undefined).nick, '名無し');
});

test('parseResultCode: 前後の空白は許し、壊れたコードは理由つき', () => {
  const code = mk({ score: 3, total: 5, nick: 'taro' });
  assert.equal(parseResultCode(`  ${code}\n`).ok, true);
  const cases = {
    '': /空/,
    'abc123-2B-14-3-5-taro': /形式/,
    'abc123-3-5-taro-xxxx': /形式/, // iteration 1 の古い形式
    [code.slice(0, -2)]: /コピー|切れ/,
    [code.replace('-3-5-', '-4-5-')]: /コピー|切れ/,
    'abc-2B-14-3-5-taro-xxxx': /テストID/,
    'abc123-2-B-3-5-taro-xxxx': /^出席番号/,
    'abc123-ABCD-14-3-5-taro-xxxx': /^組/,
    'abc123-2B-0-3-5-taro-xxxx': /^出席番号/,
    'abc123-2B-14-x-5-taro-xxxx': /点数/,
    'abc123-2B-14-9-5-taro-xxxx': /点数/,
  };
  for (const [bad, re] of Object.entries(cases)) {
    const r = parseResultCode(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.reason, re, bad);
  }
});

test('makeResultCode: 点数が範囲外なら例外 (画面側のバグ検出)', () => {
  assert.throws(() => mk({ score: 6, total: 5, nick: 'a' }));
});

// ---- Google フォームの URL ----

test('checkFormUrl: Google フォームの https URL だけ通す。空はフォームなし', () => {
  assert.deepEqual(checkFormUrl(''), { ok: true, value: '', reason: '' });
  assert.deepEqual(checkFormUrl('  '), { ok: true, value: '', reason: '' });
  for (const u of ['https://docs.google.com/forms/d/e/1FAIpQLSf/viewform', 'https://forms.gle/AbC123xyz']) {
    assert.deepEqual(checkFormUrl(` ${u} `), { ok: true, value: u, reason: '' });
  }
  for (const u of ['http://forms.gle/AbC', 'https://evil.example/forms/', 'https://docs.google.com/document/d/x',
    'https://docs.google.com.evil.example/forms/x', 'https://forms.gle@evil.example/', 'javascript:alert(1)', 'forms.gle/x',
    'https://forms.gle/' + 'a'.repeat(400)]) {
    const r = checkFormUrl(u);
    assert.equal(r.ok, false, u);
    assert.match(r.reason, /フォーム/, u);
  }
});

test('encodeTest/decodeTest: フォームの URL を入れて往復。入れなければ form は空', async () => {
  const words = parseWordList('apple,りんご\nrun,走る').words;
  const url = 'https://forms.gle/AbC123xyz';
  const d = await decodeTest(await encodeTest(words, url));
  assert.equal(d.form, url);
  assert.deepEqual(d.words, words);
  assert.equal(d.id, testId(words)); // フォームを変えてもテストIDは同じ
  assert.equal((await decodeTest(await encodeTest(words))).form, '');
});

test('decodeTest: リンクに入った Google 以外の URL は捨てる (誘導に使わせない)', async () => {
  const words = [['a', 'あ']];
  const raw = new TextEncoder().encode(JSON.stringify({ w: words, f: 'https://evil.example/' }));
  const out = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const b = Buffer.from(await new Response(out).arrayBuffer()).toString('base64url');
  const d = await decodeTest(b);
  assert.equal(d.ok, true);
  assert.equal(d.form, '');
});

test('encodeTest: 30問 + 長めのフォーム URL で 1500文字以内', async (t) => {
  const form = 'https://docs.google.com/forms/d/e/1FAIpQLSdXk3v9Qm2Lr8ZtYbW4nPc7HjK1uE5oA6sD0fG2hJ3kL4mN5o/viewform';
  const s = await encodeTest(thirty(), form);
  t.diagnostic(`30問+フォーム URL (${form.length}文字) のリンク文字数: ${s.length}`);
  assert.ok(s.length <= 1500);
});
