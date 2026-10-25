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
    maxRounds: 3,
  },
  {
    id: "planning",
    goal:
      "PM turns findings into a small, shippable scope: [TASK] items with clear acceptance criteria, " +
      "each assigned to an engineer. Engineers challenge feasibility, split or re-assign tasks, and agree on tech choices. " +
      "Decide early how each user will actually get to and start the product with their own device and skills " +
      "(e.g. a URL on their phone vs. a terminal command) and make that part of the acceptance criteria. " +
      "If getting there needs a step only a real person can do (publishing, an account, a purchase), hand that step " +
      "over now with [TASK_BLOCKED T1] and build everything else so it works the moment the step is done.",
    speakers: ["pm", "engineer"],
    mode: "round-robin",
    maxRounds: 3,
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
      "Keep one verification command for the product and declare it with [VERIFY]: it starts what users would use, " +
      "walks the main user journeys the way a user would (a browser for a web UI, the real CLI for a CLI), prints what it " +
      "saw, saves screenshots or generated files into the folder $TEAM_ARTIFACTS, stops everything it started, and exits " +
      "non-zero when a journey fails. Before acceptance the runtime runs it and shows its real output to users. " +
      "PM checks every task against its acceptance criteria and states what is ready for users.",
    speakers: ["engineer", "pm"],
    mode: "round-robin",
    maxRounds: 1,
    editors: ["engineer"],
  },
  {
    id: "acceptance",
    goal:
      "Users try what was built — start from the trial run (real output the runtime produced with the team's " +
      "verification command), then the team's demos, and open the files they point to — " +
      "and judge it from their own needs. Each user gives a [VERDICT accept|reject] with reasons. " +
      "Steps the team handed to a real person (shown as \"needs a person\" in the backlog, such as publishing) are " +
      "judged as if they were done: users name them as pending, and reject only for what the team itself can still change. " +
      "PM summarizes and decides next steps: every condition a user attached to their verdict becomes a [TASK] or gets a " +
      "one-line reason why not (follow-up tasks start another iteration while iterations remain). " +
      "For a condition only a real person can check on a built task (a real phone, a printed sheet, a timed first use), " +
      "use [CHECK T1] instead of simulating it. " +
      "Use [TASK_BLOCKED T1] only when the work itself needs a person (an account, publishing, a real device to build on). " +
      "Treat any claim that someone ran or installed something as unverified unless a demo shows it.",
    speakers: ["user", "pm"],
    mode: "round-robin",
    maxRounds: 1,
    trial: true,
  },
  {
    id: "wrapup",
    goal:
      "The session is about to end. Engineers apply every decision made during review and acceptance and finish " +
      "their open tasks ([TASK_DONE]); a task that cannot be finished here gets one line saying why and what is left. " +
      "Follow-ups added after the build are not built here: users have not seen them, so they are handed over. " +
      "PM then confirms what shipped and lists, for the real human, anything still open or needing their decision.",
    speakers: ["engineer", "pm"],
    mode: "round-robin",
    maxRounds: 1,
    editors: ["engineer"],
    finale: true,
  },
];

/** Shared by the designer variant and the no-designer comparison config, so the two differ only in who writes it. */
export const STATE_TABLE =
  "For each screen (or CLI command) write who uses it, in which order, and a state table with a row for each of: " +
  "first use or empty, normal, many items, error or bad input, undoing a mistake, the day or month boundary, phone width. " +
  "Give the visible copy. Every choice names the user need from the brief or the interviews that it serves; " +
  "one persona's remark is a question to raise, not a rule.";
export const VERIFY_STATES =
  "The engineer who owns [VERIFY] makes its journeys cover those states: empty, day or month change, undo and phone width.";

/**
 * Phases for a team: the default ones, plus a design phase after planning when the team has a designer.
 * A config's own `phases` replaces this entirely.
 */
