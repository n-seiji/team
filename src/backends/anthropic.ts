// Direct Messages API call with fetch (no SDK dependency). Needs ANTHROPIC_API_KEY.
import { setTimeout as sleep } from "node:timers/promises";
import type { BackendConfig } from "../types.ts";
import type { TurnPrompt } from "../prompt.ts";
import type { Backend } from "./index.ts";

const DEFAULT_MODEL = "claude-sonnet-5-5";

export class AnthropicBackend implements Backend {
  private model: string;
  private maxTokens: number;

  constructor(cfg: BackendConfig) {
    this.model = process.env.TEAM_MODEL ?? cfg.model ?? DEFAULT_MODEL;
    this.maxTokens = cfg.maxTokens ?? 2048;
  }

  async respond(p: TurnPrompt): Promise<string> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set (or use --backend claude-cli / host mode)");
    const base = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: p.system,
          messages: [{ role: "user", content: p.user }],
        }),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const body = (await res.json()) as { content: { type: string; text?: string }[] };
      return body.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    }
  }
}
