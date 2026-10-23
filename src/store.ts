// File-based persistence: .team/sessions/<name>/{state.json,transcript.jsonl,usage.jsonl,transcript.md,transcript.html}
// Plain files keep sessions inspectable, diffable and portable across OSes.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Entry, PersonaSpec, SessionState, TeamConfig, TurnUsage } from "./types.ts";
import { World, assertPersona } from "./world.ts";
import { renderMarkdown } from "./render.ts";
import { renderHtml } from "./html.ts";

export class Store {
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  get teamDir(): string {
    return path.join(this.root, ".team");
  }

  sessionDir(name: string): string {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`invalid session name: ${name}`);
    return path.join(this.teamDir, "sessions", name);
  }

  current(): string {
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
    return new World(readJson<SessionState>(path.join(this.sessionDir(name), "state.json"), `session not found: ${name}`));
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
    const all = (entries ?? this.transcript(w.state.name)).concat(w.emitted);
    if (w.emitted.length) {
      fs.appendFileSync(path.join(dir, "transcript.jsonl"), w.emitted.map((e) => JSON.stringify(e)).join("\n") + "\n");
      w.emitted.length = 0;
    }
    writeAtomic(stateFile, json);
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
    const d = path.join(this.teamDir, "sessions");
    return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => this.exists(n)) : [];
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

function readJson<T>(file: string, missing: string): T {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error(missing);
    throw e;
  }
  return JSON.parse(text) as T;
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
