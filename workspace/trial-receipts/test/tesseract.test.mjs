import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { parseTsv, extract, tesseractReader } from '../src/tesseract.mjs';
import { normalize } from '../src/reader.mjs';

const L = (text, conf = 0.95) => ({ text, conf });

test('TSV の単語を行ごとにまとめ、conf は行の最小値になる', () => {
  const head = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const w = (line, conf, text) => `5\t1\t1\t1\t${line}\t1\t0\t0\t1\t1\t${conf}\t${text}`;
  const lines = parseTsv([head, w(1, 96, 'ローソン'), w(2, 91, '合計'), w(2, 70, '¥1,200'), '4\t1\t1\t1\t3\t0\t0\t0\t1\t1\t-1\t'].join('\n'));
  assert.deepEqual(lines, [{ text: 'ローソン', conf: 0.96 }, { text: '合計¥1,200', conf: 0.7 }]);
});

test('きれいなレシート: 4項目が取れる', () => {
  const r = extract([L('ローソン 新宿店'), L('2026年10月3日(土) 12:30'), L('小計 ¥1,112'), L('消費税 ¥88'), L('合計 ¥1,200'), L('お預り ¥2,000'), L('お釣り ¥800')]);
  assert.equal(r.amount.value, 1200);
  assert.equal(r.date.value, '2026-10-03');
  assert.equal(r.payee.value, 'ローソン 新宿店');
  assert.equal(r.category.value, '');
});

test('誤読しそうな形は数にせず、空欄＋要確認になる', () => {
  const n = normalize(extract([L('カフェ'), L('2026/10/9'), L('合計 1,2O0')]));
  assert.deepEqual([n.amount.value, n.amount.needs_review], ['', true]);
  assert.equal(n.date.value, '2026-10-09');
  // 合成画像で実際に出た読み（「¥1,500」→「\\1.500」）。末尾の 500 だけを拾わない
  assert.deepEqual(extract([L('運賃 ~”\\1.500', 0.99)]).amount, { value: '', confidence: 0, reason: '数字が読み取れません' });
});

test('合計や日付の候補が食い違えば、どちらも選ばない', () => {
  const r = extract([L('2026/10/03'), L('2026/10/08'), L('合計 ¥480'), L('ご請求 ¥4,800')]);
  assert.equal(r.amount.value, '');
  assert.equal(r.amount.reason, '合計の候補が複数あります');
  assert.equal(r.date.reason, '日付の候補が複数あります');
});

test('令和の日付、存在しない日付', () => {
  assert.equal(extract([L('令和8年10月3日')]).date.value, '2026-10-03');
  assert.equal(extract([L('2026/02/30')]).date.value, '');
});

test('カテゴリはキーワードで1つに決まるときだけ', () => {
  assert.equal(extract([L('〇〇交通 タクシー'), L('運賃 ¥1,500')]).category.value, '交通費');
  assert.equal(normalize(extract([L('Restaurant'), L('Coffee')])).category.value, '会議費');
  assert.equal(normalize(extract([L('文具とカフェ'), L('コーヒー')])).category.needs_review, true);
});

test('HEIC は読み取らず、理由つきで失敗する', async () => {
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
  await assert.rejects(tesseractReader(heic), /HEIC/);
});

let hasTesseract = true;
try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); } catch { hasTesseract = false; }
test('tesseract が入っていれば、実際に画像を読む', { skip: !hasTesseract && 'tesseract がありません' }, async () => {
  const png = whitePng(300, 100); // 読めるものはないので、すべて空欄になる
  const r = normalize(await tesseractReader(png));
  for (const f of ['date', 'amount', 'payee']) assert.equal(r[f].needs_review, true);
});

function whitePng(w, h) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE(crc(td), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 255); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
