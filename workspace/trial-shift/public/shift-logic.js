// オーナー画面の純関数。DOM に触れないのでテストできる。
import { mdLabel } from './common.js';

// "9:00-14:00" / "09:00〜14:00" -> {start,end} / null(空) / {error}
export function parseShift(text) {
  const t = (text || '').trim().replace(/[〜～~－ー–—]/g, '-').replace(/：/g, ':');
  if (!t) return null;
  const m = /^(\d{1,2}):?(\d{2})\s*-\s*(\d{1,2}):?(\d{2})$/.exec(t);
  if (!m) return { error: '「09:00-14:00」の形で入力してください' };
  const [h1, m1, h2, m2] = [m[1], m[2], m[3], m[4]].map(Number);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return { error: '時刻が正しくありません' };
  const start = `${String(h1).padStart(2, '0')}:${m[2]}`;
  const end = `${String(h2).padStart(2, '0')}:${m[4]}`;
  if (end <= start) return { error: '終了は開始より後にしてください(日またぎは未対応)' };
  return { start, end };
}

// cells: {"2026-11-03|staffId": "09:00-14:00"} -> calc 用 shifts と入力エラー
export function buildShifts(cells) {
  const shifts = [];
  const errors = {};
  for (const [key, text] of Object.entries(cells)) {
    const p = parseShift(text);
    if (!p) continue;
    if (p.error) { errors[key] = p.error; continue; }
    const [date, staffId] = key.split('|');
    shifts.push({ date, staffId, start: p.start, end: p.end });
  }
  shifts.sort((a, b) => a.date.localeCompare(b.date) || a.staffId.localeCompare(b.staffId));
  return { shifts, errors };
}

// 入れないと答えた日にシフトを入れていないか
export function ngWarnings(shifts, staff) {
  const out = [];
  for (const s of shifts) {
    const who = staff.find((x) => x.id === s.staffId);
    const day = who && who.days && who.days[s.date];
    if (day && day.available === false) {
      out.push({ staffId: s.staffId, date: s.date, text: `${who.name}さんは${mdLabel(s.date)}「入れない」と答えています` });
    }
  }
  return out;
}

export function overLimitText(o) {
  const [, m, d] = o.weekStart.split('-').map(Number);
  const end = new Date(Number(o.weekStart.slice(0, 4)), m - 1, d + 6);
  return `${o.name}さん ${m}/${d}〜${end.getMonth() + 1}/${end.getDate()}の週 ${round1(o.hours)}h / 上限 ${o.limit}h`;
}

const round1 = (n) => Math.round(n * 10) / 10;

export function yen(n) { return `${Math.round(n).toLocaleString('ja-JP')}円`; }
export function pct(r) { return `${(Math.round(r * 1000) / 10).toFixed(1)}%`; }

// LINE に貼るテキスト。日付ごとに「9:00-14:00 名前」を並べる。
export function lineText(month, dates, staff, shifts) {
  const [, m] = month.split('-').map(Number);
  const names = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const lines = [`【${m}月のシフト】`];
  for (const d of dates) {
    const day = shifts.filter((s) => s.date === d.date);
    if (!day.length) continue;
    const parts = day.map((s) => `${s.start.replace(/^0/, '')}-${s.end.replace(/^0/, '')} ${names[s.staffId]}`);
    lines.push(`${d.day}(${WD[d.wd]}) ${parts.join(' / ')}`);
  }
  if (lines.length === 1) lines.push('(まだシフトがありません)');
  return lines.join('\n');
}
