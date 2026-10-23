// Sessions that work on the same repository (git worktrees of one repo, via `init --workspace`) cannot see
// each other's conversations, so they can pick the same migration number or edit the same file. This module
// compares what each session has changed.
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { SessionState } from "./types.ts";
import { gitChanges } from "./prompt.ts";
import type { Store } from "./store.ts";

export interface SessionChanges {
  session: string;
  files: string[];
}

export interface Overlap {
  kind: "same-file" | "same-number";
  /** The shared path, or `<dir>/<number>_*` for a numbered-file clash. */
  key: string;
  sessions: { session: string; file: string }[];
}

function repoId(dir: string): string | null {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** Changes of every session (including `s` itself) whose workspace is a checkout of the same repository as `s`. */
export function sameRepoChanges(store: Store, s: SessionState): SessionChanges[] {
  if (!s.externalWorkspace) return [];
  const mine = repoId(path.resolve(store.root, s.workspace));
  if (!mine) return [];
  const out: SessionChanges[] = [];
  for (const name of store.list()) {
    const other = name === s.name ? s : store.load(name).state;
    if (!other.externalWorkspace) continue;
    const dir = path.resolve(store.root, other.workspace);
    if (repoId(dir) !== mine) continue;
    out.push({ session: name, files: gitChanges(dir) ?? [] });
  }
  return out;
}

/** One line per other session, for the engineers' prompt. */
export function otherSessionChanges(store: Store, s: SessionState, maxFiles = 30): string[] {
  return sameRepoChanges(store, s)
    .filter((c) => c.session !== s.name && c.files.length)
    .map((c) => {
      const more = c.files.length > maxFiles ? ` (+${c.files.length - maxFiles} more)` : "";
      return `${c.session}: ${c.files.slice(0, maxFiles).join(", ")}${more}`;
    });
}

/** Files changed by more than one session, and numbered files (e.g. migrations/0021_*.sql) sharing a number. */
export function findOverlaps(changes: SessionChanges[]): Overlap[] {
  const byKey = new Map<string, Overlap>();
  const add = (kind: Overlap["kind"], key: string, session: string, file: string) => {
    const id = `${kind}:${key}`;
    const o = byKey.get(id) ?? { kind, key, sessions: [] };
    if (!o.sessions.some((x) => x.session === session && x.file === file)) o.sessions.push({ session, file });
    byKey.set(id, o);
  };
  for (const c of changes) {
    for (const f of c.files) {
      add("same-file", f, c.session, f);
      const num = /^(\d{3,})[_-]/.exec(path.posix.basename(f));
      if (num) add("same-number", `${path.posix.dirname(f)}/${num[1]}_*`, c.session, f);
    }
  }
  return [...byKey.values()].filter((o) => {
    if (new Set(o.sessions.map((x) => x.session)).size < 2) return false;
    // A numbered clash on the very same file is already reported as same-file.
    return o.kind === "same-file" || new Set(o.sessions.map((x) => x.file)).size > 1;
  });
}

export function formatOverlap(o: Overlap): string {
  const who = o.sessions.map((x) => (o.kind === "same-file" ? x.session : `${x.session} (${x.file})`)).join(", ");
  return o.kind === "same-file" ? `same file ${o.key}: ${who}` : `same number ${o.key}: ${who}`;
}
