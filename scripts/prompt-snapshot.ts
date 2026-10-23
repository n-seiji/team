// Prompt snapshot gate: writes every prompt (system + user, as promptAsText) the engine builds for a fixed set of
// states into <outDir>. Run it before and after changing src/prompt.ts; `diff -r before after` must be empty.
//   node scripts/prompt-snapshot.ts <new outDir>
// Only meaningful as a before/after comparison on the same machine at the same time: part (b) reads the live
// .team/sessions, workspace/ and external git state, so the output is not a stored golden.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MockBackend } from "../src/backends/mock.ts";
import { main } from "../src/cli.ts";
import { otherSessionChanges } from "../src/overlap.ts";
import { buildPrompt, listWorkspace, promptAsText } from "../src/prompt.ts";
import { DEFAULT_PHASES } from "../src/sop.ts";
import { Store } from "../src/store.ts";
import { World } from "../src/world.ts";
import type { Entry, EntryKind, PersonaSpec, SessionState, Task, Trial, Verdict } from "../src/types.ts";

const repo = path.resolve(import.meta.dirname, "..");
const outDir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || (fs.existsSync(outDir) && fs.readdirSync(outDir).length)) throw new Error("usage: prompt-snapshot.ts <new outDir>");

let count = 0;
const put = (rel: string, text: string) => {
  const f = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  count++;
};
/** Every member's prompt in one state, as <dir>/<member>.md. */
const dump = (dir: string, s: SessionState, entries: Entry[], files: string[], others?: string[]) => {
  for (const m of s.members) put(`${dir}/${m.id}.md`, promptAsText(buildPrompt(s, m.id, entries, files, { others })));
};

// (a) every turn of a full `run --backend mock` session, as the backend receives it
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-snapshot-"));
fs.cpSync(path.join(repo, "personas"), path.join(tmp, "personas"), { recursive: true });
fs.copyFileSync(path.join(repo, "team.config.json"), path.join(tmp, "team.config.json"));
const respond = MockBackend.prototype.respond;
let turn = 0;
MockBackend.prototype.respond = function (p, ctx) {
  put(`mock-run/${String(++turn).padStart(3, "0")}-${p.member}.md`, promptAsText(p));
  return respond.call(this, p, ctx);
};
try {
  await main(["init", "--name", "snap", "--brief", "A product for sharing household expenses", "--root", tmp], () => {});
  await main(["run", "--backend", "mock", "--root", tmp], () => {});
} finally {
  MockBackend.prototype.respond = respond;
  fs.rmSync(tmp, { recursive: true, force: true });
}

// (b) the saved sessions (read-only): the final state, and the same data in every phase of every iteration
const store = new Store(repo);
for (const name of store.list()) {
  const { state } = store.load(name);
  const entries = store.transcript(name);
  const files = listWorkspace(state, repo);
  const others = otherSessionChanges(store, state);
  dump(`saved/${name}/final`, state, entries, files, others);
  for (let iteration = 1; iteration <= state.maxIterations; iteration++)
    state.phases.forEach((p, phaseIndex) =>
      dump(`saved/${name}/i${iteration}-${p.id}`, { ...state, iteration, phaseIndex }, entries, files, others),
    );
}

// (c) synthetic states for the branches the sessions above never reach
const person = (id: string, role: string, extra = {}): PersonaSpec => ({ id, role, persona: { name: id.toUpperCase(), ...extra } });
const base = World.create({
  name: "syn",
  brief: "Brief line one\nline two",
  maxIterations: 3,
  historyWindow: 4,
  phases: DEFAULT_PHASES,
  now: () => "T",
  members: [
    person("pm", "pm", { age: 41, style: "calm", beliefs: ["a"] }),
    person("e1", "engineer"),
    person("e2", "engineer"),
    person("u1", "user"),
    person("u2", "user"),
    person("qa", "qa"),
  ],
}).state;
const at = (phase: string, o: Partial<SessionState> = {}): SessionState => ({
  ...base,
  phaseIndex: DEFAULT_PHASES.findIndex((p) => p.id === phase),
  ...o,
});
const entry = (from: string, kind: EntryKind, text: string, o: Partial<Entry> = {}): Entry => ({
  turn: 1,
  at: "T",
  phase: "discovery",
  iteration: 1,
  from,
  kind,
  text,
  ...o,
});
const task = (id: string, status: Task["status"], o: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  acceptance: "- works",
  owner: "e1",
  status,
  createdBy: "pm",
  phase: "planning",
  iteration: 1,
  ...o,
});
const trial = (o: Partial<Trial> = {}): Trial => ({
  iteration: 1,
  command: "npm run verify",
  exitCode: 0,
  output: "journey: ok\n",
  artifacts: [],
  at: "T",
  ...o,
});
const verdict = (by: string, v: Verdict["verdict"], reason: string, iteration: number): Verdict => ({ by, verdict: v, reason, iteration });
const say = (from: string, n: number) => entry(from, "say", "あ".repeat(n), { to: ["all"] });

