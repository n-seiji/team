// 月ごとの表・合計・CSV。
import { FIELDS, LABELS } from './reader.mjs';

// 順番待ち・読み取り中はまだ数えない。失敗も項目で判定する（失敗時は4項目とも要確認で入るので、手で直すまで数える）。
export const isPending = (r) => r.status === 'queued' || r.status === 'reading';
export const rowNeedsReview = (r) => !isPending(r) && (!r.fields || FIELDS.some((f) => r.fields[f]?.needs_review));
const rowUnconfirmed = (r) => isPending(r) || rowNeedsReview(r);
const dateOf = (r) => r.fields?.date?.value || '';

export function buildTable(records, month) {
  if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month は YYYY-MM で指定してください');
  const needs_review_count = records.filter(rowNeedsReview).length; // 月に関係なく全体
  const undated_count = records.filter((r) => !dateOf(r)).length;
  let rows = month ? records.filter((r) => dateOf(r).startsWith(month)) : records;
  rows = [...rows].sort((a, b) => {
    const da = dateOf(a), db = dateOf(b);
    if (da !== db) return !da ? 1 : !db ? -1 : da < db ? -1 : 1; // 日付なしは末尾
    return a.created_at < b.created_at ? -1 : 1;
  });
  const total = rows.reduce((s, r) => s + (Number.isInteger(r.fields?.amount?.value) ? r.fields.amount.value : 0), 0);
  const unconfirmed = rows.filter(rowUnconfirmed).length; // 合計に読み取り中が混ざっても確定扱いにしない
  return {
    month: month ?? null,
    rows,
    total,
    unconfirmed_count: unconfirmed,
    total_note: unconfirmed ? `未確認が${unconfirmed}件あり、合計は確定ではありません` : '',
    needs_review_count,
    undated_count,
  };
}

const q = (s) => {
  let v = String(s ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // 表計算の数式として実行されないように
  return `"${v.replaceAll('"', '""')}"`;
};

export function toCsv(rows) {
  const head = ['日付', '金額', '支払先', 'カテゴリ', '要確認', 'id', '画像'];
  const lines = [head.map(q).join(',')];
  for (const r of rows) {
    const f = r.fields ?? {};
    const reasons = FIELDS.filter((k) => f[k]?.needs_review).map((k) => (f[k].reason === '未読み取り' ? `${LABELS[k]}はまだ読み取られていません` : `${LABELS[k]}が${f[k].reason}`)).join(' / ');
    const flag = rowUnconfirmed(r) ? `要確認${reasons ? '：' + reasons : ''}` : '';
    // 紙と同じく、カテゴリが要確認のままなら「その他」ではなく「未分類（要確認）」と書く（T11）
    const category = f.category?.needs_review ? '未分類（要確認）' : f.category?.value ?? '';
    lines.push([f.date?.value ?? '', f.amount?.value ?? '', f.payee?.value ?? '', category, flag, r.id, `/receipts/${r.id}/image`].map(q).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n'; // UTF-8 BOM（Excel向け）
}
