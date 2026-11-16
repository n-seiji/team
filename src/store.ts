// File-based persistence: .team/sessions/<name>/{state.json,transcript.jsonl,usage.jsonl,transcript.md,transcript.html}
// Plain files keep sessions inspectable, diffable and portable across OSes.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Entry, PersonaSpec, SessionState, TeamConfig, TurnUsage } from "./types.ts";
import { World, answersByQuestion, assertPersona } from "./world.ts";
import { renderMarkdown } from "./render.ts";
import { renderHtml } from "./html.ts";
import { assertSessionName, isSessionName } from "./session-name.ts";

export class Store {
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  get teamDir(): string {
    return path.join(this.root, ".team");
  }

  /** The only place a session name becomes a path. */
  sessionDir(name: string): string {
    return path.join(this.teamDir, "sessions", assertSessionName(name));
  }

  /** Sessions are only looked for in the root itself, so a missing `.team` usually means the command ran in the wrong folder. */
  private requireTeamDir(): void {
    if (!fs.existsSync(this.teamDir)) {
      throw new Error(`no .team folder in ${this.root}. Run from the repository root or pass --root <dir>; to start a new session, run "team init".`);
    }
  }

  requireSession(name: string): void {
    this.requireTeamDir();
    if (!this.exists(name)) throw new Error(`session not found: ${name}. The existing ones are listed by "team sessions"; to start a new one, run "team init".`);
  }

  current(): string {
    this.requireTeamDir();
    const f = path.join(this.teamDir, "current");
    if (!fs.existsSync(f)) throw new Error('no session yet — run "team init" first');
    return fs.readFileSync(f, "utf8").trim();
  }

  setCurrent(name: string): void {
    fs.mkdirSync(this.teamDir, { recursive: true });
    fs.writeFileSync(path.join(this.teamDir, "current"), name + "\n");
  }

  exists(name: string): boolean {
    return fs.existsSync(path.join(this.sessionDir(name), "state.json"));
  }

  load(name = this.current()): World {
    this.requireSession(name);
    const w = new World(this.readState(name));
    // Answers live only in the transcript; the world needs to know which questions they settled.
    for (const id of answersByQuestion(this.transcript(name)).keys()) w.answered.add(id);
    return w;
  }

  /** A session's state alone, without the transcript that `load` reads along with it. */
  readState(name: string): SessionState {
    return readJson<SessionState>(path.join(this.sessionDir(name), "state.json"));
  }

  /**
   * When the session's last transcript entry was written. State has no such time, and file times say when a folder was
   * copied, not when it was worked on. Only the end of the file is read, so listing sessions does not parse every
   * transcript, and a line that is broken (or half written, while `run` appends) is passed over: a time that cannot
   * be read is `undefined`, never an error.
   */
  lastActivity(name: string): string | undefined {
    try {
      const { text, whole } = readTail(path.join(this.sessionDir(name), "transcript.jsonl"), TAIL_BYTES);
      const lines = text.split("\n");
      if (!whole) lines.shift(); // it starts in the middle of a line
      for (const line of lines.reverse()) {
        const at = parseEntryTime(line);
        if (at !== undefined) return at;
      }
    } catch {
      // no transcript (a session from before it existed), or one that cannot be opened: the session has no time of its own
    }
    return undefined;
  }

  /**
   * Persist state and append newly emitted entries. `entries` is the transcript the
   * caller already holds (before the emitted ones); pass it to avoid re-reading the file.
   * Does nothing when neither state nor transcript changed. Writes are atomic per file.
   */
  save(w: World, entries?: Entry[]): void {
    const dir = this.sessionDir(w.state.name);
    const stateFile = path.join(dir, "state.json");
    const json = JSON.stringify(w.state, null, 2) + "\n";
    if (!w.emitted.length && fs.existsSync(stateFile) && fs.readFileSync(stateFile, "utf8") === json) return;
    fs.mkdirSync(dir, { recursive: true });
    this.write(dir, w, entries ?? this.transcript(w.state.name));
  }