const chat = [
  entry("system", "system", 'Phase "discovery" started'), entry("pm", "think", "pm memo"), entry("pm", "say", "hello", { to: ["all"] }),
  entry("e1", "think", "e1 memo"), entry("u1", "say", "hi\nsecond line", { to: ["pm", "e1"] }), entry("e1", "note", "e1 note"),
  entry("pm", "task", "T1 owner=e1: Task T1"), entry("e1", "task_update", "T1 → done: ok"), entry("pm", "decision", "ship it"),
  entry("u1", "verdict", "REJECT: no"), entry("e1", "demo", "T1: run it"), entry("pm", "ask_human", "which one?", { to: ["human"] }),
  entry("e1", "verify", "npm test"), entry("pm", "advance", "done here"), entry("human", "say", "go on", { to: ["all"] }),
];
const backlog = [
  task("T1", "done", { summary: "did A", checks: ["try it on a phone", "print it\nand check A4"] }),
  task("T2", "blocked", { handoff: "needs a person", summary: "half built" }),
  task("T3", "dropped", { summary: "not needed" }),
  task("T4", "doing", { owner: undefined, acceptance: "" }),
  task("T5", "todo", { phase: "acceptance" }),
];
const decisions = [
  { by: "pm", text: "Use SQLite", phase: "planning", iteration: 1 },
  { by: "e1", text: "Late call\nsecond line", phase: "acceptance", iteration: 1 },
];
const demos = [
  { by: "e1", text: "T1: open /day\nthen 3 rows", phase: "review", iteration: 1 },
  { by: "ghost", text: "orphan demo", phase: "review", iteration: 1 },
  { by: "e2", text: "old demo", phase: "review", iteration: 0 },
];
const questions = [
  { by: "e1", text: "Which provider?\nDefault: Stripe.", phase: "planning", iteration: 1 },
  { by: "pm", text: "May we publish?", phase: "review", iteration: 1 },
];
const answer = (question: string, text: string) => entry("human", "say", `Answer to ${question}`, { answers: { question, text } });
const rejected = [
  verdict("u1", "accept", "fine", 1),
  verdict("u1", "reject", "changed my mind\nwith two lines", 1),
  verdict("u2", "accept", "ok", 1),
  verdict("ghost", "reject", "x", 1),
];
const streak = [
  verdict("u1", "reject", "a", 1),
  verdict("u2", "accept", "b", 1),
  verdict("u1", "reject", "c", 2),
  verdict("u2", "reject", "d", 2),
];
const { demos: _d, questions: _q, ...legacy } = at("acceptance");

const scenarios: Record<string, { s: SessionState; entries?: Entry[]; files?: string[]; others?: string[] }> = {
  "fresh": { s: base },
  "no-entries": { s: base, entries: [] },
  "older-omitted": { s: at("planning", { decisions, notes: { pm: ["n1", "n2"], e1: ["e1 note"] } }), entries: chat },
  "every-entry-kind": { s: at("review", { historyWindow: 40, tasks: backlog }), entries: chat, files: ["a.txt", "src/b.ts"] },
  "questions-open": { s: at("build", { questions }), entries: chat },
  "questions-mixed": { s: at("build", { questions }), entries: [...chat, answer("Q1", "Yes\nplease")] },
  "questions-answered": {
    s: at("build", { questions }),
    entries: [...chat, answer("Q1", "Yes"), answer("Q2", "no"), answer("Q1", "Yes, again")],
  },
  "trial-passed": { s: at("acceptance", { demos, trials: [trial({ artifacts: ["a/day.png", "a/verify.log"] })] }), entries: chat },
  "trial-failed": { s: at("acceptance", { trials: [trial({ exitCode: 1, output: " " })] }) },
  "trial-timed-out": { s: at("acceptance", { trials: [trial({ exitCode: null, timedOut: true, output: "partial" })] }) },
  "trial-no-command": { s: at("acceptance", { trials: [trial({ command: "", exitCode: null, output: "" })] }) },
  "trial-other-iteration": { s: at("acceptance", { iteration: 2, trials: [trial()], demos }) },
  "rejections": { s: at("planning", { iteration: 2, verdicts: rejected, tasks: backlog }), entries: chat },
  "rejections-streak": { s: at("planning", { iteration: 3, verdicts: streak }) },
  "rejections-not-at-iteration-start": { s: at("build", { iteration: 2, verdicts: rejected }) },
  "demos-in-review": { s: at("review", { demos }) },
  "demos-in-wrapup": { s: at("wrapup", { demos, tasks: backlog, decisions }) },
  "wrapup": { s: at("wrapup", { tasks: backlog, decisions, notes: { e1: ["x"] } }), entries: chat },
  "wrapup-empty": { s: at("wrapup") },
  "others": { s: at("build"), files: ["a.txt"], others: ["villa-58: db/0021_x.sql, src/b.ts (+3 more)", "villa-77: src/c.ts"] },
  "external-empty": { s: at("build", { externalWorkspace: true, workspace: "../repo" }) },
  "external-changes": {
    s: at("review", { externalWorkspace: true, workspace: "../repo" }),
    files: ["src/a.ts", "README.md"],
    others: ["villa-58: src/b.ts"],
  },
  "long-say": {
    s: at("build"),
    entries: [say("pm", 801), say("u1", 800), entry("e1", "think", "あ".repeat(900)), say("e2", 900), say("e2", 10)],
  },
  "legacy-state": { s: legacy, entries: chat },
  "english": { s: at("discovery", { language: "en" }), entries: chat },
};
for (const [name, { s, entries = [], files = [], others }] of Object.entries(scenarios))
  dump(`synthetic/${name}`, s, entries, files, others);

console.log(`${count} prompts written to ${outDir}`);