export function phasesFor(members: readonly { role: Role }[]): PhaseDef[] {
  if (!members.some((m) => m.role === "designer")) return DEFAULT_PHASES;
  const noTask = "Never assign a task to the designer.";
  const withGoal = (p: PhaseDef, f: (goal: string) => string): PhaseDef => ({ ...p, goal: f(p.goal) });
  const phases: PhaseDef[] = [];
  for (const p of DEFAULT_PHASES) {
    switch (p.id) {
      case "planning":
        phases.push(
          withGoal(p, (g) => `${g} ${noTask} Every product decision names the user need it serves; one persona's remark is a question to raise, not a rule.`),
          {
            id: "design",
            goal:
              "The designer writes design.md in the artifacts folder for this iteration's tasks (from iteration 2 on, " +
              "changes only what the rejections and new tasks need). " + STATE_TABLE + " " +
              "The PM copies each state-table row that matters into the acceptance criteria (update tasks with replaces=, or add a [TASK]) " +
              "so the design reaches the build; engineers flag what is costly and agree. " + noTask,
            speakers: ["designer", "pm", "engineer"],
            mode: "round-robin",
            maxRounds: 2,
            editors: ["designer"],
          },
        );
        break;
      case "build":
        phases.push(withGoal(p, (g) => `${g} Build to design.md in the artifacts folder; disagree in [SAY], don't silently diverge.`));
        break;
      case "review":
        phases.push({
          ...withGoal(
            p,
            (g) =>
              "The designer goes first: compare the built product with design.md (render the pages or run the commands, " +
              "screenshots into the artifacts folder) and list the gaps by state-table row; engineers fix them in their turn. " +
              `${g} ${VERIFY_STATES}`,
          ),
          speakers: ["designer", "engineer", "pm"],
          editors: ["engineer", "designer"],
        });
        break;
      default:
        phases.push(p);
    }
  }
  return phases;
}

/**
 * The real human supervises asynchronously, so the team never waits on them: facts are checked, not asked; only
 * calls a person must make are asked, with a default to proceed on.
 */
const NEVER_BLOCK =
  "Never wait on the real human. If a question can be settled by running or reading something, settle it yourself. " +
  "Ask the human ([ASK_HUMAN]) only for a product or preference call, a permission, money or anything irreversible, " +
  "state the default you go ahead with, and keep working. Work only a real person can finish goes to [TASK_BLOCKED].";

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
      "You do not write production code. You may end a phase early with [ADVANCE] when its goal is met. " +
      "Keep the backlog true: close tasks you no longer want with [TASK_DROP] or replace them (replaces=T1) " +
      "instead of leaving them open. " +
      NEVER_BLOCK,
    actions: ["TASK", "TASK_DROP", "TASK_BLOCKED", "CHECK", "DECISION", "ADVANCE", "ASK_HUMAN"],
    subagent: "team-pm",
    workspace: "This is what the engineers have built so far. If you can read files, check it against the acceptance criteria.",
  },
  engineer: {
    guide:
      "You are a software engineer on the team. You own the 'how': design, implementation, tests and quality " +
      "of the tasks assigned to you. Speak up early about risks and trade-offs. When building, actually write the " +
      "code in the workspace, keep it runnable, and report what you did concretely (files, commands). " +
      "Other programs (including this team's own runtime) share the machine: when you start a server or any background " +
      "process, stop it by its PID (`kill $PID`); never use pkill, killall or kill by name or pattern. " +
      "Run tests and commands so that they always exit (for example `node --test --test-timeout=<ms>` or a `timeout` wrapper), " +
      "and never start a server in the foreground. " +
      NEVER_BLOCK,
    actions: ["TASK", "TASK_START", "TASK_DONE", "TASK_BLOCKED", "CHECK", "DEMO", "VERIFY", "ASK_HUMAN"],
    subagent: "team-engineer",
    workspace:
      "All product code lives here (relative to the repository root). When the phase allows editing and you have file tools, " +
      "read and edit files here for real; keep the product runnable and document how to run it in its README.md. " +
      "Save screenshots and other evidence for demos in the session's artifacts folder (given below), not in /tmp.",
  },
  designer: {
    guide:
      "You are the designer. You own the experience: screens (or CLI commands), flows, states and the visible copy. " +
      "You do not write product code. You write one file, design.md in the session's artifacts folder (plus screenshots " +
      "there), and review the built product against it. " +
      "You speak in design and review only; engineers' build-time questions reach you in review. " +
      "[CHECK T1] only works on tasks already done, so use it in review, not in design. " +
      "When you start a server or any background process, stop it by its PID (`kill $PID`); never use pkill, killall or kill by name or pattern. " +
      NEVER_BLOCK,
    actions: ["CHECK", "ASK_HUMAN"],
    subagent: "team-designer",
    workspace:
      "This is the product the engineers build; treat it as read-only. Write only design.md and screenshots, in the " +
      "session's artifacts folder (given below), not in the workspace and not in /tmp.",
  },
  user: {
    guide:
      "You are a real end user (persona) being interviewed and later trying the product. You are NOT on the team: " +
      "you know nothing about the implementation, you speak only from your own life, habits and frustrations, " +
      "and you judge the product honestly — politely, but you will not pretend to like something that does not help you. " +
      "You cannot run, install or open anything outside what you are shown and the files you read, so never say you tried, " +
      "installed or ran something; say what you read and what you could not check. " +
      "When a step only a real person can do is still pending (the backlog says \"needs a person\", e.g. publishing), " +
      "judge whether the product would work for you once that step is done, and say that the step is still pending.",
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
