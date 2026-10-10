// Runs each turn through the Claude Code CLI in print mode (`claude -p`).
// Uses whatever auth Claude Code already has, and lets engineers really edit
// files in the workspace during build/review. Works on Linux, macOS and Windows.
import { spawn } from "node:child_process";
import type { BackendConfig } from "../types.ts";
import type { TurnPrompt } from "../prompt.ts";
import { promptAsText } from "../prompt.ts";
import type { Backend, TurnContext } from "./index.ts";

const READ_ONLY = ["Read", "Glob", "Grep"];
const BUILDER = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];

export class ClaudeCliBackend implements Backend {
  private model?: string;
  private bin: string;

  constructor(cfg: BackendConfig) {
    this.model = process.env.TEAM_MODEL ?? cfg.model;
    this.bin = process.env.TEAM_CLAUDE_BIN ?? "claude";
  }

  respond(p: TurnPrompt, ctx: TurnContext): Promise<string> {
    const args = ["-p", "--output-format", "text", "--allowedTools", (p.canEdit ? BUILDER : READ_ONLY).join(",")];
    if (p.canEdit) args.push("--permission-mode", "acceptEdits");
    if (this.model) args.push("--model", this.model);
    const input =
      promptAsText(p) +
      "\nUse your tools if needed, then make your FINAL message consist only of the action tags described above.\n";
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        cwd: ctx.root,
        shell: process.platform === "win32", // resolves claude.cmd on Windows
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => reject(new Error(`failed to start "${this.bin}": ${e.message}`)));
      child.on("close", (code) =>
        code === 0 ? resolve(out.trim()) : reject(new Error(`claude exited with ${code}: ${err.slice(0, 500)}`)),
      );
      child.stdin.end(input);
    });
  }
}
