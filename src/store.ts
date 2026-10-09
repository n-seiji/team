// File-based persistence: .team/sessions/<name>/{state.json,transcript.jsonl,transcript.md}
// Plain files keep sessions inspectable, diffable and portable across OSes.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Entry, PersonaSpec, SessionState, TeamConfig } from "./types.ts";
import { World } from "./world.ts";
import { renderMarkdown } from "./render.ts";

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
    const f = path.join(this.sessionDir(name), "state.json");
    if (!fs.existsSync(f)) throw new Error(`session not found: ${name}`);
    return new World(JSON.parse(fs.readFileSync(f, "utf8")) as SessionState);
  }

  /** Persist state and append any newly emitted entries. Writes are atomic per file. */
  save(w: World): void {
    const dir = this.sessionDir(w.state.name);
    fs.mkdirSync(dir, { recursive: true });
    if (w.emitted.length) {
      fs.appendFileSync(path.join(dir, "transcript.jsonl"), w.emitted.map((e) => JSON.stringify(e)).join("\n") + "\n");
      w.emitted.length = 0;
    }
    writeAtomic(path.join(dir, "state.json"), JSON.stringify(w.state, null, 2) + "\n");
    writeAtomic(path.join(dir, "transcript.md"), renderMarkdown(w.state, this.transcript(w.state.name)));
  }

  transcript(name = this.current()): Entry[] {
    const f = path.join(this.sessionDir(name), "transcript.jsonl");
    if (!fs.existsSync(f)) return [];
    return fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Entry);
  }

  list(): string[] {
    const d = path.join(this.teamDir, "sessions");
    return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => this.exists(n)) : [];
  }
}

function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function loadConfig(root: string, file = "team.config.json"): TeamConfig {
  const f = path.resolve(root, file);
  if (!fs.existsSync(f)) throw new Error(`config not found: ${f}`);
  return JSON.parse(fs.readFileSync(f, "utf8")) as TeamConfig;
}

export function loadPersona(root: string, file: string): PersonaSpec {
  const f = path.resolve(root, file);
  const spec = JSON.parse(fs.readFileSync(f, "utf8")) as PersonaSpec;
  if (!spec.id || !spec.role || !spec.persona?.name) {
    throw new Error(`${file}: persona needs "id", "role" and "persona.name"`);
  }
  return spec;
}
