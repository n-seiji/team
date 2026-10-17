// 表示ロジック(DOMに触れない。node:test で検証する)
export const STATUS = {
  not_arrived: '未着',
  received: '受取済',
  passed: '次へ渡した',
  on_hold: '不在で保留',
};
export const STALE_DAYS = 3;

export const isStale = (cur) => cur != null && cur.stayDays >= STALE_DAYS && cur.status !== 'passed';
export const modeLabel = (mode) => (mode === 'paper' ? '紙' : 'デジタル');

// 日数の表記。断言を避け「記録から」と添える。保留は「保留◯日目」。
export function stayText(cur) {
  if (!cur) return '—';
  if (cur.status === 'on_hold') return `保留${cur.holdDays ?? cur.stayDays}日目`;
  return `記録から${cur.stayDays}日`;
}

// 受取の記録がないまま3日たった家
export const noReceipt = (cur) => cur != null && cur.status === 'not_arrived' && cur.stayDays >= STALE_DAYS;

// 現在の状態に対して押せるボタン(自分の班)
export function actionsFor(status) {
  const all = ['received', 'passed', 'on_hold'];
  return all.map((s) => ({ status: s, label: STATUS[s], current: s === status }));
}

// 重要で未完了の回覧数
export const pendingImportant = (circulars) =>
  circulars.filter((c) => c.importance === 'important' && !c.completed).length;

// 班の完了状況の文字(「受取済」になった家 / 全家)
export const progressText = (g) => `${g.doneCount}/${g.totalCount}軒`;

// 並び順: 滞留している班を上に。同じなら班番号順。
export function sortGroups(groups) {
  return [...groups].sort((a, b) => {
    const sa = isStale(a.current) ? 1 : 0, sb = isStale(b.current) ? 1 : 0;
    return sb - sa || String(a.group).localeCompare(String(b.group), undefined, { numeric: true });
  });
}
