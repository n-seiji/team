// 実 API クライアント。mock-api.js と同じ形（差し替え可能）。
// 想定: POST /receipts, GET /receipts, GET /receipts/:id, PATCH /receipts/:id
export function createApi(base = '') {
  const j = async (res) => {
    if (!res.ok) {
      let msg = `サーバーエラー (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  };
  return {
    kind: 'real',
    base,
    list: () => fetch(`${base}/receipts`).then(j), // { receipts, needs_review_count }
    upload: (blob, name) => {
      const fd = new FormData();
      fd.append('image', blob, name);
      return fetch(`${base}/receipts`, { method: 'POST', body: fd }).then(j); // { id, status }
    },
    // fields 例: { amount: '1200' }。直した項目は要確認が消え、edited: true になる
    patch: (id, fields) =>
      fetch(`${base}/receipts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fields),
      }).then(j),
    imageUrl: (r) => r.image_url || `${base}/receipts/${r.id}/image`,
  };
}
