// 依存なしの QR コード生成（バイトモード・誤り訂正 M・型番 1〜10）。/start で LAN の URL を出すためだけの最小実装。
// 10 型・M で 213 バイトまで入る。URL（http://192.168.x.x:3000/ で 30 字ほど）には十分。
// 仕様: JIS X 0510 / ISO/IEC 18004。ブラウザでもサーバーでも動く（DOM に触れない）。

// 型番ごとの [誤り訂正の語数/ブロック, [ブロック数, データ語数], ...]（M のみ）
const EC_M = [
  null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const MAX_VERSION = 10;

const dataCapacity = (v) => EC_M[v].slice(1).reduce((s, [n, d]) => s + n * d, 0);

// ---- GF(256) と Reed-Solomon ----
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11d : 0); }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
    g = next;
  }
  return g;
}
function rsRemainder(data, n) {
  const g = rsGenerator(n);
  const r = new Array(n).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f);
  }
  return r;
}

// ---- データ語を作る ----
function codewords(bytes, v) {
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); // バイトモード
  put(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  const cap = dataCapacity(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  // ブロックに分けて誤り訂正語を付け、交互に並べる
  const [ec, ...groups] = EC_M[v];
  const blocks = [];
  let at = 0;
  for (const [n, d] of groups) for (let i = 0; i < n; i++) { const blk = data.slice(at, at += d); blocks.push({ blk, ecc: rsRemainder(blk, ec) }); }
  const out = [];
  const longest = Math.max(...blocks.map((b) => b.blk.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.blk.length) out.push(b.blk[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ecc[i]);
  return out;
}

// ---- 図形を置く ----
function bch(value, poly, polyBits) {
  let r = value << (polyBits - 1);
  for (let i = 31; i >= polyBits - 1; i--) if ((r >>> i) & 1) r ^= poly << (i - polyBits + 1);
  return r;
}
const formatBits = (mask) => ((0b00 << 3 | mask) << 10 | bch(0b00 << 3 | mask, 0x537, 11)) ^ 0x5412; // M = 00
const versionBits = (v) => (v << 12) | bch(v, 0x1f25, 13);

const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function build(v, words, mask) {
  const n = v * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fixed = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, on) => { m[r][c] = on; fixed[r][c] = true; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(rr, cc, d !== 2 && d !== 4);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al.at(-1)) || (r === al.at(-1) && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // 形式情報（2か所）と暗モジュール
  const f = formatBits(mask);
  const fb = (i) => ((f >>> i) & 1) === 1;
  for (let i = 0; i < 6; i++) set(i, 8, fb(i)); // 左上（縦）
  set(7, 8, fb(6)); set(8, 8, fb(7)); set(8, 7, fb(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, fb(i)); // 左上（横）
  for (let i = 0; i < 8; i++) set(8, n - 1 - i, fb(i)); // 右上
  for (let i = 8; i < 15; i++) set(n - 15 + i, 8, fb(i)); // 左下
  set(n - 8, 8, true);
  if (v >= 7) {
    const vb = versionBits(v);
    for (let i = 0; i < 18; i++) {
      const on = ((vb >>> i) & 1) === 1;
      const a = n - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, on); set(b, a, on);
    }
  }

  // データをジグザグに置き、マスクをかける
  let bit = 0;
  const total = words.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? n - 1 - k : k;
        if (fixed[r][c]) continue;
        let on = false;
        if (bit < total) on = ((words[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
        m[r][c] = on !== MASKS[mask](r, c);
      }
    }
  }
  return m;
}

// ---- マスクの評価（点数が低いものを選ぶ） ----
function penalty(m) {
  const n = m.length;
  let p = 0;
  const line = (get) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      for (let j = 0; j + 11 <= n; j++) {
        const s = Array.from({ length: 11 }, (_, k) => (get(i, j + k) ? 1 : 0)).join('');
        if (s === '10111010000' || s === '00001011101') p += 40;
      }
    }
  };
  line((i, j) => m[i][j]);
  line((i, j) => m[j][i]);
  for (let r = 0; r + 1 < n; r++) for (let c = 0; c + 1 < n; c++) {
    const x = m[r][c];
    if (x === m[r][c + 1] && x === m[r + 1][c] && x === m[r + 1][c + 1]) p += 3;
  }
  const dark = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

// 文字列 → 真偽値の正方行列（true が黒）。入りきらないときは例外。
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  while (v <= MAX_VERSION && bytes.length + (v < 10 ? 2 : 3) > dataCapacity(v)) v++;
  if (v > MAX_VERSION) throw new Error(`QR に入りきりません（${bytes.length}バイト）`);
  const words = codewords(bytes, v);
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = build(v, words, mask);
    const s = penalty(m);
    if (s < bestScore) { best = m; bestScore = s; }
  }
  return best;
}

// SVG 文字列（周囲に4モジュールの余白）。色は黒/白で固定（ダークモードでも読めるように）。
export function qrSvg(text, { label = text } = {}) {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let d = '';
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)} の QR コード"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
