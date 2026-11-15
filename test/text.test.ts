import { test } from "node:test";
import assert from "node:assert/strict";
import { shorten, stripControls } from "../src/text.ts";
import { isWellFormed } from "./well-formed.ts";

test("shorten joins line breaks and runs of spaces into single spaces", () => {
  assert.equal(shorten("  one\n\ntwo \t three  ", 80), "one two three");
});

test("shorten leaves a text that fits as it is", () => {
  assert.equal(shorten("abcde", 5), "abcde");
});

test("shorten cuts a longer text so that the result, with its ellipsis, fits the width", () => {
  assert.equal(shorten("abcdefghij", 6), "abcde…");
});

test("shorten counts a full-width character as two columns", () => {
  assert.equal(shorten("あいうえお", 10), "あいうえお");
  assert.equal(shorten("あいうえおか", 10), "あいうえ…");
});

test("shorten never cuts a surrogate pair in half", () => {
  const cut = shorten("𠮷".repeat(10), 7);
  assert.equal(cut, "𠮷𠮷𠮷…");
  assert.ok(isWellFormed(cut));
});

test("shorten keeps a joined emoji sequence whole or leaves it out", () => {
  const family = "👨‍👩‍👧‍👦";
  const cut = shorten(family.repeat(4), 5);
  assert.ok(isWellFormed(cut));
  assert.equal(cut, `${family}${family}…`);
});

test("shorten gives back only the ellipsis when not even one character fits", () => {
  assert.equal(shorten("あいう", 2), "…");
});

test("shorten removes the control characters that could disturb a terminal and keeps the text around them", () => {
  assert.equal(shorten("a\u001b[31mred\u0007\u0085b\u007f", 80), "a[31mredb");
  assert.equal(shorten("a\r\nb\tc", 80), "a b c");
});

test("shorten removes the bidirectional controls that reorder what is shown", () => {
  assert.equal(shorten("abc\u202edef\u2066\u2069g\u200e\u200f\u061c", 80), "abcdefg");
});

test("shorten counts an emoji as two columns", () => {
  assert.equal(shorten("🎉".repeat(10), 7), "🎉🎉🎉…");
  assert.equal(shorten("🎉".repeat(3), 6), "🎉🎉🎉");
});

test("shorten counts a flag and an emoji with a variation selector as two columns, and a text-style symbol as one", () => {
  assert.equal(shorten("🇯🇵".repeat(5), 7), "🇯🇵🇯🇵🇯🇵…");
  assert.equal(shorten("❤️".repeat(5), 7), "❤️❤️❤️…");
  assert.equal(shorten("❤".repeat(8), 8), "❤".repeat(8));
  assert.equal(shorten("❤".repeat(9), 8), "❤".repeat(7) + "…");
});

test("stripControls keeps line breaks, turns a tab into a space, and removes the rest of what could disturb a terminal", () => {
  assert.equal(stripControls("a\r\nb\tc\u001b[0m\u202e d\u2028e"), "a\nb c[0m d\ne");
});

test("stripControls leaves a joined emoji sequence and ordinary text as they are", () => {
  assert.equal(stripControls("👨‍👩‍👧 割り勘 CLI"), "👨‍👩‍👧 割り勘 CLI");
});
