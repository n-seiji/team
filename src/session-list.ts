// The table `team sessions` prints: one line per session saying what it is, how it ended and when it was last worked on.
import * as path from "node:path";
import type { SessionState } from "./types.ts";
import type { Store } from "./store.ts";
import { currentPhase, latestVerdicts } from "./world.ts";
import { localParts } from "./local-time.ts";
import { shorten, stripControls } from "./text.ts";

const BRIEF_WIDTH = 50;

/**
 * One session as read from its folder. `name` is the folder's name, which is what `team use` and `--session` take,
 * whatever the state says: a copied folder holds the name of the one it was copied from.
 */
type SessionRow = Readonly<{ name: string; state: SessionState; lastAt: string | undefined }> | Readonly<{ name: string; unreadable: string }>;

type Digest = Readonly<{
  name: string;
  status: string;
  phase: string;
  /** `2/2`: where it is of how many it may have. */
  iteration: string;
  /** What the users said in the last iteration; `-` while the session is running. */
  result: string;
  /** Local time of the last transcript entry, or of the session's creation when that cannot be read. */
  updated: string;
  brief: string;
}>;

/** The digest of one session's state. May throw on a state that is not one. */
function digest(name: string, s: SessionState, lastAt: string | undefined): Digest {
  const renamed = s.name === name ? "" : `(state.json says "${shorten(String(s.name), 30)}") `;
  return {
    name,
    status: String(s.status),
    phase: String(currentPhase(s).id),
    iteration: `${s.iteration}/${s.maxIterations}`,
    result: s.status === "done" ? verdictResult(s) : "-",
    updated: localTime(lastAt ?? s.createdAt),
    brief: renamed + shorten(s.brief, BRIEF_WIDTH),
  };
}

function verdictResult(s: SessionState): string {
  const verdicts = latestVerdicts(s, s.iteration);
  if (!verdicts.length) return "no verdict";
  return `${verdicts.filter((v) => v.verdict === "accept").length}/${verdicts.length} accepted`;
}

/** Local time, the one the person reads on their own clock (the transcript keeps UTC). */
function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const t = localParts(d);
  return `${t.year}-${t.month}-${t.day} ${t.hour}:${t.minute}`;
}

/**
 * Reads every session's state and when it was last worked on. A session whose state cannot be read becomes a row of its
 * own, so it never takes the list down with it; a time that cannot be read only leaves its date to the session's creation.
 */
export function readSessionRows(store: Store): readonly SessionRow[] {
  return store.list().map((name): SessionRow => {
    try {
      return { name, state: store.readState(name), lastAt: store.lastActivity(name) };
    } catch (e) {
      return { name, unreadable: shorten((e as Error).message.replace(store.sessionDir(name) + path.sep, ""), 100) };
    }
  });
}

const HEADER = ["NAME", "STATUS", "PHASE", "ITER", "RESULT", "UPDATED"] as const;

/** A row as a digest, or the reason it cannot be one (it is no state, or not one this program wrote). */
function digestOf(row: SessionRow): Digest | Readonly<{ name: string; reason: string }> {
  if ("unreadable" in row) return { name: row.name, reason: row.unreadable };
  try {
    return digest(row.name, row.state, row.lastAt);
  } catch (e) {
    return { name: row.name, reason: shorten((e as Error).message, 100) };
  }
}

/** The table, with `*` before the current session. Only the brief, which comes last, may be wider than its column. */
export function formatSessionList(rows: readonly SessionRow[], current: string): string {
  if (!rows.length) return 'no sessions yet. Start one with: team init "<what to build>"';
  const lines = rows.map(digestOf);
  const cells = (d: Digest) => [d.name, d.status, d.phase, d.iteration, d.result, d.updated];
  const digests = lines.filter((l): l is Digest => !("reason" in l)).map(cells);
  const widths = HEADER.map((h, c) => Math.max(h.length, ...(c === 0 ? lines.map((l) => l.name.length) : digests.map((r) => r[c].length))));
  const pad = (values: readonly string[]) => values.map((v, c) => v.padEnd(widths[c])).join("  ");
  const table = [
    `  ${pad(HEADER)}  BRIEF`,
    ...lines.map((l) => {
      const mark = l.name === current ? "*" : " ";
      return "reason" in l ? `${mark} ${l.name.padEnd(widths[0])}  (unreadable: ${l.reason})` : `${mark} ${pad(cells(l))}  ${l.brief}`;
    }),
  ];
  return stripControls(table.join("\n"));
}
