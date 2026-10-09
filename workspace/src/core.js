// コア: データ保存・採番・金額計算。標準ライブラリのみ。金額はすべて整数円。
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TAX_RATE_PERCENT = 10; // 消費税 10%
const WITHHOLDING_BP = 1021; // 源泉 10.21% = 1021 / 10000

// エラーコード付きの Error。CLI は message ではなく code で分岐する。
// 'NO_ISSUER' | 'CLIENT_NOT_FOUND' | 'CLIENT_EXISTS' | 'INVALID_INPUT'
function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

export function openStore(dir) {
  return { dir, file: join(dir, 'data.json') };
}

function emptyData() {
  return { issuer: null, clients: [], invoices: [], lastSeq: 0 };
}

function load(store) {
  if (!existsSync(store.file)) return emptyData();
  return JSON.parse(readFileSync(store.file, 'utf8'));
}

// 一時ファイルに書いて rename。途中で落ちても data.json は壊れない。
function save(store, data) {
  mkdirSync(store.dir, { recursive: true });
  const tmp = `${store.file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, store.file);
}

export function initStore(store, { name, invoiceNumber = '' }) {
  if (!name) throw fail('INVALID_INPUT', '発行者名が必要です');
  if (invoiceNumber && !/^T\d{13}$/.test(invoiceNumber)) {
    throw fail('INVALID_INPUT', 'インボイス登録番号は T + 13桁の数字です（例: T1234567890123）');
  }
  const data = load(store);
  data.issuer = { name, invoiceNumber };
  save(store, data);
  return data.issuer;
}

export function getIssuer(store) {
  return load(store).issuer;
}

export function addClient(store, { name, honorific = '御中', withholding = false }) {
  if (!name) throw fail('INVALID_INPUT', 'クライアント名が必要です');
  const data = load(store);
  if (data.clients.some((c) => c.name === name)) throw fail('CLIENT_EXISTS', `${name} は登録済みです`);
  const client = { id: `c${data.clients.length + 1}`, name, honorific, withholding: !!withholding };
  data.clients.push(client);
  save(store, data);
  return client;
}

export function listClients(store) {
  return load(store).clients;
}

// id か名前で検索
export function findClient(store, key) {
  return load(store).clients.find((c) => c.id === key || c.name === key) ?? null;
}

// 金額計算（純粋関数）。
// 消費税 = 小計 × 10%（円未満切り捨て）
// 源泉   = 「源泉対象」明細の合計（税抜）× 10.21%（円未満切り捨て）。クライアントが源泉ありの場合のみ。
// 請求額 = 小計 + 消費税 − 源泉
export function calcAmounts(items, withholding) {
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const tax = Math.floor((subtotal * TAX_RATE_PERCENT) / 100);
  const base = items.filter((i) => i.withholding).reduce((s, i) => s + i.amount, 0);
  const withholdingTax = withholding ? Math.floor((base * WITHHOLDING_BP) / 10000) : 0;
  return { subtotal, tax, withholdingBase: withholding ? base : 0, withholdingTax, total: subtotal + tax - withholdingTax };
}

function normalize(data, { clientId, month, items }) {
  const client = data.clients.find((c) => c.id === clientId || c.name === clientId);
  if (!client) throw fail('CLIENT_NOT_FOUND', `クライアント「${clientId}」は未登録です`);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) throw fail('INVALID_INPUT', '対象月は YYYY-MM 形式です');
  if (!Array.isArray(items) || items.length === 0) throw fail('INVALID_INPUT', '明細が必要です');
  const norm = items.map((i) => {
    if (!i.name) throw fail('INVALID_INPUT', '明細の名称が必要です');
    if (!Number.isInteger(i.amount) || i.amount <= 0) throw fail('INVALID_INPUT', `金額は1以上の整数円です: ${i.name}`);
    return { name: i.name, amount: i.amount, withholding: !!i.withholding };
  });
  return { client, month, items: norm, ...calcAmounts(norm, client.withholding) };
}

function snapshot(data, p) {
  return {
    client: { id: p.client.id, name: p.client.name, honorific: p.client.honorific, withholding: p.client.withholding },
    issuer: data.issuer,
    month: p.month,
    items: p.items,
    subtotal: p.subtotal,
    tax: p.tax,
    withholdingBase: p.withholdingBase,
    withholdingTax: p.withholdingTax,
    total: p.total,
  };
}

// ローカル時刻の YYYY-MM-DD。toISOString はUTC基準で、日本の午前9時前に前日になる。
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 番号なし・書き込みなし。確認画面用。
export function previewInvoice(store, input) {
  const data = load(store);
  return snapshot(data, normalize(data, input));
}

// 確定。ここで初めて採番して保存する。番号は lastSeq の単調増加で、欠番・重複を出さない。
export function createInvoice(store, input, { date = new Date() } = {}) {
  const data = load(store);
  if (!data.issuer) throw fail('NO_ISSUER', '先に init で発行者を設定してください');
  const inv = snapshot(data, normalize(data, input));
  data.lastSeq += 1;
  inv.number = `INV-${String(data.lastSeq).padStart(4, '0')}`;
  inv.date = localDate(date);
  data.invoices.push(inv);
  save(store, data);
  return inv;
}

export function listInvoices(store) {
  return load(store).invoices.map((i) => ({
    number: i.number, date: i.date, client: i.client.name, month: i.month, total: i.total,
  }));
}

export function getInvoice(store, number) {
  return load(store).invoices.find((i) => i.number === number) ?? null;
}
