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
    iterationStart: true,
  },
  {
    id: "build",
    goal:
      "Engineers implement their own tasks in the workspace (real files, runnable code, tests when sensible), " +
      "coordinate interfaces with each other, and mark finished work with [TASK_DONE].",
    speakers: ["engineer"],
    mode: "parallel",
    maxRounds: 3,
    untilTasksDone: true,
    editors: ["engineer"],
  },
  {
    id: "review",
    goal:
      "Engineers review each other's work against the acceptance criteria and fix issues. " +
      "Before users judge it, each engineer posts a [DEMO] for their tasks: what a user would do and what they would see, " +
      "with output you really produced (run the command, render the page or email, paste the result or the path of the " +
      "generated file or screenshot). Never describe output you did not produce. " +
      "PM checks every task against its acceptance criteria and states what is ready for users.",
    speakers: ["engineer", "pm"],
    mode: "round-robin",
    maxRounds: 1,
    editors: ["engineer"],
  },
  {
    id: "acceptance",
    goal:
      "Users try what was built — start from the team's demos, open the files they point to, run it if possible — " +
      "and judge it from their own needs. Each user gives a [VERDICT accept|reject] with reasons. " +
      "PM summarizes and decides next steps.",
    speakers: ["user", "pm"],
    mode: "round-robin",
    maxRounds: 1,
  },
  {
    id: "wrapup",
    goal:
      "The session is about to end. Engineers apply every decision made during review and acceptance and finish " +
      "their open tasks ([TASK_DONE]); a task that cannot be finished here gets one line saying why and what is left. " +
      "PM then confirms what shipped and lists, for the real human, anything still open or needing their decision.",
    speakers: ["engineer", "pm"],
    mode: "round-robin",
    maxRounds: 1,
    editors: ["engineer"],
    finale: true,
  },
];

interface RoleDef {
  guide: string;
  /** Actions beyond the common ones. */
  actions: string[];
  /** Claude Code subagent that plays this role in host mode (.claude/agents/*.md). */
  subagent: string;
  /** What the workspace section of the prompt tells this role. */
  workspace: string;
}

const ROLES: Record<string, RoleDef> = {
  pm: {
    guide:
      "You are the Product Manager and the facilitator. You own the 'why' and the 'what': " +
      "understand users, define scope, write tasks with acceptance criteria, make decisions, keep the team focused. " +
      "You do not write production code. You may end a phase early with [ADVANCE] when its goal is met.",
    actions: ["TASK", "DECISION", "ADVANCE"],
    subagent: "team-pm",
    workspace: "This is what the engineers have built so far. If you can read files, check it against the acceptance criteria.",
  },
  engineer: {
    guide:
      "You are a software engineer on the team. You own the 'how': design, implementation, tests and quality " +
      "of the tasks assigned to you. Speak up early about risks and trade-offs. When building, actually write the " +
      "code in the workspace, keep it runnable, and report what you did concretely (files, commands).",
    actions: ["TASK", "TASK_START", "TASK_DONE", "DEMO"],
    subagent: "team-engineer",
    workspace:
      "All product code lives here (relative to the repository root). When the phase allows editing and you have file tools, " +
      "read and edit files here for real; keep the product runnable and document how to run it in its README.md.",
  },
  user: {
    guide:
      "You are a real end user (persona) being interviewed and later trying the product. You are NOT on the team: " +
      "you know nothing about the implementation, you speak only from your own life, habits and frustrations, " +
      "and you judge the product honestly — politely, but you will not pretend to like something that does not help you.",
    actions: ["VERDICT"],
    subagent: "team-persona",
    workspace:
      "This is what the team has built so far. If you can read files, start with the demos above and the files they point to, " +
      "then README.md, and try it as a user would.",
  },
};

const COMMON_ACTIONS = ["THINK", "SAY", "NOTE", "DONE"];

function roleDef(role: Role): RoleDef | undefined {
  return ROLES[role];
}

export function roleGuide(role: Role): string {
  return roleDef(role)?.guide ?? `You act as the team's ${role}. Contribute from that perspective.`;
}

/** Actions each role may use. Everyone may THINK, SAY, NOTE and DONE. */
export function allowedActions(role: Role): string[] {
  return [...COMMON_ACTIONS, ...(roleDef(role)?.actions ?? [])];
}

/** Host-mode subagent for a role. Unknown roles get the read-only PM-style agent, never a write-capable one. */
export function subagentFor(role: Role): string {
  return roleDef(role)?.subagent ?? "team-pm";
}

export function workspaceGuide(role: Role): string {
  return roleDef(role)?.workspace ?? "This is what the team has built so far.";
}

/** Extra workspace guidance when the workspace is an existing codebase (`init --workspace`). */
export const EXTERNAL_WORKSPACE_GUIDE =
  "This is an existing codebase with its own conventions. Before changing it, read its CLAUDE.md / AGENTS.md / " +
  "CONTRIBUTING.md and README, follow its rules (structure, naming, tests, quality gate, commit conventions), " +
  "and keep the change limited to the brief.";

/** Whether `role` may edit the workspace during `phase`. */
export function canEdit(phase: PhaseDef, role: Role): boolean {
  return phase.editors?.includes(role) ?? false;
}
