// Turn usage: reading token counts from API-shaped usage objects, adding usage up, and summing usage.jsonl lines for `team stats`.
import type { ReplyUsage, TokenUsage, TurnUsage } from "./types.ts";

/** A failed attempt that may still have cost something: `claude -p` reports tokens and cost on an `is_error` result too. */
export class ReplyError extends Error {
  usage?: ReplyUsage;

  constructor(message: string, usage?: ReplyUsage) {
    super(message);
    this.name = "ReplyError";
    this.usage = usage;
  }
}

const PARTS = ["input", "cacheWrite", "cacheRead", "output"] as const;
const PART_NAMES = { input: "input", cacheWrite: "cache write", cacheRead: "cache read", output: "output" } as const;
const SCALARS = ["costUsd", "durationMs", "modelCalls"] as const;

export function nonNegative(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Reads the `usage` object that both the Messages API and `claude -p --output-format json` return. */
export function tokensFromApi(usage: unknown): TokenUsage | undefined {
  if (typeof usage !== "object" || usage === null) return undefined;
  const u = usage as Record<string, unknown>;
  const tokens: TokenUsage = {};
  const read = (key: keyof TokenUsage, field: string) => {
    const n = nonNegative(u[field]);
    if (n !== undefined) tokens[key] = n;
  };
  read("input", "input_tokens");
  read("cacheWrite", "cache_creation_input_tokens");
  read("cacheRead", "cache_read_input_tokens");
  read("output", "output_tokens");
  return Object.keys(tokens).length > 0 ? tokens : undefined;
}

/** Adds counts key by key. A key that neither side has stays out, so a sum never invents a zero. */
function sumCounts<K extends string>(keys: readonly K[], a?: Partial<Record<K, number>>, b?: Partial<Record<K, number>>) {
  const sum: Partial<Record<K, number>> = {};
  for (const k of keys) {
    const x = a?.[k];
    const y = b?.[k];
    if (x !== undefined || y !== undefined) sum[k] = (x ?? 0) + (y ?? 0);
  }
  return Object.keys(sum).length > 0 ? sum : undefined;
}

/** What two attempts, or two turns, cost together. */
export function addUsage(a?: ReplyUsage, b?: ReplyUsage): ReplyUsage | undefined {
  const tokens = sumCounts(PARTS, a?.tokens, b?.tokens);
  const scalars = sumCounts(SCALARS, a, b);
  return tokens || scalars ? { ...scalars, ...(tokens && { tokens }) } : undefined;
}

/**
 * Totals for a group of turns. The `ReplyUsage` fields are summed over the turns that report them and left out when no turn did, so
 * a group nothing was measured for never shows a zero that looks like a measurement.
 */
export interface UsageTotals extends ReplyUsage {
  turns: number;
  skippedTurns: number;
  promptChars: number;
  replyChars: number;
  /** What orchestrators reported with `record --tokens`, over the turns that gave one. Not part of `tokens` and never added to it. */
  reportedTokens?: { total: number; turns: number };
  /** Turns whose backend measured no tokens; a host turn with only a reported number counts here. */
  turnsWithoutMeasuredTokens: number;
  turnsWithoutCost: number;
}

export interface UsageStats {
  total: UsageTotals;
  byPhase: Record<string, UsageTotals>;
  byRole: Record<string, UsageTotals>;
}

const emptyTotals = (): UsageTotals => ({
  turns: 0,
  skippedTurns: 0,
  promptChars: 0,
  replyChars: 0,
  turnsWithoutMeasuredTokens: 0,
  turnsWithoutCost: 0,
});

function add(t: UsageTotals, u: TurnUsage): void {
  t.turns++;
  if (u.skipped) t.skippedTurns++;
  t.promptChars += u.promptChars ?? 0;
  t.replyChars += u.replyChars;
  Object.assign(t, addUsage(t, u));
  if (u.tokens === undefined) t.turnsWithoutMeasuredTokens++;
  if (u.costUsd === undefined) t.turnsWithoutCost++;
  if (u.reportedTokens !== undefined) {
    t.reportedTokens = { total: (t.reportedTokens?.total ?? 0) + u.reportedTokens, turns: (t.reportedTokens?.turns ?? 0) + 1 };
  }
}

/** Groups appear in the order they first spoke. */
export function summarizeUsage(lines: readonly TurnUsage[]): UsageStats {
  const stats: UsageStats = { total: emptyTotals(), byPhase: {}, byRole: {} };
  for (const u of lines) {
    add(stats.total, u);
    add((stats.byPhase[u.phase] ??= emptyTotals()), u);
    add((stats.byRole[u.role] ??= emptyTotals()), u);
  }
  return stats;
}

const num = (n: number) => n.toLocaleString("en-US");
const count = (n: number, noun: string) => `${num(n)} ${noun}${n === 1 ? "" : "s"}`;
/** " (on 2 of 5 turns)" when only some of a group's turns have the figure, so a partial sum is not read as a full one. */
const coverage = (t: UsageTotals, without: number) => (without > 0 ? ` (on ${t.turns - without} of ${t.turns} turns)` : "");

function row(label: string, t: UsageTotals): string {
  const parts = PARTS.filter((k) => t.tokens?.[k] !== undefined).map((k) => `${PART_NAMES[k]} ${num(t.tokens![k]!)}`);
  const fields = [
    count(t.turns, "turn") + (t.skippedTurns > 0 ? ` (${t.skippedTurns} skipped)` : ""),
    `prompt ${num(t.promptChars)} chars`,
    `reply ${num(t.replyChars)} chars`,
    `tokens ${t.tokens ? parts.join(", ") + coverage(t, t.turnsWithoutMeasuredTokens) : "-"}`,
  ];
  if (t.reportedTokens) fields.push(`reported by orchestrator: ${num(t.reportedTokens.total)} over ${count(t.reportedTokens.turns, "turn")}`);
  fields.push(`cost ${t.costUsd === undefined ? "-" : `$${t.costUsd.toFixed(4)}` + coverage(t, t.turnsWithoutCost)}`);
  if (t.modelCalls !== undefined) fields.push(count(t.modelCalls, "model call"));
  if (t.durationMs !== undefined) fields.push(`${(t.durationMs / 1000).toFixed(1)}s`);
  return `${label}: ${fields.join(", ")}`;
}

export function formatStats(session: string, stats: UsageStats): string {
  const group = (title: string, g: Record<string, UsageTotals>) => [title, ...Object.entries(g).map(([k, t]) => "  " + row(k, t))];
  return [row(`session ${session}`, stats.total), ...group("by phase", stats.byPhase), ...group("by role", stats.byRole)].join("\n");
}
