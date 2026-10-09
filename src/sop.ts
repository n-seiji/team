// Standard Operating Procedure: the phases a team goes through for one iteration,
// and what each role is responsible for. MetaGPT-style assembly line, with the
// persona (end user) closing the loop in acceptance like a real usability test.
import type { PhaseDef, Role } from "./types.ts";

export const DEFAULT_PHASES: PhaseDef[] = [
  {
    id: "discovery",
    goal:
      "PM interviews the users to uncover their real situation, pains and jobs-to-be-done. " +
      "Users answer strictly in character, with concrete episodes. No solutions yet.",
    speakers: ["pm", "user"],
    mode: "round-robin",
    maxRounds: 2,
  },
  {
    id: "planning",
    goal:
      "PM turns findings into a small, shippable scope: [TASK] items with clear acceptance criteria, " +
      "each assigned to an engineer. Engineers challenge feasibility, split or re-assign tasks, and agree on tech choices.",
    speakers: ["pm", "engineer"],
    mode: "round-robin",
    maxRounds: 2,
  },
  {
    id: "build",
    goal:
      "Engineers implement their own tasks in the workspace (real files, runnable code, tests when sensible), " +
      "coordinate interfaces with each other, and mark finished work with [TASK_DONE].",
    speakers: ["engineer"],
    mode: "parallel",
    maxRounds: 3,
  },
  {
    id: "review",
    goal:
      "Engineers review each other's work against the acceptance criteria and fix issues. " +
      "PM checks every task against its acceptance criteria and states what is ready for users.",
    speakers: ["engineer", "pm"],
    mode: "round-robin",
    maxRounds: 1,
  },
  {
    id: "acceptance",
    goal:
      "Users try what was built (read the workspace, run it if possible) and judge it from their own needs. " +
      "Each user gives a [VERDICT accept|reject] with reasons. PM summarizes and decides next steps.",
    speakers: ["user", "pm"],
    mode: "round-robin",
    maxRounds: 1,
  },
];

export const ROLE_GUIDE: Record<string, string> = {
  pm:
    "You are the Product Manager and the facilitator. You own the 'why' and the 'what': " +
    "understand users, define scope, write tasks with acceptance criteria, make decisions, keep the team focused. " +
    "You do not write production code. You may end a phase early with [ADVANCE] when its goal is met.",
  engineer:
    "You are a software engineer on the team. You own the 'how': design, implementation, tests and quality " +
    "of the tasks assigned to you. Speak up early about risks and trade-offs. When building, actually write the " +
    "code in the workspace, keep it runnable, and report what you did concretely (files, commands).",
  user:
    "You are a real end user (persona) being interviewed and later trying the product. You are NOT on the team: " +
    "you know nothing about the implementation, you speak only from your own life, habits and frustrations, " +
    "and you judge the product honestly — politely, but you will not pretend to like something that does not help you.",
};

export function roleGuide(role: Role): string {
  return ROLE_GUIDE[role] ?? `You act as the team's ${role}. Contribute from that perspective.`;
}

/** Actions each role may use. Everyone may THINK, SAY, NOTE and DONE. */
export const ROLE_ACTIONS: Record<string, string[]> = {
  pm: ["TASK", "DECISION", "ADVANCE"],
  engineer: ["TASK", "TASK_START", "TASK_DONE"],
  user: ["VERDICT"],
};

export const COMMON_ACTIONS = ["THINK", "SAY", "NOTE", "DONE"];

export function allowedActions(role: Role): string[] {
  return [...COMMON_ACTIONS, ...(ROLE_ACTIONS[role] ?? [])];
}

/** Claude Code subagent used for each role in host mode (.claude/agents/*.md). */
export function subagentFor(role: Role): string {
  if (role === "pm") return "team-pm";
  if (role === "engineer") return "team-engineer";
  if (role === "user") return "team-persona";
  return "team-engineer";
}
