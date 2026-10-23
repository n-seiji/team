import test from 'node:test';
import assert from 'node:assert/strict';
import { isStale, stayText, noReceipt, actionsFor, pendingImportant, sortGroups } from '../web/logic.js';

const cur = (o) => ({ house: 'x', status: 'received', stayDays: 0, ...o });

test('3日以上で滞留、2日は滞留でない', () => {
  assert.equal(isStale(cur({ stayDays: 3 })), true);
  assert.equal(isStale(cur({ stayDays: 2 })), false);
  assert.equal(isStale(null), false);
});
test('日数は「記録から」と添え、保留は日目で表す', () => {
  assert.equal(stayText(cur({ stayDays: 4 })), '記録から4日');
  assert.equal(stayText(cur({ status: 'on_hold', stayDays: 5, holdDays: 2 })), '保留2日目');
});
test('未着のまま3日で「受取の記録なし」', () => {
  assert.equal(noReceipt(cur({ status: 'not_arrived', stayDays: 3 })), true);
  assert.equal(noReceipt(cur({ status: 'received', stayDays: 9 })), false);
});
test('ボタンは3つで現在の状態が current', () => {
  const a = actionsFor('received');
  assert.deepEqual(a.map((x) => x.label), ['受取済', '次へ渡した', '不在で保留']);
  assert.deepEqual(a.map((x) => x.current), [true, false, false]);
});
test('重要で未完了だけ数える', () => {
  assert.equal(pendingImportant([
    { importance: 'important', completed: false },
    { importance: 'important', completed: true },
    { importance: 'normal', completed: false },
  ]), 1);
});
test('滞留班が上に来る', () => {
  const g = [{ group: 1, current: cur({ stayDays: 1 }) }, { group: 2, current: cur({ stayDays: 5 }) }];
  assert.deepEqual(sortGroups(g).map((x) => x.group), [2, 1]);
});
