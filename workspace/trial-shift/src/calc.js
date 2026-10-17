// 人件費と週上限の計算(純関数)。時刻は同日の HH:MM のみ。休憩控除なし。
export class CalcError extends Error {}

const DAY_MS = 86400000;

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new CalcError(`日付が不正です: ${s}`);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(t).toISOString().slice(0, 10) !== s) throw new CalcError(`存在しない日付です: ${s}`);
  return t;
}

function minutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm));
  if (!m) throw new CalcError(`時刻が不正です: ${hhmm}`);
  return +m[1] * 60 + +m[2];
}

export function weekStartOf(date) {
  const t = parseDate(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 月=0
  return new Date(t - dow * DAY_MS).toISOString().slice(0, 10);
}

export function isMonth(s) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

export function calc({ month, revenue, targetRate = 0.3, staff, shifts, carryIn = {} }) {
  if (!isMonth(month)) throw new CalcError('month は YYYY-MM で指定してください');
  if (typeof revenue !== 'number' || !(revenue > 0)) throw new CalcError('売上見込みは0より大きい数値にしてください');
  if (typeof targetRate !== 'number' || !(targetRate > 0 && targetRate <= 1)) throw new CalcError('目標率は0より大きく1以下で指定してください');
  if (!Array.isArray(shifts)) throw new CalcError('shifts は配列です');
  const byId = new Map(staff.map((s) => [s.id, s]));

  let costYen = 0; // 分×時給/60 を丸めずに合計する
  const weekMin = new Map(); // `${staffId}|${weekStart}` -> 分
  for (const s of shifts) {
    const st = byId.get(s.staffId);
    if (!st) throw new CalcError(`不明なスタッフです: ${s.staffId}`);
    parseDate(s.date);
    if (!s.date.startsWith(month + '-')) throw new CalcError(`${month} 以外の日付です: ${s.date}`);
    const len = minutes(s.end) - minutes(s.start);
    if (len <= 0) throw new CalcError(`終了は開始より後にしてください(日またぎ不可): ${s.date} ${s.start}-${s.end}`);
    costYen += (len * st.wage) / 60;
    const k = `${s.staffId}|${weekStartOf(s.date)}`;
    weekMin.set(k, (weekMin.get(k) ?? 0) + len);
  }

  const firstWeek = weekStartOf(`${month}-01`);
  for (const [id, h] of Object.entries(carryIn)) {
    if (!byId.has(id)) throw new CalcError(`carryIn に不明なスタッフがいます: ${id}`);
    if (typeof h !== 'number' || !(h >= 0)) throw new CalcError('carryIn は0以上の時間(数値)です');
    const k = `${id}|${firstWeek}`;
    weekMin.set(k, (weekMin.get(k) ?? 0) + Math.round(h * 60));
  }

  const weekly = [];
  const overLimit = [];
  for (const [k, min] of weekMin) {
    const [staffId, weekStart] = k.split('|');
    const st = byId.get(staffId);
    const hours = round(min / 60, 2);
    const limit = st.weeklyLimit ?? null;
    weekly.push({ staffId, name: st.name, weekStart, hours, limit });
    if (limit != null && min > limit * 60) overLimit.push({ staffId, name: st.name, weekStart, hours, limit });
  }
  const order = (a, b) => a.weekStart.localeCompare(b.weekStart) || a.staffId.localeCompare(b.staffId);
  weekly.sort(order);
  overLimit.sort(order);

  const totalCost = Math.round(costYen);
  const rate = round(totalCost / revenue, 4);
  return { totalCost, revenue, rate, targetRate, diffPoints: round((rate - targetRate) * 100, 1), weekly, overLimit };
}