  /**
   * Save a new session, replacing any session of that name; whether that is allowed is for the caller to decide.
   * It is written to a folder of its own first (a dot name, so `list` never shows it) and swapped in only once all
   * of it is written, so a failure leaves the old session as it was.
   */
  create(w: World): void {
    const dir = this.sessionDir(w.state.name);
    const sessions = path.dirname(dir);
    fs.mkdirSync(sessions, { recursive: true });
    const fresh = fs.mkdtempSync(path.join(sessions, ".new-"));
    const old = `${fresh}.old`;
    let moved = false;
    try {
      this.write(fresh, w, []);
      if (fs.existsSync(dir)) {
        fs.renameSync(dir, old);
        moved = true;
      }
      fs.renameSync(fresh, dir);
    } catch (e) {
      fs.rmSync(fresh, { recursive: true, force: true });
      if (moved) fs.renameSync(old, dir);
      throw e;
    }
    fs.rmSync(old, { recursive: true, force: true });
  }

  /** Writes what changed into `dir`: the emitted entries are appended to the transcript, and `entries` is what was in it before. */
  private write(dir: string, w: World, entries: Entry[]): void {
    const all = entries.concat(w.emitted);
    if (w.emitted.length) {
      fs.appendFileSync(path.join(dir, "transcript.jsonl"), w.emitted.map((e) => JSON.stringify(e)).join("\n") + "\n");
      w.emitted.length = 0;
    }
    writeAtomic(path.join(dir, "state.json"), JSON.stringify(w.state, null, 2) + "\n");
    writeAtomic(path.join(dir, "transcript.md"), renderMarkdown(w.state, all));
    writeAtomic(path.join(dir, "transcript.html"), renderHtml(w.state, all));
  }

  transcript(name = this.current()): Entry[] {
    return readJsonLines<Entry>(path.join(this.sessionDir(name), "transcript.jsonl")) ?? [];
  }

  /**
   * Append one line per reply that was just recorded. Callers do this right after recording, never from `save`,
   * which also runs for `next` and `say` and would count a turn twice.
   */
  appendUsage(name: string, lines: readonly TurnUsage[]): void {
    if (!lines.length) return;
    fs.appendFileSync(path.join(this.sessionDir(name), "usage.jsonl"), lines.map((l) => JSON.stringify(l) + "\n").join(""));
  }

  /** null when the session never recorded usage (saved before it existed). */
  usage(name = this.current()): TurnUsage[] | null {
    // `run` may be appending while this reads, so the last line can be half written
    return readJsonLines<TurnUsage>(path.join(this.sessionDir(name), "usage.jsonl"), { skipUnfinishedLastLine: true });
  }

  list(): string[] {
    this.requireTeamDir();
    const d = path.join(this.teamDir, "sessions");
    // what else is in the folder (.DS_Store, a half-written new session) must not stop anything
    return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => isSessionName(n) && this.exists(n)) : [];
  }
}

/** How much of the end of a transcript is looked at for the time of its last entry. */
const TAIL_BYTES = 64 * 1024;

/** The last `bytes` bytes of a file as text, and whether that is all of it. */
function readTail(file: string, bytes: number): Readonly<{ text: string; whole: boolean }> {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, size - length);
    return { text: buffer.subarray(0, read).toString("utf8"), whole: length === size };
  } finally {
    fs.closeSync(fd);
  }
}

/** The `at` of one transcript line, if the line is a whole entry that has one. */
function parseEntryTime(line: string): string | undefined {
  try {
    const at = (JSON.parse(line) as Partial<Entry> | null)?.at;
    return typeof at === "string" ? at : undefined;
  } catch {
    return undefined; // an empty, broken or half written line
  }
}

function readJsonLines<T>(file: string, { skipUnfinishedLastLine = false } = {}): T[] | null {
  if (!fs.existsSync(file)) return null;
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const parsed: T[] = [];
  lines.forEach((l, i) => {
    try {
      parsed.push(JSON.parse(l) as T);
    } catch (e) {
      if (!(skipUnfinishedLastLine && i === lines.length - 1)) throw e;
    }
  });
  return parsed;
}

function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string, missing = `file not found: ${file}`): T {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error(missing);
    throw e;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // the parser's message alone does not say which of the files is broken
    throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
  }
}

export function loadConfig(root: string, file = "team.config.json"): TeamConfig {
  const f = path.resolve(root, file);
  return readJson<TeamConfig>(f, `config not found: ${f}`);
}

export function loadPersona(root: string, file: string): PersonaSpec {
  const f = path.resolve(root, file);
  const spec = readJson<PersonaSpec>(f, `persona not found: ${f}`);
  assertPersona(spec, file);
  return spec;
}
