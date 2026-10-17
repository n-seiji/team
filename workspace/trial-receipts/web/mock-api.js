// モック API。アダプタが入るまでの画面確認用。「デモ表示」バナーを必ず出すこと。
// 3パターンを順に返す: 全部空欄(未読み取り) / 金額だけ薄い / 全部読めた
const SAMPLES = [
  () => blank('未読み取り'),
  () => ({
    date: ok('2026-10-03', 0.93), amount: bad('', 0.21, '薄くて読めません'),
    payee: ok('ファミリーマート 新宿店', 0.88), category: ok('消耗品費', 0.8),
  }),
  () => ({
    date: ok('2026-10-05', 0.97), amount: ok('1480', 0.95),
    payee: ok('カフェ・ド・ベル', 0.9), category: ok('会議費', 0.85),
  }),
];
const ok = (value, confidence) => ({ value, confidence, needs_review: false, reason: '' });
const bad = (value, confidence, reason) => ({ value, confidence, needs_review: true, reason });
const blank = (reason) => ({
  date: bad('', 0, reason), amount: bad('', 0, reason), payee: bad('', 0, reason), category: bad('', 0, reason),
});

export function createMockApi({ delay = 1500 } = {}) {
  const items = [];
  let seq = 0;
  // 本物と同じく1枚ずつ順番に読む（queued → reading → done）
  const queue = [];
  let running = null;
  const pump = () => {
    if (running || !queue.length) return;
    running = queue.shift();
    running.status = 'reading';
    setTimeout(() => {
      const r = running;
      const s = SAMPLES[r.n % SAMPLES.length]();
      r.fields = Object.fromEntries(Object.keys(s).map((k) => [k, r.fields?.[k]?.edited ? r.fields[k] : s[k]]));
      r.status = 'done';
      running = null;
      pump();
    }, delay);
  };
  const position = (r) => queue.indexOf(r) + (running ? 1 : 0);
  const count = () =>
    items.filter((r) => r.status === 'done' && Object.values(r.fields).some((f) => f.needs_review)).length;
  return {
    kind: 'mock',
    list: async (month = '') => {
      const dateOf = (r) => r.fields?.date?.value || '';
      const rows = month ? items.filter((r) => dateOf(r).startsWith(month)) : items;
      const unconfirmed = rows.filter((r) => r.status !== 'done' || Object.values(r.fields).some((f) => f.needs_review)).length;
      return {
        receipts: rows.map(({ n, ...r }) => structuredClone(r.status === 'queued' ? { ...r, queue_position: position(items.find((x) => x.id === r.id)) } : r)),
        needs_review_count: count(),
        total: rows.reduce((s, r) => s + (Number(r.fields?.amount?.value) || 0), 0),
        total_note: unconfirmed ? `未確認が${unconfirmed}件あり、合計は確定ではありません` : '',
        undated_count: items.filter((r) => !dateOf(r)).length,
      };
    },
    csvUrl: () => null, // デモでは CSV を出さない（見本データを本物の表として保存させない）
    upload: async (blob) => {
      const n = seq++;
      const r = { id: `mock-${n + 1}`, n, status: 'queued', created_at: new Date().toISOString(), fields: null, edited: false, image_url: URL.createObjectURL(blob) };
      items.unshift(r);
      queue.push(r);
      pump();
      return { id: r.id, status: r.status };
    },
    patch: async (id, fields) => {
      const r = items.find((x) => x.id === id);
      if (!r) throw new Error('この領収書が見つかりません');
      r.fields ??= blank('未読み取り');
      for (const [k, v] of Object.entries(fields)) {
        r.fields[k] = { value: v, confidence: 1, needs_review: false, reason: '', edited: true };
      }
      r.edited = true;
      const { n, ...out } = r;
      return structuredClone(out);
    },
    imageUrl: (r) => r.image_url,
  };
}
