// 進捗の保存。画面から分けた小さな関数。T3 (テストのやり直し) からは呼ばない。
// 「覚えた」は単語の key ごとに持つ。リストを入れ替えても減らさない。
const STORE_KEY = 'trial-tango:progress:v1';
const CODE_PREFIX = 'TT1.';

export function emptyProgress() {
  return { known: {}, pos: 0, listId: '' };
}

export function loadProgress(storage) {
  try {
    const raw = storage.getItem(STORE_KEY);
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw);
    return { known: p.known && typeof p.known === 'object' ? p.known : {}, pos: Number(p.pos) || 0, listId: String(p.listId || '') };
  } catch { return emptyProgress(); }
}

export function saveProgress(storage, p) {
  try { storage.setItem(STORE_KEY, JSON.stringify(p)); return true; } catch { return false; }
}

export function markKnown(p, key) {
  return { ...p, known: { ...p.known, [key]: 1 } };
}

export function countKnown(p) { return Object.keys(p.known).length; }

// 書き出し: 覚えた key の一覧だけ。位置は含めない (端末ごとのため)。
export function exportCode(p) {
  const json = JSON.stringify(Object.keys(p.known).sort());
  return CODE_PREFIX + toB64(json);
}

// 復元は足し合わせ。古いコードを貼っても減らない。
export function importCode(p, text) {
  const s = String(text || '').trim();
  if (!s.startsWith(CODE_PREFIX)) return { ok: false, reason: '進捗コードではないようです。「進捗をコピー」で控えたコードをそのまま貼ってください。' };
  let keys;
  try { keys = JSON.parse(fromB64(s.slice(CODE_PREFIX.length))); } catch { keys = null; }
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) {
    return { ok: false, reason: 'コードが途中で切れているようです。もう一度コピーして貼ってみてください。' };
  }
  const known = { ...p.known };
  let added = 0;
  for (const k of keys) if (!known[k]) { known[k] = 1; added++; }
  return { ok: true, added, progress: { ...p, known } };
}

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
