// 田中さんの実 API の形 → 画面内部の形への変換(DOMに触れない)
const CODE = { '未着': 'not_arrived', '受取済': 'received', '次へ渡した': 'passed', '不在で保留': 'on_hold' };
export const JA = Object.fromEntries(Object.entries(CODE).map(([ja, c]) => [c, ja]));

export const adaptList = (list) =>
  list.map((c) => ({ ...c, importance: c.importance === '重要' ? 'important' : 'normal' }));

export function adaptDetail(d) {
  return {
    id: d.id, title: d.title, completed: d.completed,
    importance: d.importance === '重要' ? 'important' : 'normal',
    groups: d.groups.map((g) => ({
      group: g.group, name: g.groupName, done: g.done,
      doneCount: g.completedCount, totalCount: g.total,
      // 完了した班は日数を使わず「完了」と出すため current を持たせない
      current: g.done || !g.current ? null : {
        house: g.current.id, houseName: g.current.name, mode: g.current.mode,
        status: CODE[g.status], stayDays: g.stayDays, holdDays: g.holdDays ?? undefined,
        receiptMissing: g.receiptMissing,
      },
    })),
  };
}

export const adaptGroups = (gs) => gs.map((g) => ({ group: g.id, name: g.name, leaders: g.leaders }));
