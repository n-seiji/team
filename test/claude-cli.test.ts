import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ClaudeCliBackend } from "../src/backends/claude-cli.ts";
import type { BackendReply } from "../src/backends/index.ts";
import type { SessionState } from "../src/types.ts";
import type { ReplyError } from "../src/usage.ts";

// Stands in for `claude -p --output-format json`: records its argv next to itself and prints TEAM_FAKE_STDOUT, by default a successful result.
// It writes raw bytes, in two chunks when TEAM_FAKE_SPLIT_INSIDE is set: the first ends one byte into that text.
const FAKE_RESULT = {
  type: "result",
  is_error: false,
  result: "[SAY to=all] ok",
  num_turns: 3,
  duration_ms: 1234,
  total_cost_usd: 0.0123,
  usage: { input_tokens: 7, cache_creation_input_tokens: 500, cache_read_input_tokens: 9000, output_tokens: 42 },
};
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on("end", () => {
  const bytes = Buffer.from(process.env.TEAM_FAKE_STDOUT ?? ${JSON.stringify(JSON.stringify(FAKE_RESULT))});
  const inside = process.env.TEAM_FAKE_SPLIT_INSIDE;
  const cut = inside ? bytes.indexOf(inside) + 1 : bytes.length;
  process.stdout.write(bytes.subarray(0, cut));
  if (cut < bytes.length) setTimeout(() => process.stdout.write(bytes.subarray(cut)), 50);
  if (process.env.TEAM_FAKE_STDERR) process.stderr.write(process.env.TEAM_FAKE_STDERR);
  process.exitCode = Number(process.env.TEAM_FAKE_EXIT ?? 0);
});
`;

interface Setup {
  canEdit?: boolean;
  /** Contents of the user's settings.json: an object is written as JSON, a string verbatim, undefined means no file. */
  settings?: object | string;
  /** Put the file under $HOME/.claude with CLAUDE_CONFIG_DIR unset, instead of under CLAUDE_CONFIG_DIR. */
  viaHome?: boolean;
  /** Runs after the backend is created and before its first turn. */
  afterCreate?: (settingsFile: string) => void;
  /** What the fake claude prints instead of a successful result. */
  stdout?: string;
  /** Splits stdout into two writes, 50 ms apart, the first ending inside the first character of this text. */
  splitInside?: string;
  stderr?: string;
  exitCode?: number;
}

async function argvOf(setup: Setup = {}): Promise<string[]> {
  return (await turnWith(setup)).args;
}

async function turnWith(setup: Setup = {}): Promise<{ args: string[]; reply: BackendReply }> {
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
    TEAM_FAKE_STDOUT: setup.stdout,
    TEAM_FAKE_SPLIT_INSIDE: setup.splitInside,
    TEAM_FAKE_STDERR: setup.stderr,
    TEAM_FAKE_EXIT: setup.exitCode === undefined ? undefined : String(setup.exitCode),
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
    return { args: JSON.parse(fs.readFileSync(path.join(root, "argv.json"), "utf8")), reply };
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

test("the turn's text, tokens, cost, duration and model calls come from claude's JSON result", { skip }, async () => {
  const { args, reply } = await turnWith();
  assert.equal(valueOf(args, "--output-format"), "json");
  assert.equal(reply.text, "[SAY to=all] ok");
  assert.deepEqual(reply.usage, {
    tokens: { input: 7, cacheWrite: 500, cacheRead: 9000, output: 42 },
    costUsd: 0.0123,
    durationMs: 1234,
    modelCalls: 3,
  });
});

test("a result without usage numbers still returns its text", { skip }, async () => {
  const { reply } = await turnWith({ stdout: JSON.stringify({ type: "result", is_error: false, result: "[SAY to=all] hi" }) });
  assert.equal(reply.text, "[SAY to=all] hi");
  assert.equal(reply.usage?.tokens, undefined);
  assert.equal(reply.usage?.costUsd, undefined);
});

// What `claude -p --output-format json` prints for an API error or a refusal: a result object that says is_error, with what the failed call cost.
const ERROR_RESULT = {
  type: "result",
  subtype: "success",
  is_error: true,
  result: "API Error: 529 overloaded",
  num_turns: 1,
  duration_ms: 800,
  total_cost_usd: 0.01,
  usage: { input_tokens: 3, cache_creation_input_tokens: 400, cache_read_input_tokens: 5000, output_tokens: 0 },
};
const ERROR_USAGE = { tokens: { input: 3, cacheWrite: 400, cacheRead: 5000, output: 0 }, costUsd: 0.01, durationMs: 800, modelCalls: 1 };

async function failureOf(setup: Setup): Promise<ReplyError> {
  try {
    await turnWith(setup);
  } catch (e) {
    return e as ReplyError;
  }
  return assert.fail("the turn should have failed");
}

test("is_error with exit 0 is a failure carrying claude's message and what the call cost", { skip }, async () => {
  const e = await failureOf({ stdout: JSON.stringify(ERROR_RESULT) });
  assert.match(e.message, /API Error: 529 overloaded/);
  assert.deepEqual(e.usage, ERROR_USAGE);
});

test("claude exiting 1 with its result JSON on stdout fails with the result text, not the JSON, and keeps the cost", { skip }, async () => {
  const e = await failureOf({ stdout: JSON.stringify(ERROR_RESULT), stderr: "node:internal noise", exitCode: 1 });
  assert.match(e.message, /exited with 1/);
  assert.match(e.message, /API Error: 529 overloaded/);
  assert.doesNotMatch(e.message, /total_cost_usd|is_error|noise/);
  assert.deepEqual(e.usage, ERROR_USAGE);
});

test("a non-zero exit without a result JSON reports stderr, else stdout", { skip }, async () => {
  const withStderr = await failureOf({ stdout: "partial", stderr: "401 invalid x-api-key", exitCode: 1 });
  assert.match(withStderr.message, /exited with 1.*401 invalid x-api-key/);
  assert.equal(withStderr.usage, undefined);
  await assert.rejects(turnWith({ stdout: "boom", exitCode: 2 }), /exited with 2.*boom/);
});

test("output that is not JSON fails with the start of what was printed, not all of it", { skip }, async () => {
  await assert.rejects(turnWith({ stdout: "[SAY to=all] plain text from an old claude" }), /not JSON.*\[SAY to=all\] plain text from an old claude/s);
  await assert.rejects(turnWith({ stdout: "x".repeat(2000) }), (e: Error) => e.message.includes("x".repeat(100)) && e.message.length < 1000);
});

test("a Japanese reply written in two chunks that split a character arrives intact", { skip }, async () => {
  const text = "[SAY to=all] 家計簿アプリを作りましょう。まずは使う人の話を聞きます。";
  const { reply } = await turnWith({ stdout: JSON.stringify({ type: "result", is_error: false, result: text }), splitInside: "家" });
  assert.equal(reply.text, text);
});

test("JSON without a result string is a failure", { skip }, async () => {
  await assert.rejects(turnWith({ stdout: JSON.stringify({ type: "result", is_error: false }) }), /no result/);
});
