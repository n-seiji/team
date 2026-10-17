import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calc, CalcError } from '../src/calc.js';

const staff = [
  { id: 's1', name: '陳 美玲', wage: 1100, weeklyLimit: 28 },
  { id: 's2', name: '山田', wage: 1000 },
];
const sh = (date, staffId, start, end) => ({ date, staffId, start, end });

test('時給1,100円×5時間=5,500円', () => {
  const r = calc({ month: '2026-11', revenue: 100000, staff, shifts: [sh('2026-11-03', 's1', '13:00', '18:00')] });
  assert.equal(r.totalCost, 5500);
  assert.equal(r.rate, 0.055);
  assert.equal(r.targetRate, 0.3);
  assert.equal(r.diffPoints, -24.5);
});

test('目標超過は diffPoints が正', () => {
  const r = calc({ month: '2026-11', revenue: 10000, staff, shifts: [sh('2026-11-03', 's2', '09:00', '13:00')] });
  assert.equal(r.rate, 0.4);
  assert.equal(r.diffPoints, 10);
});

test('端数は合計の最後に1回だけ丸める', () => {
  // 1000円×20分=333.33 を3回 → 1000円。個別に丸めると999
  const r = calc({ month: '2026-11', revenue: 10000, staff, shifts: [
    sh('2026-11-02', 's2', '10:00', '10:20'), sh('2026-11-03', 's2', '10:00', '10:20'), sh('2026-11-04', 's2', '10:00', '10:20')] });
  assert.equal(r.totalCost, 1000);
});

test('週22時間に6時間追加で上限28h超過(週は月曜始まり)', () => {
  const shifts = [
    sh('2026-11-02', 's1', '09:00', '15:00'), sh('2026-11-03', 's1', '09:00', '15:00'),
    sh('2026-11-04', 's1', '09:00', '15:00'), sh('2026-11-05', 's1', '09:00', '13:00'), // 6+6+6+4=22
  ];
  assert.deepEqual(calc({ month: '2026-11', revenue: 1, staff, shifts }).overLimit, []);
  shifts.push(sh('2026-11-08', 's1', '10:00', '16:00')); // 日曜 +6 = 28 ちょうどは超過でない
  assert.deepEqual(calc({ month: '2026-11', revenue: 1, staff, shifts }).overLimit, []);
  shifts.push(sh('2026-11-06', 's1', '10:00', '10:30'));
  const r = calc({ month: '2026-11', revenue: 1, staff, shifts });
  assert.deepEqual(r.overLimit, [{ staffId: 's1', name: '陳 美玲', weekStart: '2026-11-02', hours: 28.5, limit: 28 }]);
});

test('日曜と翌月曜は別の週', () => {
  const shifts = [sh('2026-11-08', 's1', '08:00', '20:00'), sh('2026-11-09', 's1', '08:00', '20:00'),
    sh('2026-11-03', 's1', '08:00', '20:00')];
  assert.deepEqual(calc({ month: '2026-11', revenue: 1, staff, shifts }).overLimit, []);
  assert.equal(calc({ month: '2026-11', revenue: 1, staff, shifts }).weekly.length, 2);
});

test('上限未設定のスタッフは超過判定しない', () => {
  const shifts = [sh('2026-11-02', 's2', '00:00', '23:59'), sh('2026-11-03', 's2', '00:00', '23:59'),
    sh('2026-11-04', 's2', '00:00', '23:59')];
  assert.deepEqual(calc({ month: '2026-11', revenue: 1, staff, shifts }).overLimit, []);
});

test('carryIn は月初の週に加算される。なければ0', () => {
  // 2026-11-01 は日曜 → 月初の週は 10/26(月) 始まり
  const shifts = [sh('2026-11-01', 's1', '10:00', '18:00')];
  assert.equal(calc({ month: '2026-11', revenue: 1, staff, shifts }).overLimit.length, 0);
  const r = calc({ month: '2026-11', revenue: 1, staff, shifts, carryIn: { s1: 21 } });
  assert.deepEqual(r.overLimit, [{ staffId: 's1', name: '陳 美玲', weekStart: '2026-10-26', hours: 29, limit: 28 }]);
});

test('targetRate は指定でき、初期値は0.3', () => {
  const r = calc({ month: '2026-11', revenue: 10000, targetRate: 0.5, staff, shifts: [] });
  assert.equal(r.targetRate, 0.5);
  assert.equal(r.totalCost, 0);
});

test('不正入力は CalcError', () => {
  const bad = (over) => assert.throws(() => calc({ month: '2026-11', revenue: 1000, staff, shifts: [], ...over }), CalcError);
  bad({ shifts: [sh('2026-11-03', 's1', '18:00', '13:00')] });  // 日またぎ
  bad({ shifts: [sh('2026-11-03', 's1', '13:00', '13:00')] });  // 0分
  bad({ shifts: [sh('2026-11-03', 's1', '25:00', '26:00')] });  // 時刻
  bad({ shifts: [sh('2026-12-03', 's1', '10:00', '11:00')] });  // 月外
  bad({ shifts: [sh('2026-11-31', 's1', '10:00', '11:00')] });  // 存在しない日
  bad({ shifts: [sh('2026-11-03', 'zz', '10:00', '11:00')] });  // 不明スタッフ
  bad({ revenue: 0 });
  bad({ revenue: -5 });
  bad({ targetRate: 1.5 });
  bad({ month: '2026-13' });
  bad({ carryIn: { s1: -1 } });
});
