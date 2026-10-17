// QR コード (ISO/IEC 18004) の最小実装。バイトモード・誤り訂正 M・バージョン 1〜10 だけ。
// 住民リンク (https://ドメイン/r/32文字, 約60バイト) を紙に刷るためのもので、依存は持たない。

// バージョンごとの [ブロックあたりの誤り訂正語数, [ブロック数, データ語数][]] (誤り訂正 M)
const BLOCKS_M: [number, [number, number][]][] = [
  [0, []], // 0 は使わない
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
];
const ALIGN: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
const MAX_VERSION = 10;
const ECL_M = 0b00; // 形式情報での M の値

export type QrMatrix = boolean[][]; // [y][x], true が黒

const dataCapacity = (v: number) => BLOCKS_M[v][1].reduce((s, [n, d]) => s + n * d, 0);

// ---- GF(256) とリードソロモン ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g; // 先頭が最高次 (=1)
}

export function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// ---- データ語の組み立て ----
function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4); // バイトモード
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capBits = dataCapacity(version) * 8;
  put(0, Math.min(4, capBits - bits.length)); // 終端
  while (bits.length % 8) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; words.length < dataCapacity(version); pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

function interleave(data: number[], version: number): number[] {
  const [ecLen, groups] = BLOCKS_M[version];
  const blocks: number[][] = [];
  let off = 0;
  for (const [n, d] of groups) for (let i = 0; i < n; i++) blocks.push(data.slice(off, (off += d)));
  const ecs = blocks.map((b) => rsRemainder(b, ecLen));
  const out: number[] = [];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

// ---- 配置 ----
function bch(value: number, poly: number, polyBits: number): number {
  let v = value << (polyBits - 1);
  for (let i = 31 - Math.clz32(v); i >= polyBits - 1; i--) if ((v >>> i) & 1) v ^= poly << (i - (polyBits - 1));
  return (value << (polyBits - 1)) | v;
}
export const formatBits = (mask: number) => bch((ECL_M << 3) | mask, 0x537, 11) ^ 0x5412;
const versionBits = (v: number) => bch(v, 0x1f25, 13);

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  readonly version: number;
  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }
  set(x: number, y: number, d: boolean) {
    this.dark[y][x] = d;
    this.fixed[y][x] = true;
  }
  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          this.set(x, y, d !== 2 && d !== 4);
        }
    }
    const al = ALIGN[this.version];
    for (const ay of al)
      for (const ax of al) {
        if ((ax === 6 && ay === 6) || (ax === 6 && ay === al.at(-1)) || (ax === al.at(-1) && ay === 6)) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) this.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    this.drawFormat(0); // 場所の予約。マスク決定後に描き直す
    if (this.version >= 7) {
      const bits = versionBits(this.version);
      for (let i = 0; i < 18; i++) {
        const d = ((bits >>> i) & 1) === 1;
        const a = n - 11 + (i % 3), b = Math.floor(i / 3);
        this.set(a, b, d);
        this.set(b, a, d);
      }
    }
  }
  drawFormat(mask: number) {
    const bits = formatBits(mask);
    const n = this.size;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i));
    this.set(8, n - 8, true); // 常に黒のモジュール
  }
  placeCodewords(words: number[]) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (this.fixed[y][x] || i >= words.length * 8) continue;
          this.dark[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
  applyMask(mask: number) {
    const f = MASKS[mask];
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) if (!this.fixed[y][x] && f(x, y)) this.dark[y][x] = !this.dark[y][x];
  }
}

export function penalty(m: QrMatrix): number {
  const n = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) s += run - 2;
        run = 1;
      }
    }
    // 1:1:3:1:1 のパターン (前後どちらかに 4 つの白)
    const seq = Array.from({ length: n }, (_, i) => get(i));
    const pat = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= n; i++) {
      if (!pat.every((p, k) => seq[i + k] === p)) continue;
      const lightBefore = i >= 4 && seq.slice(i - 4, i).every((v) => !v);
      const lightAfter = i + 11 <= n && seq.slice(i + 7, i + 11).every((v) => !v);
      if (lightBefore || lightAfter) s += 40;
    }
    return s;
  };
  for (let y = 0; y < n; y++) score += line((x) => m[y][x]);
  for (let x = 0; x < n; x++) score += line((y) => m[y][x]);
  for (let y = 0; y + 1 < n; y++)
    for (let x = 0; x + 1 < n; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

/** 文字列を QR の行列にする。入りきらないときは例外。 */
export function encodeQr(text: string): { version: number; mask: number; matrix: QrMatrix } {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= MAX_VERSION && 4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCapacity(version) * 8) version++;
  if (version > MAX_VERSION) throw new Error(`QR に入りきりません (${bytes.length} バイト)`);
  const words = interleave(encodeData(bytes, version), version);

  let best: { mask: number; matrix: QrMatrix; score: number } | undefined;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(version);
    g.drawFunctionPatterns();
    g.placeCodewords(words);
    g.applyMask(mask);
    g.drawFormat(mask);
    const score = penalty(g.dark);
    if (!best || score < best.score) best = { mask, matrix: g.dark, score };
  }
  return { version, mask: best!.mask, matrix: best!.matrix };
}

/** SVG にする。大きさは viewBox だけで、紙の上の寸法は CSS で決める。四方に 4 モジュールの白い余白を含む。 */
export function qrSvg(text: string): string {
  const { matrix } = encodeQr(text);
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  let d = "";
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      d += `M${x + quiet} ${y + quiet}h${w}v1h-${w}z`;
      x += w - 1;
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
  );
}
