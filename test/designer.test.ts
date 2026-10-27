import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { main } from "../src/cli.ts";
import { World } from "../src/world.ts";
import { buildPrompt } from "../src/prompt.ts";
import { DEFAULT_PHASES, allowedActions, canEdit, phasesFor, subagentFor } from "../src/sop.ts";
import type { PersonaSpec } from "../src/types.ts";

const repo = path.resolve(import.meta.dirname, "..");
const p = (id: string, role: string): PersonaSpec => ({ id, role, persona: { name: id.toUpperCase() } });
const plain = [p("pm", "pm"), p("e1", "engineer"), p("u1", "user")];
const withDesigner = [...plain, p("d1", "designer")];
const phase = (id: string, members = withDesigner) => phasesFor(members).find((x) => x.id === id)!;

test("without a designer, phasesFor returns the default phases untouched", () => {
  assert.equal(phasesFor(plain), DEFAULT_PHASES);
  assert.ok(!DEFAULT_PHASES.some((x) => x.id === "design"));
});

test("with a designer, a design phase follows planning and review starts with the designer", () => {
  const ids = phasesFor(withDesigner).map((x) => x.id);
  assert.deepEqual(ids, ["discovery", "planning", "design", "build", "review", "acceptance", "wrapup"]);
  assert.deepEqual(phase("review").speakers, ["designer", "engineer", "pm"]);
  assert.deepEqual(phase("design").speakers, ["designer", "pm", "engineer"]);
  assert.ok(!phase("design").iterationStart);
});

test("the designer edits only in design and review", () => {
  const editable = phasesFor(withDesigner).filter((x) => canEdit(x, "designer")).map((x) => x.id);
  assert.deepEqual(editable, ["design", "review"]);
});

test("the designer has no TASK action and the subagent is team-designer", () => {
  const actions = allowedActions("designer");
  assert.deepEqual(actions.filter((a) => !["THINK", "SAY", "NOTE", "DONE"].includes(a)), ["CHECK", "ASK_HUMAN"]);
  assert.equal(subagentFor("designer"), "team-designer");
});

test("the designer-variant goals say never to assign a task to the designer", () => {
  assert.match(phase("planning").goal, /never assign a task to the designer/i);
  assert.match(phase("design").goal, /never assign a task to the designer/i);
});

test("the designer sees the artifacts folder; rejections reach it in design only", () => {
  const w = World.create({ name: "t", brief: "b", members: withDesigner, phases: phasesFor(withDesigner), now: () => "T" });
  const goTo = (id: string) => (w.state.phaseIndex = w.state.phases.findIndex((x) => x.id === id));
  goTo("design");
  w.state.iteration = 2;
  w.state.verdicts.push({ by: "u1", iteration: 1, verdict: "reject", reason: "too hard to undo" });
  const design = buildPrompt(w.state, "d1", w.emitted, []);
  assert.match(design.user, /Artifacts folder for evidence \(relative to the repository root\): \.team\/sessions\/t\/artifacts\//);
  assert.ok(design.sections.some((s) => s.id === "rejections"));
  goTo("review");
  assert.ok(!buildPrompt(w.state, "d1", w.emitted, []).sections.some((s) => s.id === "rejections"));
  goTo("design");
  assert.ok(!buildPrompt(w.state, "u1", w.emitted, []).sections.some((s) => s.id === "rejections"));
});

test("a mock session with configs/designer.json passes through design and reaches done", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "team-"));
  fs.cpSync(path.join(repo, "personas"), path.join(dir, "personas"), { recursive: true });
  fs.cpSync(path.join(repo, "configs"), path.join(dir, "configs"), { recursive: true });
  fs.copyFileSync(path.join(repo, "team.config.json"), path.join(dir, "team.config.json"));
  const run = async (...args: string[]) => {
    const out: string[] = [];
    await main([...args, "--root", dir], (s) => out.push(s));
    return out.join("\n");
  };
  await run("init", "--name", "d1", "--brief", "テスト用プロダクト", "--config", "configs/designer.json");
  assert.match(await run("run", "--backend", "mock", "--config", "configs/designer.json"), /session is done/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, ".team/sessions/d1/state.json"), "utf8"));
  assert.equal(state.status, "done");
  assert.ok(state.phases.some((x: { id: string }) => x.id === "design"));
  const md = fs.readFileSync(path.join(dir, ".team/sessions/d1/transcript.md"), "utf8");
  assert.match(md, /design\.md に画面ごとの状態表/);
  const entries = fs.readFileSync(path.join(dir, ".team/sessions/d1/transcript.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const inReview = entries.filter((e: { phase: string; iteration: number; kind: string }) => e.phase === "review" && e.iteration === 1 && e.kind === "say");
  assert.equal(inReview[0]?.from, "designer", "the designer speaks first in review");
});

const world = () => World.create({ name: "t", brief: "b", members: withDesigner, phases: phasesFor(withDesigner), now: () => "T" });
const goTo = (w: World, id: string) => (w.state.phaseIndex = w.state.phases.findIndex((x) => x.id === id));

test("a task owned by a non-engineer is kept but logged, an engineer's is not", () => {
  const w = world();
  w.record("pm", "[TASK owner=d1] Polish copy", { force: true });
  w.record("pm", "[TASK owner=e1] Build it", { force: true });
  assert.deepEqual(w.state.tasks.map((t) => t.owner), ["d1", "e1"]);
  const system = w.emitted.filter((e) => e.kind === "system").map((e) => e.text);
  assert.ok(system.includes("Task T1 is owned by d1 (designer), who cannot finish tasks; assign it to an engineer."));
  assert.ok(!system.some((t) => t.startsWith("Task T2")));
});

test("an iteration-2 restart lands on planning, then design", () => {
  const w = world();
  goTo(w, "acceptance");
  w.state.verdicts.push({ by: "u1", iteration: 1, verdict: "reject", reason: "no" });
  for (let i = 0; i < 40 && w.state.iteration === 1; i++) {
    const [id] = w.next();
    w.record(id, "[SAY to=all] ok");
  }
  assert.equal(w.state.iteration, 2);
  assert.equal(w.phase.id, "planning");
  for (let i = 0; i < 40 && w.phase.id === "planning"; i++) {
    const [id] = w.next();
    w.record(id, "[SAY to=all] ok");
  }
  assert.equal(w.phase.id, "design");
});

test("the designer's prompt allows editing in design and review only; engineers are told to build to design.md", () => {
  const w = world();
  const edit = (id: string, who: string) => {
    goTo(w, id);
    return buildPrompt(w.state, who, w.emitted, []).user;
  };
  for (const id of ["design", "review"]) assert.match(edit(id, "d1"), /You may edit files in the workspace during this phase\./, id);
  for (const id of ["build", "acceptance"]) assert.match(edit(id, "d1"), /Do not edit files during this phase\./, id);
  assert.match(edit("build", "e1"), /Build to design\.md/);
});
