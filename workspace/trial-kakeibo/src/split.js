// 割り勘。円単位で均等に割り、余りは人物IDの昇順で先頭から1円ずつ足す。
// 同じ入力なら必ず同じ結果で、合計は必ず amount に一致する。
export function splitAmount(amount, participantIds) {
  const ids = [...new Set(participantIds)].sort();
  const base = Math.floor(amount / ids.length);
  const rest = amount - base * ids.length;
  const shares = {};
  ids.forEach((id, i) => {
    shares[id] = base + (i < rest ? 1 : 0);
  });
  return shares;
}
