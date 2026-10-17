import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeResultCode, encodeTest, decodeTest } from '../src/tango.js';
import { buildTestLink, aggregateResults, toCsv, csvCell, CSV_BOM } from '../src/teacher.js';

const LIST = 'run,走る、運営する\napple,りんご\n\nbook,本\nbad line\n,空\ncat,';
const ID = 'abc123';
let auto = 0; // 組・番号を指定しないときは 1組の1番から順に振る
const code = (score, nick, id = ID, total = 30, kumi = '1', no = ++auto) => makeResultCode({ id, kumi, no, score, total, nick });

// ---- T2: テストリンク ----

test('buildTestLink: 有効な行だけでリンクを作り、無効な行は errors に残る', async () => {
  const r = await buildTestLink(LIST, 'https://example.com/index.html');
  assert.equal(r.ok, true);
  assert.equal(r.words.length, 3);
  assert.deepEqual(r.errors.map((e) => e.line), [5, 6, 7]);
  assert.match(r.url, /^https:\/\/example\.com\/index\.html#[\w-]+$/);
});

test('buildTestLink: リンクを開くと同じ問題と同じテストIDが出る', async () => {
  const r = await buildTestLink(LIST, 'https://example.com/index.html');
  const d = await decodeTest(new URL(r.url).hash);
  assert.equal(d.ok, true);
  assert.deepEqual(d.words.map((w) => [w.en, w.ja]), r.words.map((w) => [w.en, w.ja]));
  assert.equal(d.id, r.id);
});

test('buildTestLink: 有効な行が0なら ok:false で理由を返す (リンクは作らない)', async () => {
  const r = await buildTestLink('だめ\n\nこれも', 'https://example.com/');
  assert.equal(r.ok, false);
  assert.equal(r.url, undefined);
  assert.equal(r.errors.length, 2);
  assert.match(r.reason, /有効な行/);
});

test('buildTestLink: 31行目以降は使わず truncated を返す', async () => {
  const text = Array.from({ length: 35 }, (_, i) => `w${i},語${i}`).join('\n');
  const r = await buildTestLink(text, 'https://example.com/');
  assert.equal(r.words.length, 30);
  assert.equal(r.truncated, true);
});

test('buildTestLink: 30問のリンクが1500文字以内 (日本語入り)', async () => {
  const text = Array.from({ length: 30 }, (_, i) => `vocabulary${i}x,意味その${i}、別の意味${i}、さらに${i}`).join('\n');
  const r = await buildTestLink(text, '');
  assert.ok(r.url.length <= 1501, `長さ ${r.url.length}`);
});

const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSdXk3v9Qm2Lr8ZtYbW4nPc7HjK1uE5oA6sD0fG2hJ3kL4mN5o/viewform';

test('buildTestLink: フォームの URL をリンクに入れ、開くと戻る', async () => {
  const r = await buildTestLink(LIST, 'https://example.com/test.html', ` ${FORM} `);
  assert.equal(r.ok, true);
  assert.equal(r.form, FORM);
  assert.equal((await decodeTest(new URL(r.url).hash)).form, FORM);
});

test('buildTestLink: Google フォーム以外の URL ならリンクを作らず理由を返す', async () => {
  const r = await buildTestLink(LIST, 'https://example.com/test.html', 'https://example.com/form');
  assert.equal(r.ok, false);
  assert.equal(r.url, undefined);
  assert.match(r.reason, /フォーム/);
  assert.equal(r.errors.length, 3); // 単語リストの無効な行も一緒に見せる
});

test('buildTestLink: 30問 + フォームの URL で # の後ろが1500文字以内', async (t) => {
  const text = Array.from({ length: 30 }, (_, i) => `vocabulary${i}x,意味その${i}、別の意味${i}、さらに${i}`).join('\n');
  const r = await buildTestLink(text, '', FORM);
  t.diagnostic(`30問+フォーム: ${r.url.length - 1}文字`);
  assert.ok(r.url.length <= 1501, `長さ ${r.url.length}`);
});

// ---- T4: 集計 ----

test('aggregateResults: 一覧・平均・同じテストIDだけを集計する', () => {
  const text = [code(27, 'ひなた'), code(21, 'たろう'), code(30, '別テスト', 'zzzzzz')].join('\n');
  const r = aggregateResults(text);
  assert.equal(r.id, ID);
  assert.deepEqual(r.rows.map((x) => [x.nick, x.score, x.total]), [['ひなた', 27, 30], ['たろう', 21, 30]]);
  assert.equal(r.average, 24);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].line, 3);
  assert.match(r.skipped[0].reason, /別のテスト/);
});

