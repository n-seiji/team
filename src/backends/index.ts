import type { BackendConfig, ReplyUsage, SessionState } from "../types.ts";
import type { TurnPrompt } from "../prompt.ts";
import { AnthropicBackend } from "./anthropic.ts";
import { ClaudeCliBackend } from "./claude-cli.ts";
import { MockBackend } from "./mock.ts";

export interface TurnContext {
  state: SessionState;
  root: string;
}

export interface BackendReply {
  text: string;
  /** Whatever the backend could measure for this reply. */
  usage?: ReplyUsage;
}

/** Something that can produce an agent's reply for one turn. A failed attempt that still cost something rejects with a `ReplyError` that carries its usage. */
export interface Backend {
  /** The model it will ask for, once TEAM_MODEL and its own default are applied; none when it leaves the choice to something else. */
  readonly model?: string;
  /**
   * Throws, saying what is wrong and what to do, when no turn could ever get a reply (no claude command, no API key).
   * Only looks: it starts nothing and spends nothing. `run` calls it before it changes anything; creating the backend never does.
   */
  preflight?(ctx: TurnContext): void;
  respond(prompt: TurnPrompt, ctx: TurnContext): Promise<BackendReply>;
}

export function createBackend(cfg: BackendConfig): Backend {
  switch (cfg.type) {
    case "anthropic":
      return new AnthropicBackend(cfg);
    case "claude-cli":
      return new ClaudeCliBackend(cfg);
    case "mock":
      return new MockBackend();
    default:
      throw new Error(`unknown backend: ${(cfg as BackendConfig).type}`);
  }
}
