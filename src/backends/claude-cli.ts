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
import { ReplyError, TurnTimeoutError, nonNegative, tokensFromApi } from "../usage.ts";
import type { Backend, BackendReply, TurnContext } from "./index.ts";
import { ProcessTree } from "./process-tree.ts";

const READ_ONLY = ["Read", "Glob", "Grep"];
const BUILDER = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];
const DEFAULT_TURN_TIMEOUT_SECONDS = 1800;
const MAX_TIMER_MS = 2 ** 31 - 1; // a longer setTimeout fires after 1 ms instead
const DRAIN_MS = 500; // how long output still in the pipes gets to arrive once claude has exited

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

/**
 * Reads what `claude -p --output-format json` printed. It prints a result object even when it exits 1 (API errors, refusals), so the
 * object is read before the exit code is judged. An `is_error` result is a failure even when claude exits 0, and a failure still
 * carries the tokens and cost claude reported for it.
 */
function settle(code: number | null, stdout: string, stderr: string): BackendReply {
  const raw = stdout.trim();
  let r: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) r = parsed;
  } catch {}
  const usage = r && {
    tokens: tokensFromApi(r.usage),
    costUsd: nonNegative(r.total_cost_usd),
    durationMs: nonNegative(r.duration_ms),
    modelCalls: nonNegative(r.num_turns),
  };
  const reason = (typeof r?.result === "string" && r.result) || undefined;
  if (code !== 0) throw new ReplyError(`claude exited with ${code}: ${(reason ?? (stderr.trim() || raw)).slice(0, 500)}`, usage);
  if (!r) throw new ReplyError(`claude output is not JSON: ${raw.slice(0, 500)}`);
  if (r.is_error) throw new ReplyError(reason ?? `claude reported an error: ${raw.slice(0, 500)}`, usage);
  if (typeof r.result !== "string") throw new ReplyError(`claude's JSON has no result: ${raw.slice(0, 500)}`, usage);
  return { text: r.result.trim(), usage };
}

/** `TEAM_TURN_TIMEOUT`, in seconds. Without a limit one tool call that never returns (a test that keeps a server open) hangs the run for ever. */
function turnTimeoutSeconds(): number {
  const raw = process.env.TEAM_TURN_TIMEOUT;
  const seconds = raw === undefined ? DEFAULT_TURN_TIMEOUT_SECONDS : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`TEAM_TURN_TIMEOUT must be a positive number of seconds, got ${JSON.stringify(raw)}`);
  }
  return seconds;
}

export class ClaudeCliBackend implements Backend {
  private model?: string;
  private bin: string;
  private userSettings?: string;
  private timeoutSeconds: number;

  constructor(cfg: BackendConfig) {
    this.model = process.env.TEAM_MODEL ?? cfg.model;
    this.bin = process.env.TEAM_CLAUDE_BIN ?? "claude";
    this.userSettings = userSettingsToForward();
    this.timeoutSeconds = turnTimeoutSeconds();
  }

  respond(p: TurnPrompt, ctx: TurnContext): Promise<BackendReply> {
    // Fixed context is paid on every turn (~62k tokens for a tiny prompt, ~5k with these flags): load only the granted tool definitions
    // (--allowedTools just permits them), only the project's and workspace's settings (--setting-sources: no user-level rules,
    // plugins, hooks or skills) and no MCP servers (--strict-mcp-config). The user's deny/env/apiKeyHelper come back via --settings.
    const tools = (p.canEdit ? BUILDER : READ_ONLY).join(",");
    const args = ["-p", "--output-format", "json", "--strict-mcp-config", "--allowedTools", tools, "--tools", tools];
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
      const started = Date.now();
      const child = spawn(this.bin, args, {
        cwd,
        shell: process.platform === "win32", // resolves claude.cmd on Windows
        stdio: ["pipe", "pipe", "pipe"],
        // On POSIX this starts a new session (setsid): a process group of its own, so a timeout can take down the tools claude started,
        // and no controlling terminal, so a tool that opens /dev/tty fails at once instead of hanging on a prompt nobody sees.
        detached: process.platform !== "win32",
      });
      const tree = child.pid === undefined ? undefined : new ProcessTree(child.pid);
      const unwatch = tree?.watch();
      let out = "";
      let err = "";
      let over = false; // the first of the timeout, claude's end and a failed start decides the turn
      let drain: NodeJS.Timeout | undefined;
      const release = () => {
        clearTimeout(timer);
        clearTimeout(drain);
        unwatch?.();
        // something that outlived claude may still hold the pipes open, and would keep this process from ending
        for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
      };
      const timer = setTimeout(async () => {
        over = true;
        try {
          await tree?.terminate();
        } catch (e) {
          process.stderr.write(`warning: could not kill the processes of the timed-out claude turn: ${(e as Error).message}\n`);
        } finally {
          release();
          const s = this.timeoutSeconds;
          const message = `claude turn timed out after ${s} second${s === 1 ? "" : "s"} and was killed (TEAM_TURN_TIMEOUT)`;
          reject(new TurnTimeoutError(message, Date.now() - started));
        }
      }, Math.min(this.timeoutSeconds * 1000, MAX_TIMER_MS));
      const conclude = (code: number | null) => {
        if (over) return;
        over = true;
        release();
        try {
          resolve(settle(code, out, err));
        } catch (e) {
          reject(e);
        }
      };
      // decode whole characters: a chunk boundary can fall inside a multi-byte one
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        if (over) return;
        over = true;
        release();
        reject(new Error(`failed to start "${this.bin}": ${e.message}`));
      });
      // `close` waits until every holder of the pipes has let go, and a tool that outlives claude (a server it started) may never do
      child.on("exit", (code) => {
        tree?.rootExited();
        drain = setTimeout(conclude, DRAIN_MS, code);
      });
      child.on("close", conclude);
      child.stdin.on("error", () => {}); // EPIPE: claude died before it read its prompt, and "close" says how it ended
      child.stdin.end(input);
    });
  }
}