test('aggregateResults: 壊れた行は行番号つきでスキップし、空行は数えない', () => {
  const text = [code(27, 'ひなた'), '', 'こわれたコード', code(20, 'たろう').replace(/.$/, 'x')].join('\n');
  const r = aggregateResults(text);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.skipped.map((s) => s.line), [3, 4]);
  assert.ok(r.skipped.every((s) => s.reason.length > 0));
});

test('aggregateResults: 指定したテストIDだけ集計できる / 候補のIDを返す', () => {
  const text = [code(10, 'a'), code(20, 'b', 'zzzzzz'), code(30, 'c', 'zzzzzz')].join('\n');
  assert.equal(aggregateResults(text).id, 'zzzzzz');
  const r = aggregateResults(text, ID);
  assert.deepEqual(r.rows.map((x) => x.nick), ['a']);
  assert.deepEqual(r.ids.sort(), [ID, 'zzzzzz'].sort());
});

test('aggregateResults: 全く同じコードの貼り重ねは1件にする。やり直しの別点数は両方残す', () => {
  const t20 = code(20, 'たろう', ID, 30, '1', 5);
  const text = [t20, t20, code(25, 'たろう', ID, 30, '1', 5)].join('\n');
  const r = aggregateResults(text);
  assert.deepEqual(r.rows.map((x) => x.score), [20, 25]);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /同じコード/);
});

test('aggregateResults: 問題数が他と違うコードはスキップする', () => {
  const r = aggregateResults([code(10, 'a', ID, 30), code(5, 'b', ID, 10)].join('\n'));
  assert.equal(r.rows.length, 1);
  assert.match(r.skipped[0].reason, /問題数/);
});

test('aggregateResults: 組→番号の順に並ぶ (組は 2 < 10、番号は数値順)', () => {
  const text = [code(1, 'c', ID, 30, '10', 1), code(2, 'b', ID, 30, '2', 11), code(3, 'a', ID, 30, '2', 3),
    code(4, 'd', ID, 30, '2a', 1)].join('\n');
  const r = aggregateResults(text);
  assert.deepEqual(r.rows.map((x) => `${x.kumi}-${x.no}`), ['2-3', '2-11', '2A-1', '10-1']);
  assert.ok(r.rows.every((x) => typeof x.no === 'number'));
});

test('aggregateResults: 同じ組・番号が複数回あれば両方残して dup の印を付ける', () => {
  const text = [code(20, 'たろう', ID, 30, '1', 5), code(25, 'たろう', ID, 30, '1', 5), code(9, 'はな', ID, 30, '1', 6)].join('\n');
  const r = aggregateResults(text);
  assert.deepEqual(r.rows.map((x) => [x.no, x.score, x.dup]), [[5, 20, true], [5, 25, true], [6, 9, false]]);
});

// Google フォームの回答シートを列ごとコピーした形 (タブ区切り・見出しあり)
test('aggregateResults: フォームの回答を見出し・タイムスタンプごと貼ってもコードだけ読む', () => {
  const a = code(27, 'ひなた', ID, 30, '2B', 14);
  const b = code(21, 'けん', ID, 30, '2B', 3);
  const text = [
    'タイムスタンプ\t結果コード',
    `2026/10/19 8:01:02\t  ${a}  `,
    `2026/10/19 8:03:10\t"${b}"`,
    '2026/10/19 8:04:00\tわかりません',
    `${code(5, 'x', ID, 30, '1', 1)}\t2026/10/19 8:05:00`.replace(/.\t/, 'Z\t'),
    '',
  ].join('\r\n');
  const r = aggregateResults(text);
  assert.deepEqual(r.rows.map((x) => `${x.kumi}-${x.no} ${x.nick} ${x.score}`), ['2B-3 けん 21', '2B-14 ひなた 27']);
  assert.deepEqual(r.skipped.map((s) => s.line), [4, 5]); // 見出し (1行目) は黙って飛ばす
  assert.match(r.skipped[0].reason, /結果コードが見つかりません/);
  assert.match(r.skipped[1].reason, /コピー|切れ/);
});

