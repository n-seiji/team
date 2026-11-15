import { World } from "../src/world.ts";
import { DEFAULT_PHASES } from "../src/sop.ts";
import type { PersonaSpec, SessionState, Task, Verdict } from "../src/types.ts";

const member = (id: string, role: string, name: string): PersonaSpec => ({ id, role, persona: { name } });

/** A session state as `init` leaves it (running, iteration 1, discovery) with a PM, an engineer and two users, for tests of what is shown. */
export function newState(patch: Partial<SessionState> = {}): SessionState {
  const members = [member("pm", "pm", "Sato"), member("eng", "engineer", "Tanaka"), member("u1", "user", "Yamada"), member("u2", "user", "Garcia")];
  const w = World.create({ name: "s1", brief: "A tool for invoices", members, phases: DEFAULT_PHASES, now: () => "T" });
  return { ...w.state, ...patch };
}

export const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  acceptance: "",
  owner: "eng",
  status: "done",
  createdBy: "pm",
  ...patch,
});

export const verdict = (by: string, verdict: Verdict["verdict"], reason: string, iteration = 1): Verdict => ({ by, verdict, reason, iteration });
