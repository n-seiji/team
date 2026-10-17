import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptDetail, adaptList, JA } from '../web/adapt.js';
import { isStale } from '../web/logic.js';

const g = (o) => ({ group: 'g3', groupName: '3班', current: { id: 'g3-05', name: '木村家(進)', mode: 'paper' }, status: '不在で保留', stayDays: 5, holdDays: 5, receiptMissing: false, completedCount: 4, total: 15, done: false, ...o });

test('日本語の状態を内部コードに変換し、往復できる', () => {
  const d = adaptDetail({ id: 'c1', title: 't', importance: '重要', completed: false, groups: [g()] });
  assert.equal(d.importance, 'important');
  const cur = d.groups[0].current;
  assert.equal(cur.status, 'on_hold');
  assert.equal(JA[cur.status], '不在で保留');
  assert.equal(cur.house, 'g3-05');
  assert.equal(isStale(cur), true);
});
test('完了した班は current なし(日数を使わず「完了」)', () => {
  const d = adaptDetail({ id: 'c1', title: 't', importance: '通常', completed: true, groups: [g({ done: true, status: '次へ渡した', stayDays: 10, completedCount: 15 })] });
  assert.equal(d.groups[0].current, null);
  assert.equal(d.groups[0].doneCount, 15);
});
test('一覧の重要度を変換する', () => {
  assert.deepEqual(adaptList([{ id: 'a', importance: '通常' }, { id: 'b', importance: '重要' }]).map((c) => c.importance), ['normal', 'important']);
});
