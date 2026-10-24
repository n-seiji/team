// Core data model. Inspired by TinyTroupe (TinyPerson / TinyWorld) and
// MetaGPT / ChatDev (role-based SOP phases for software development).

export type Role = "pm" | "engineer" | "user" | (string & {});

/** TinyTroupe-style persona spec. `persona` is free-form; known keys are rendered as-is. */
export interface PersonaSpec {
  id: string;
  role: Role;
  persona: {
    name: string;
    age?: number;
    occupation?: { title?: string; organization?: string; description?: string } | string;
    long_term_goals?: string[];
    style?: string;
    personality?: { traits?: string[]; big_five?: Record<string, string> };
    skills?: string[];
    preferences?: { interests?: string[]; likes?: string[]; dislikes?: string[] };
    beliefs?: string[];
    [key: string]: unknown;
  };
}

export type PhaseMode = "round-robin" | "parallel";

export interface PhaseDef {
  id: string;
  goal: string;
  /** Roles that take turns in this phase, in order. */
  speakers: Role[];
  mode: PhaseMode;
  maxRounds: number;
  /** End the phase early once every backlog task is done. */
  untilTasksDone?: boolean;
  /** Roles allowed to edit the workspace during this phase. */
  editors?: Role[];
  /** Where the next iteration restarts when users reject the result (default: first phase). */
  iterationStart?: boolean;
  /**
   * Wrap-up phase: skipped in the normal order and entered only once, when the session is about to finish
   * with unfinished tasks or with decisions made after the build (review / acceptance).
   */
  finale?: boolean;
  /**
   * Trial phase: before anyone speaks, the runtime runs the team's verification command ([VERIFY]) once per
   * iteration and shows its real output to everyone, so users judge what actually ran.
   */
  trial?: boolean;
}

/**
 * `blocked`: only a real person can finish it (a real device, an account, publishing); `dropped`: the PM closed it
 * without doing it. Both count as settled for the team, and are handed over to the human at the end.
 */
export type TaskStatus = "todo" | "doing" | "done" | "blocked" | "dropped";

export interface Task {
  id: string;
  title: string;
  acceptance: string;
  owner?: string;
  status: TaskStatus;
  createdBy: string;
  /** Where the task was created (absent in older sessions). */
  phase?: string;
  iteration?: number;
  /**
   * What was done ([TASK_DONE]) or why it was dropped ([TASK_DROP]). Sessions saved before `handoff` existed kept
   * a blocked task's hand-off here.
   */
  summary?: string;
  /**
   * What a person must do ([TASK_BLOCKED]), set while the task is blocked; `summary` keeps what was done. Empty when
   * the report gave no text. A blocked task without it is from an older session.
   */
  handoff?: string;
  /**
   * What a real person should check on a built task ([CHECK]). Adding one changes neither status nor summary, and
   * a reopened task keeps them. Absent in older sessions. Checks of a task later dropped or replaced are not
   * carried over to its replacement.
   */
  checks?: string[];
}

/** One run of the team's verification command by the runtime (not by an agent). */
export interface Trial {
  iteration: number;
  /** Empty when the team declared no verification command. */
  command: string;
  exitCode: number | null;
  timedOut?: boolean;
  /** The tail of stdout/stderr. */
  output: string;
  /** Files the command saved in its artifacts folder (paths relative to the repository root). */
  artifacts: string[];
  at: string;
}

/** A question only the real human can answer ([ASK_HUMAN]); the team keeps going on a stated default meanwhile. */
export interface HumanQuestion {
  by: string;
  text: string;
  phase: string;
  iteration: number;
}

export interface Verdict {
  by: string;
  verdict: "accept" | "reject";
  reason: string;
  iteration: number;
}

export interface Demo {
  by: string;
  text: string;
  phase: string;
  iteration: number;
}

export interface SessionState {
  version: 1;
  name: string;
  brief: string;
  language: string;
  workspace: string;
  createdAt: string;
  status: "running" | "done";
  members: PersonaSpec[];
  phases: PhaseDef[];
  phaseIndex: number;
  iteration: number;
  maxIterations: number;
  round: number;
  turn: number;
  /** Members still to act in the current round (not yet scheduled). */
  queue: string[];
  /** Members expected to act in the current step (1 for round-robin, many for parallel). */
  pending: string[];
  /** Reply-to insertions used this round (caps ping-pong). */
  insertions: number;
  tasks: Task[];
  decisions: { by: string; text: string; phase: string; iteration: number }[];
  verdicts: Verdict[];
  /** What engineers actually showed users ([DEMO]): steps and real output. Absent in older sessions. */
  demos?: Demo[];
  /** Questions for the real human ([ASK_HUMAN]). Absent in older sessions. */
  questions?: HumanQuestion[];
  /** The verification command an engineer declared with [VERIFY] (the latest wins). */
  verify?: { command: string; by: string };
  /** Runs of that command, one per iteration at the trial phase. */
  trials?: Trial[];
  /**
   * The workspace is an existing codebase (e.g. a git worktree given with `init --workspace`), not a folder
   * the team created. Engineers then follow its own rules, and claude-cli turns run inside it.
   */
  externalWorkspace?: boolean;
  /** Semantic memory: durable notes each agent chose to keep. */
  notes: Record<string, string[]>;
  historyWindow: number;
}

export type EntryKind =
  | "say"
  | "think"
  | "note"
  | "task"
  | "task_update"
  | "decision"
  | "verdict"
  | "demo"
  | "ask_human"
  | "verify"
  | "advance"
  | "system";

export interface Entry {
  turn: number;
  at: string;
  phase: string;
  iteration: number;
  from: string;
  kind: EntryKind;
  to?: string[];
  text: string;
  /** On the human's `team answer` entry: the question it answers (e.g. "Q2") and the answer as typed. */
  answers?: { question: string; text: string };
}

export interface TeamConfig {
  language?: string;
  /** Parent folder for products; each session builds in `<workspace>/<session name>/`. */
  workspace?: string;
  maxIterations?: number;
  historyWindow?: number;
  members: string[];
  phases?: PhaseDef[];
  backend?: BackendConfig;
}

export interface BackendConfig {
  type: "anthropic" | "claude-cli" | "mock";
  model?: string;
  maxTokens?: number;
}
