import type { BackendConfig, SessionState } from "../types.ts";
import type { TurnPrompt } from "../prompt.ts";
import { AnthropicBackend } from "./anthropic.ts";
import { ClaudeCliBackend } from "./claude-cli.ts";
import { MockBackend } from "./mock.ts";

export interface TurnContext {
  state: SessionState;
  root: string;
}

/** Something that can produce an agent's reply for one turn. */
export interface Backend {
  readonly name: string;
  respond(prompt: TurnPrompt, ctx: TurnContext): Promise<string>;
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
