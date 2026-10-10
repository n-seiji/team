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
}

export type TaskStatus = "todo" | "doing" | "done";

export interface Task {
  id: string;
  title: string;
  acceptance: string;
  owner?: string;
  status: TaskStatus;
  createdBy: string;
  summary?: string;
}

export interface Verdict {
  by: string;
  verdict: "accept" | "reject";
  reason: string;
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

export interface TeamConfig {
  language?: string;
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
