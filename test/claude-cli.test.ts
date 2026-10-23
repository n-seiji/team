import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ClaudeCliBackend } from "../src/backends/claude-cli.ts";
import type { SessionState } from "../src/types.ts";

// Stands in for `claude`: records its argv next to itself and answers with a tag.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on("end", () => console.log("[SAY to=all] ok"));
`;

interface Setup {
  canEdit?: boolean;
  /** Contents of the user's settings.json: an object is written as JSON, a string verbatim, undefined means no file. */
  settings?: object | string;
  /** Put the file under $HOME/.claude with CLAUDE_CONFIG_DIR unset, instead of under CLAUDE_CONFIG_DIR. */
  viaHome?: boolean;
  /** Runs after the backend is created and before its first turn. */
  afterCreate?: (settingsFile: string) => void;
}

async function argvOf(setup: Setup = {}): Promise<string[]> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "team-claude-"));
  const bin = path.join(root, "claude");
  fs.writeFileSync(bin, FAKE_CLAUDE);
  fs.chmodSync(bin, 0o755);
  const configDir = setup.viaHome ? path.join(root, "home", ".claude") : path.join(root, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const settingsFile = path.join(configDir, "settings.json");
  if (setup.settings !== undefined) {
    fs.writeFileSync(settingsFile, typeof setup.settings === "string" ? setup.settings : JSON.stringify(setup.settings));
  }
  const env: Record<string, string | undefined> = {
    TEAM_CLAUDE_BIN: bin,
    CLAUDE_CONFIG_DIR: setup.viaHome ? undefined : configDir,
    HOME: setup.viaHome ? path.join(root, "home") : process.env.HOME,
  };
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const backend = new ClaudeCliBackend({ type: "claude-cli" });
    setup.afterCreate?.(settingsFile);
    const turn = { member: "e1", role: "engineer", canEdit: setup.canEdit ?? false, system: "s", user: "u" };
    const reply = await backend.respond(turn, { state: { externalWorkspace: false } as SessionState, root });
    assert.equal(reply, "[SAY to=all] ok");
    return JSON.parse(fs.readFileSync(path.join(root, "argv.json"), "utf8"));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const valueOf = (args: string[], flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const forwarded = (args: string[]): unknown => {
  const v = valueOf(args, "--settings");
  return v === undefined ? undefined : JSON.parse(v);
};

function assertLeanContext(args: string[], tools: string): void {
  assert.equal(valueOf(args, "--allowedTools"), tools, "tools are permitted");
  assert.equal(valueOf(args, "--tools"), tools, "only those tool definitions are loaded");
  assert.equal(valueOf(args, "--setting-sources"), "project,local", "the user's global settings are skipped");
  assert.ok(args.includes("--disable-slash-commands"));
}

const skip = process.platform === "win32" && "the fake claude is a shebang script";

const USER_SETTINGS = {
  permissions: { deny: ["Read(**/.env)", "Bash(aws *)"], allow: ["Bash(*)"], defaultMode: "bypassPermissions" },
  env: { CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_BASE_URL: "https://llm.example.com" },
  apiKeyHelper: "~/bin/print-key",
  hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "prettier --write" }] }] },
  enabledPlugins: { "big-plugin@market": true },
  model: "opus",
};

test("a read-only turn loads only the read tools and the project's own Claude Code setup", { skip }, async () => {
  const args = await argvOf();
  assertLeanContext(args, "Read,Glob,Grep");
  assert.ok(!args.includes("--permission-mode"));
});

test("an editing turn loads the editing tools, accepts edits and keeps the context lean", { skip }, async () => {
  const args = await argvOf({ canEdit: true });
  assertLeanContext(args, "Read,Glob,Grep,Write,Edit,Bash");
  assert.equal(valueOf(args, "--permission-mode"), "acceptEdits");
});

test("the user's deny rules, env and apiKeyHelper still apply; nothing else of their settings is forwarded", { skip }, async () => {
  const args = await argvOf({ canEdit: true, settings: USER_SETTINGS });
  assert.deepEqual(forwarded(args), {
    permissions: { deny: ["Read(**/.env)", "Bash(aws *)"] },
    env: { CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_BASE_URL: "https://llm.example.com" },
    apiKeyHelper: "~/bin/print-key",
  });
});

test("only the settings the user actually has are forwarded", { skip }, async () => {
  assert.deepEqual(forwarded(await argvOf({ settings: { env: { A: "1" }, permissions: { allow: ["Bash(*)"] } } })), { env: { A: "1" } });
  assert.deepEqual(forwarded(await argvOf({ settings: { permissions: { deny: ["Read(**/.env)"] } } })), { permissions: { deny: ["Read(**/.env)"] } });
});

test("with nothing to forward, --settings is left out", { skip }, async () => {
  const cases: Record<string, Setup> = {
    "no settings file": {},
    "a file with only hooks and plugins": { settings: { hooks: USER_SETTINGS.hooks, enabledPlugins: USER_SETTINGS.enabledPlugins } },
    "an unparsable file": { settings: "{ not json" },
    "a file that is not an object": { settings: "[1, 2]" },
    "an empty file": { settings: "" },
  };
  for (const [name, setup] of Object.entries(cases)) {
    const args = await argvOf(setup);
    assert.ok(!args.includes("--settings"), `${name}: no --settings`);
    assertLeanContext(args, "Read,Glob,Grep");
  }
});

test("without CLAUDE_CONFIG_DIR the settings come from ~/.claude", { skip }, async () => {
  const args = await argvOf({ viaHome: true, settings: USER_SETTINGS });
  assert.deepEqual(forwarded(args), {
    permissions: { deny: USER_SETTINGS.permissions.deny },
    env: USER_SETTINGS.env,
    apiKeyHelper: USER_SETTINGS.apiKeyHelper,
  });
});

test("the user's settings are read once, when the backend is created", { skip }, async () => {
  const args = await argvOf({ settings: USER_SETTINGS, afterCreate: (file) => fs.rmSync(file) });
  assert.deepEqual((forwarded(args) as { env: object }).env, USER_SETTINGS.env);
});
