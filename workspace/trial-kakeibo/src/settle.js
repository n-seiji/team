import { splitAmount } from './split.js';

// 対象の記録（家庭・未削除・未精算）から、メンバーごとの収支（+は受け取る側）を出す。
export function computeBalances(entries) {
  const balances = {};
  const add = (id, n) => {
    balances[id] = (balances[id] ?? 0) + n;
  };
  for (const e of entries) {
    add(e.payerId, e.amount);
    for (const [id, share] of Object.entries(splitAmount(e.amount, e.participantIds))) {
      add(id, -share);
    }
  }
  return balances;
}

export const EXACT_LIMIT = 6;

// 収支から「誰が誰にいくら」を出す。
// 収支が0でない人が6人以下なら、全探索で渡す回数が厳密に最小。7人以上は貪欲法（approximate: true）。
export function settle(balances) {
  const people = Object.entries(balances)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const approximate = people.length > EXACT_LIMIT;
  const groups = approximate ? [people] : bestPartition(people);
  const transfers = groups.flatMap(matchGroup);
  return { transfers, approximate };
}

// 合計0のグループに最大個数で分ける。k人のグループは k-1 回で済むので、グループ数が多いほど回数が減る。
function bestPartition(people) {
  const n = people.length;
  const sum = (mask) => people.reduce((s, [, v], i) => (mask & (1 << i) ? s + v : s), 0);
  const memo = new Map([[0, []]]);
  const solve = (mask) => {
    if (memo.has(mask)) return memo.get(mask);
    const low = mask & -mask;
    let best = null;
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if (!(sub & low) || sum(sub) !== 0) continue;
      const rest = solve(mask ^ sub);
      if (rest && (!best || rest.length + 1 > best.length)) best = [sub, ...rest];
    }
    memo.set(mask, best);
    return best;
  };
  const masks = solve((1 << n) - 1) ?? [];
  return masks.map((m) => people.filter((_, i) => m & (1 << i)));
}

// 1グループ内で、残額の大きい債務者から債権者へ順に渡す（毎回少なくとも1人が0になる）。
function matchGroup(group) {
  const debtors = group.filter(([, v]) => v < 0).map(([id, v]) => ({ id, left: -v }));
  const creditors = group.filter(([, v]) => v > 0).map(([id, v]) => ({ id, left: v }));
  const byLeft = (a, b) => b.left - a.left || (a.id < b.id ? -1 : 1);
  const out = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byLeft);
    creditors.sort(byLeft);
    const d = debtors[0];
    const c = creditors[0];
    const amount = Math.min(d.left, c.left);
    out.push({ from: d.id, to: c.id, amount });
    d.left -= amount;
    c.left -= amount;
    if (d.left === 0) debtors.shift();
    if (c.left === 0) creditors.shift();
  }
  return out;
}
