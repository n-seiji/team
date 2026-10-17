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
  const count = () =>
    items.filter((r) => r.status === 'done' && Object.values(r.fields).some((f) => f.needs_review)).length;
  return {
    kind: 'mock',
    list: async () => ({ receipts: items.map((r) => structuredClone({ ...r, blob: undefined })), needs_review_count: count() }),
    upload: async (blob) => {
      const n = seq++;
      const r = { id: `mock-${n + 1}`, status: 'reading', fields: null, edited: false, image_url: URL.createObjectURL(blob) };
      items.push(r);
      setTimeout(() => { r.fields = SAMPLES[n % SAMPLES.length](); r.status = 'done'; }, delay);
      return { id: r.id, status: r.status };
    },
    patch: async (id, fields) => {
      const r = items.find((x) => x.id === id);
      if (!r || r.status !== 'done') throw new Error('この領収書はまだ直せません');
      for (const [k, v] of Object.entries(fields)) {
        r.fields[k] = { value: v, confidence: 1, needs_review: false, reason: '' };
      }
      r.edited = true;
      return structuredClone({ ...r });
    },
    imageUrl: (r) => r.image_url,
  };
}
