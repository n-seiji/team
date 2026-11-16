// One-line previews of free text (a brief, a verdict's reason) for the summaries that must stay short, and the one
// place that keeps what the team wrote from reaching a terminal as something to act on.

/** Ranges of code points a terminal draws two columns wide: Hangul Jamo, CJK and kana, Hangul syllables, full-width forms, CJK extensions. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];

/** Emoji drawn wide: those that are emoji by default, a symbol made one with the variation selector, and flags. */
const WIDE_EMOJI = /\p{Emoji_Presentation}|\ufe0f|\p{Regional_Indicator}/u;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The columns one character takes: a joined emoji sequence or a flag is one wide character. */
function columns(grapheme: string): number {
  const cp = grapheme.codePointAt(0)!;
  return WIDE.some(([from, to]) => cp >= from && cp <= to) || WIDE_EMOJI.test(grapheme) ? 2 : 1;
}

/** What a terminal acts on (control characters, escape sequences) and what reorders the text read (bidirectional controls, the Unicode line and paragraph separators). */
const UNSAFE = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

const REPLACED_BY: Readonly<Record<string, string>> = { "\n": "\n", "\t": " ", "\u2028": "\n", "\u2029": "\n" };

/** `text` without what could disturb a terminal. Line breaks stay (the Unicode ones become `\n`), a tab becomes a space, the rest goes. */
export function stripControls(text: string): string {
  return text.replace(UNSAFE, (c) => REPLACED_BY[c] ?? "");
}

/**
 * `text` on one line, no wider than `maxWidth` columns, and safe to print. Whitespace (line breaks included) becomes single
 * spaces, and a longer text ends with "…" in the last column. It is cut between characters, never inside a surrogate pair or an emoji sequence.
 */
export function shorten(text: string, maxWidth: number): string {
  const flat = stripControls(text).replace(/\s+/g, " ").trim();
  const chars = Array.from(segmenter.segment(flat), (s) => s.segment);
  if (chars.reduce((sum, c) => sum + columns(c), 0) <= maxWidth) return flat;
  let kept = "";
  let used = 0;
  for (const c of chars) {
    if (used + columns(c) > maxWidth - 1) break;
    kept += c;
    used += columns(c);
  }
  return kept + "…";
}
