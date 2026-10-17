import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encodeQr, formatBits, qrSvg, rsRemainder } from "../src/qr.ts";

// 読み取り確認は開発用の jsqr で行う (実行時の依存ではない)。未インストールなら飛ばす
const jsQR = await import("jsqr").then((m) => m.default as any).catch(() => null);

function decode(text: string): string | null {
  const { matrix } = encodeQr(text);
  const scale = 4, quiet = 4;
  const size = (matrix.length + quiet * 2) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
    }),
  );
  return jsQR(px, size, size)?.data ?? null;
}

test("リードソロモン: 規格の例 (HELLO WORLD, 1-M) と一致する", () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsRemainder(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("形式情報: M・マスク0 は 101010000010010", () => {
  assert.equal(formatBits(0).toString(2).padStart(15, "0"), "101010000010010");
});

test("住民リンク (約60バイト) はバージョン5以下に入る", () => {
  const url = "https://kairan.example.jp/r/" + "A".repeat(32);
  const { version, matrix } = encodeQr(url);
  assert.ok(version <= 5, `v${version}`);
  assert.equal(matrix.length, version * 4 + 17);
});

test("SVG は viewBox だけを持ち、width/height を持たない", () => {
  const svg = qrSvg("https://kairan.example.jp/r/abc");
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.doesNotMatch(svg, /<svg[^>]*\s(width|height)=/);
});

test("入りきらない長さは例外", () => {
  assert.throws(() => encodeQr("x".repeat(300)), /入りきりません/);
});

test("生成した QR をデコーダーで読むと元の URL に戻る (バージョン1〜10)", { skip: !jsQR && "jsqr 未インストール (pnpm install)" }, () => {
  const samples = [
    "https://a.jp/r/x",
    "https://kairan.example.jp/r/9jB0xEHvu3dRAdYYrhVYenn2KRYUrQRc",
    "http://localhost:3456/r/" + "Zz-_09".repeat(6),
    "https://町内会.example.jp/r/abc", // 非 ASCII も UTF-8 のバイトで入る
  ];
  for (let len = 20; len <= 210; len += 7) samples.push("https://x.jp/r/" + "a".repeat(len - 15));
  for (const s of samples) assert.equal(decode(s), s, `読めない: ${s.length} 文字 v${encodeQr(s).version}`);
});

test("本物と同じ形のトークン 200 本がすべて読める (8種類のマスクを通る)", { skip: !jsQR && "jsqr 未インストール (pnpm install)" }, () => {
  const masks = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const url = `https://kairan.example.jp/r/${randomBytes(24).toString("base64url")}`;
    masks.add(encodeQr(url).mask);
    assert.equal(decode(url), url);
  }
  assert.equal(masks.size, 8);
});
