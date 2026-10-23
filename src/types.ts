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
  /** What was done ([TASK_DONE]), what a person must do ([TASK_BLOCKED]) or why it was dropped ([TASK_DROP]). */
  summary?: string;
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
}

/** Token counts a backend measured for one reply. Cache reads cost about a tenth of the other parts, so the parts are never added up. */
export interface TokenUsage {
  input?: number;
  cacheWrite?: number;
  cacheRead?: number;
  output?: number;
}

export type UsageSource = "claude-cli" | "anthropic" | "host" | "mock";

/** What a backend measured for one reply; everything is optional because a backend may measure nothing. */
export interface ReplyUsage {
  tokens?: TokenUsage;
  costUsd?: number;
  durationMs?: number;
  /** Model calls the reply took (`claude -p` agentic turns). */
  modelCalls?: number;
}

/** One line of usage.jsonl: what one recorded reply cost. */
export interface TurnUsage extends ReplyUsage {
  /** `state.turn` after the reply was recorded. */
  turn: number;
  member: string;
  role: Role;
  /** The phase and iteration the reply was given in (before recording it moved the schedule on). */
  phase: string;
  iteration: number;
  at: string;
  /** Size of the prompt the member got, when known (a host reply with no prompt file has none). */
  promptChars?: number;
  replyChars: number;
  source: UsageSource;
  /**
   * The one token number an orchestrator reported for the reply (`record --tokens`), kept as given. It is not one of the measured
   * parts and never added to them: whether it counts cache reads, or all of a subagent's calls so far, is not known.
   */
  reportedTokens?: number;
  /** Every attempt failed, so the member skipped the turn; the usage is what the failed attempts cost. */
  skipped?: boolean;
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