// T9: フォームのタイムスタンプを提出時刻として残す
test('aggregateResults: フォームのタイムスタンプがあれば提出時刻 (at) に入る。同じ番号はどちらが先か分かる', () => {
  const text = [
    'タイムスタンプ\t結果コード',
    `2026/10/19 8:06:00\t${code(27, 'ひなた', ID, 30, '2B', 14)}`,
    `2026/10/19 8:01:02\t${code(22, 'ひなた', ID, 30, '2B', 14)}`,
    `2026-10-19 13:02\t${code(28, 'けん', ID, 30, '2B', 3)}`,
  ].join('\n');
  const r = aggregateResults(text);
  assert.deepEqual(r.rows.map((x) => [x.no, x.score, x.at, x.dup]), [
    [3, 28, '2026-10-19 13:02', false],
    [14, 22, '2026/10/19 8:01:02', true], // 同じ番号の中は先に出した順
    [14, 27, '2026/10/19 8:06:00', true],
  ]);
  assert.equal(r.hasTime, true);
});

test('aggregateResults: コードだけを貼ったときは提出時刻が空で、今までどおり集計できる', () => {
  const r = aggregateResults([code(20, 'a', ID, 30, '1', 2), code(10, 'b', ID, 30, '1', 1)].join('\n'));
  assert.deepEqual(r.rows.map((x) => [x.no, x.at]), [[1, ''], [2, '']]);
  assert.equal(r.hasTime, false);
});

test('toCsv: 提出時刻の列に時刻が入り、BOM と CRLF はそのまま', () => {
  const csv = toCsv([{ kumi: '1', no: 2, nick: 'a', score: 5, total: 30, dup: false, at: '2026/10/19 8:01:02' }]);
  assert.equal(csv[0], CSV_BOM);
  assert.equal(csv.slice(1).split('\r\n')[1], '1,2,a,5,30,,2026/10/19 8:01:02');
});

test('aggregateResults: 1行目が壊れたコードなら見出し扱いせずスキップに出す', () => {
  const r = aggregateResults(['abc123-1-2-3-30-x-zzzz', code(3, 'a')].join('\n'));
  assert.deepEqual(r.skipped.map((s) => s.line), [1]);
});

test('aggregateResults: 有効なコードが無いとき id は null、平均は null', () => {
  const r = aggregateResults('ぜんぶ\nだめ');
  assert.equal(r.id, null);
  assert.equal(r.average, null);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.skipped.map((s) => s.line), [2]); // 1行目は見出し扱い
});

// ---- T4: CSV ----

test('csvCell: カンマ・引用符・改行をエスケープする', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell('abc'), 'abc');
});

test('csvCell: = + - @ で始まるセルは先頭に \' を付ける', () => {
  for (const c of ['=1+1', '+1', '-1', '@sum']) assert.equal(csvCell(c), `'${c}`);
  assert.equal(csvCell('a=b'), 'a=b');
});

test('toCsv: BOM つき UTF-8、CRLF、ヘッダあり、日本語のニックネームが入る', () => {
  const rows = [{ kumi: '2B', no: 3, nick: 'ひなた', score: 27, total: 30, dup: false },
    { kumi: '2B', no: 14, nick: '=cmd', score: 3, total: 30, dup: true }];
  const csv = toCsv(rows);
  assert.equal(csv[0], CSV_BOM);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], '組,番号,ニックネーム,点数,問題数,同じ番号,提出時刻');
  assert.equal(lines[1], '2B,3,ひなた,27,30,,');
  assert.equal(lines[2], "2B,14,'=cmd,3,30,2回以上,");
  const bytes = new TextEncoder().encode(csv);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('encodeTest 往復は T5 のまま (回帰)', async () => {
  const d = await decodeTest(await encodeTest([{ en: 'a', ja: 'あ' }]));
  assert.equal(d.ok, true);
});
