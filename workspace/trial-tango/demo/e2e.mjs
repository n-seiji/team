// 先生→生徒→先生の流れを画面なしで通す確認スクリプト
import { decodeTest, makeResultCode } from '../src/tango.js';
import { grade } from '../src/quiz.js';
import { buildTestLink, aggregateResults, toCsv } from '../src/teacher.js';

const list = ['abandon,捨てる、断念する', 'borrow,借りる', 'こわれた行', 'consider,考える、よく考える', 'decline,断る', 'expand,広げる'].join('\n');
const link = await buildTestLink(list, 'https://example.invalid/test.html', 'https://forms.gle/AbC123xyz');
console.log('リンク:', link.ok, 'ID', link.id, 'フォーム', link.form, '# の後ろ', link.url.split('#')[1].length, '文字', '問題数', link.words.length, '無効行', link.errors.map((e) => `${e.line}行目: ${e.reason}`));
const test = await decodeTest(new URL(link.url).hash);
console.log('生徒が開く:', test.ok, test.words.length, '問 / フォーム', test.form);
const answers = [['考える', '借りる', '', '断る', '広げる'], ['断念する', '借りる', 'よく考える', '断る', '広げる'], ['x', 'x', 'x', 'x', 'x']];
const codes = answers.map((a, i) => {
  const r = grade(test.words, a, 'input');
  return makeResultCode({ id: test.id, kumi: ['2b', '２Ｂ', '1'][i], no: ['14', 3, '07'][i], score: r.score, total: r.total, nick: ['ひなた', '=SUM(A1)', 'けん'][i] });
});
console.log('結果コード:\n' + codes.join('\n'));
// Google フォームの回答シートを列ごと貼った形
const form = ['タイムスタンプ\t結果コード', ...[...codes, codes[0], 'こわれたコード'].map((c, i) => `2026/10/19 8:0${i}:00\t ${c} `)].join('\n');
const agg = aggregateResults(form);
console.log('集計:', JSON.stringify({ ...agg, rows: agg.rows?.map((r) => `${r.kumi}-${r.no} ${r.nick} ${r.score}/${r.total}${r.dup ? ' (同じ番号)' : ''}`) }));
const csv = toCsv(agg.rows);
console.log('CSV先頭BOM:', csv.charCodeAt(0) === 0xfeff, 'CRLF:', csv.includes('\r\n'));
console.log(csv.slice(1));
