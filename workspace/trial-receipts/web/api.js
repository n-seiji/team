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
    // month 'YYYY-MM' を付けるとその月だけ。{ receipts, needs_review_count(全体), total, total_note, undated_count }
    list: (month = '') => fetch(`${base}/receipts${month ? `?month=${month}` : ''}`).then(j),
    csvUrl: (month = '') => `${base}/export.csv${month ? `?month=${month}` : ''}`,
    // body は画像のバイト列そのもの（multipart ではない）。Content-Type で形式を伝える
    upload: (blob) =>
      fetch(`${base}/receipts`, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'image/jpeg' },
        body: blob,
      }).then(j), // { id, status }
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
