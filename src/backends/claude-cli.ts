// Runs each turn through the Claude Code CLI in print mode (`claude -p`).
// Uses whatever auth Claude Code already has, and lets engineers really edit
// files in the workspace during build/review. Works on Linux, macOS and Windows.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BackendConfig } from "../types.ts";
import type { TurnPrompt } from "../prompt.ts";
import { promptAsText } from "../prompt.ts";
import type { Backend, TurnContext } from "./index.ts";

const READ_ONLY = ["Read", "Glob", "Grep"];
const BUILDER = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];

/**
 * `--setting-sources project,local` skips the user's settings.json, which would also drop what must keep applying:
 * its deny rules (editing turns run Bash with acceptEdits) and the auth setup (env such as Bedrock vars, apiKeyHelper).
 * Returns just those as `--settings` JSON, or undefined when the file is missing, unreadable or has none of them.
 */
function userSettingsToForward(): string | undefined {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { permissions, env, apiKeyHelper } = parsed as { permissions?: { deny?: unknown }; env?: unknown; apiKeyHelper?: unknown };
  const out: Record<string, unknown> = {};
  if (permissions?.deny !== undefined) out.permissions = { deny: permissions.deny };
  if (env !== undefined) out.env = env;
  if (apiKeyHelper !== undefined) out.apiKeyHelper = apiKeyHelper;
  return Object.keys(out).length > 0 ? JSON.stringify(out) : undefined;
}

export class ClaudeCliBackend implements Backend {
  private model?: string;
  private bin: string;
  private userSettings?: string;

  constructor(cfg: BackendConfig) {
    this.model = process.env.TEAM_MODEL ?? cfg.model;
    this.bin = process.env.TEAM_CLAUDE_BIN ?? "claude";
    this.userSettings = userSettingsToForward();
  }

  respond(p: TurnPrompt, ctx: TurnContext): Promise<string> {
    // Fixed context is paid on every turn (~62k tokens for a tiny prompt, ~5k with these flags): load only the granted tool definitions
    // (--allowedTools just permits them), only the project's and workspace's settings (--setting-sources: no user-level rules,
    // plugins, hooks or skills) and no MCP servers (--strict-mcp-config). The user's deny/env/apiKeyHelper come back via --settings.
    const tools = (p.canEdit ? BUILDER : READ_ONLY).join(",");
    const args = ["-p", "--output-format", "text", "--strict-mcp-config", "--allowedTools", tools, "--tools", tools];
    args.push("--setting-sources", "project,local", "--disable-slash-commands");
    if (this.userSettings) args.push("--settings", this.userSettings);
    if (p.canEdit) args.push("--permission-mode", "acceptEdits");
    if (this.model) args.push("--model", this.model);
    // In an existing codebase, run inside it so its own CLAUDE.md and project settings (.claude/settings.json and settings.local.json:
    // rules, hooks, permissions) apply to the turn.
    const cwd = ctx.state.externalWorkspace ? path.resolve(ctx.root, ctx.state.workspace) : ctx.root;
    const where =
      cwd === ctx.root ? "" : `\nYour current directory is the workspace itself (${cwd}); workspace paths above are relative to it.`;
    const input =
      promptAsText(p) +
      where +
      "\nUse your tools if needed, then make your FINAL message consist only of the action tags described above.\n";
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        cwd,
        shell: process.platform === "win32", // resolves claude.cmd on Windows
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => reject(new Error(`failed to start "${this.bin}": ${e.message}`)));
      child.on("close", (code) =>
                // `claude -p` prints API errors (e.g. a safety refusal) on stdout, so report both streams.
        code === 0 ? resolve(out.trim()) : reject(new Error(`claude exited with ${code}: ${(err.trim() || out.trim()).slice(0, 500)}`)),
      );
      child.stdin.end(input);
    });
  }
}
