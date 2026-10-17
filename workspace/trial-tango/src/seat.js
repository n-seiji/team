// テスト開始画面の組・出席番号。チェックは tango.js の checkKumi / checkNo (集計と同じ文言)。
// 進捗 (progress.js) とは別のキーに置く。
import { checkKumi, checkNo } from './tango.js';

const SEAT_KEY = 'trial-tango:seat:v1';

export function loadSeat(storage) {
  try {
    const s = JSON.parse(storage.getItem(SEAT_KEY));
    return { kumi: String(s?.kumi ?? ''), no: String(s?.no ?? '') };
  } catch { return { kumi: '', no: '' }; }
}

export function saveSeat(storage, { kumi, no }) {
  try { storage.setItem(SEAT_KEY, JSON.stringify({ kumi, no: String(no) })); return true; } catch { return false; }
}

// 欄ごとの問題を返す。errors が空なら始められる
export function checkSeat(kumi, no) {
  const k = checkKumi(kumi);
  const n = checkNo(no);
  const errors = {};
  if (!k.ok) errors.kumi = k.reason;
  if (!n.ok) errors.no = n.reason;
  return { ok: k.ok && n.ok, kumi: k.value, no: n.value, errors };
}
