import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
  try {
    return await withEnv(env, async () => {
      const backend = new ClaudeCliBackend({ type: "claude-cli" });
      setup.afterCreate?.(settingsFile);
      const turn = { member: "e1", role: "engineer", canEdit: setup.canEdit ?? false, system: "s", user: "u", sections: [] };
      const reply = await backend.respond(turn, { state: { externalWorkspace: false } as SessionState, root });
      return { args: JSON.parse(fs.readFileSync(path.join(root, "argv.json"), "utf8")), reply };
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Runs `fn` with these environment variables set (undefined deletes one) and puts the old values back afterwards. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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

// A claude that never answers, because a tool call of it never returns. Like Claude Code's Bash tool, `shell` runs detached in a process
// group of its own and has a child of its own (`sleeper`); `tool` stays in claude's group. TEAM_FAKE_IGNORE_TERM=1 makes them all ignore
// SIGTERM. TEAM_FAKE_LATE_CHILD makes `shell` start one more sleeper when SIGTERM reaches it, and writes its pid to late.pid: "same-group"
// has the shell exit after that (what a test runner does when it starts workers late), "own-group" has the shell stay alive and start
// the sleeper in a session of its own. The watchdog ends everything after 30 s, so a test that fails or is abandoned does not leave
// processes behind.
const LATE_SHELL = `trap 'trap "" TERM; sleep 60 & echo $! > late.pid; exit' TERM
sleep 60 & echo $!
wait
`;
const LATE_NODE_SHELL = `const { spawn } = require("node:child_process");
const fs = require("node:fs");
console.log(spawn("sleep", ["60"], { stdio: "ignore" }).pid);
process.on("SIGTERM", () => {
  const late = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
  fs.writeFileSync("late.pid", String(late.pid));
});
setInterval(() => {}, 1000);
`;
const HANGING_CLAUDE = `#!/usr/bin/env node
if (process.argv[2] === "--warm") process.exit(0);
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const ignoreTerm = process.env.TEAM_FAKE_IGNORE_TERM === "1";
if (ignoreTerm) process.on("SIGTERM", () => {});
const trap = ignoreTerm ? "trap '' TERM; " : "";
const tool = spawn("sh", ["-c", trap + "exec sleep 60"], { stdio: "ignore" });
const late = process.env.TEAM_FAKE_LATE_CHILD;
const [shellBin, shellArgs] = late === "own-group"
  ? [process.execPath, ["-e", ${JSON.stringify(LATE_NODE_SHELL)}]]
  : ["sh", ["-c", late === "same-group" ? ${JSON.stringify(LATE_SHELL)} : trap + "sleep 60 & echo $!; wait"]];
const shell = spawn(shellBin, shellArgs, { cwd: __dirname, detached: true, stdio: ["ignore", "pipe", "ignore"] });
const pids = { claude: process.pid, tool: tool.pid, shell: shell.pid };
shell.stdout.once("data", (d) => {
  pids.sleeper = Number(d.toString());
  const file = path.join(__dirname, "pids.json");
  fs.writeFileSync(file + ".tmp", JSON.stringify(pids));
  fs.renameSync(file + ".tmp", file);
});
setTimeout(() => {
  for (const pid of Object.values(pids)) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}, 30000);
process.stdin.resume();
`;

// A claude that answers and exits while a tool it started (`holder`) is still running with claude's stdout, which keeps the pipe open.
const LINGERING_CLAUDE = `#!/usr/bin/env node
if (process.argv[2] === "--warm") process.exit(0);
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const holder = spawn("sleep", ["20"], { stdio: ["ignore", "inherit", "ignore"] });
holder.unref();
fs.writeFileSync(path.join(__dirname, "pids.json"), JSON.stringify({ claude: process.pid, holder: holder.pid }));
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(${JSON.stringify(JSON.stringify(FAKE_RESULT))}));
`;

// A claude that dies without having read its prompt.
const EXITING_CLAUDE = `#!/usr/bin/env node
process.exit(1);
`;

type Pids = Record<string, number>;

const TURN = { member: "e1", role: "engineer", canEdit: true, system: "s", user: "u", sections: [] };
const contextOf = (root: string) => ({ state: { externalWorkspace: false } as SessionState, root });
const claudeCli = () => new ClaudeCliBackend({ type: "claude-cli" });
const hangingTurn = (root: string) => claudeCli().respond(TURN, contextOf(root));
const slow = { skip, timeout: 60_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
};
const survivors = (pids: Pids) => Object.entries(pids).filter(([, pid]) => alive(pid)).map(([name]) => name);

/** A killed process stays visible until init has reaped it, so give that a moment before judging. */
async function assertGone(pids: Pids): Promise<void> {
  const end = Date.now() + 3000;
  while (survivors(pids).length > 0 && Date.now() < end) await sleep(25);
  assert.deepEqual(survivors(pids), [], "processes of the turn are still running");
}

async function waitFor(what: string, done: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) assert.fail(`gave up waiting for ${what}`);
    await sleep(25);
  }
}

async function rejection(promise: Promise<unknown>): Promise<ReplyError> {
  try {
    await promise;
  } catch (e) {
    return e as ReplyError;
  }
  return assert.fail("the turn should have been rejected");
}

/** Runs `run` against a fake claude made from `script`, and kills everything the fake started whether or not `run` throws. */
async function withFakeClaude<T>(
  script: string,
  env: Record<string, string | undefined>,
  run: (root: string, pids: () => Pids) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "team-claude-"));
  const bin = path.join(root, "claude");
  fs.writeFileSync(bin, script);
  fs.chmodSync(bin, 0o755);
  // The first run of a new executable is slow (macOS checks it first). Take that before the clock of a turn's timeout starts.
  spawnSync(bin, ["--warm"], { stdio: "ignore" });
  const pids = (): Pids => {
    const started: Pids = JSON.parse(fs.readFileSync(path.join(root, "pids.json"), "utf8"));
    const lateFile = path.join(root, "late.pid");
    const late = fs.existsSync(lateFile) ? Number(fs.readFileSync(lateFile, "utf8")) : 0; // 0 and NaN: not written yet
    return late > 1 ? { ...started, late } : started;
  };
  try {
    return await withEnv({ TEAM_CLAUDE_BIN: bin, ...env }, () => run(root, pids));
  } finally {
    let left: number[] = [];
    try {
      left = Object.values(pids());
    } catch {}
    for (const pid of left) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const HOOKED = ["exit", "SIGINT", "SIGTERM", "SIGHUP"];
const listenerCounts = () => HOOKED.map((event) => process.listenerCount(event));

test("an invalid TEAM_TURN_TIMEOUT is rejected when the backend is created", async () => {
  for (const bad of ["0", "-5", "abc", "", "NaN", "Infinity", "10m"]) {
    await withEnv({ TEAM_TURN_TIMEOUT: bad }, () => {
      assert.throws(claudeCli, /TEAM_TURN_TIMEOUT must be a positive number of seconds/, `TEAM_TURN_TIMEOUT=${JSON.stringify(bad)}`);
    });
  }
});

test("TEAM_TURN_TIMEOUT is optional and takes any positive number of seconds", async () => {
  for (const ok of [undefined, "1800", "0.5", "1e3"]) {
    await withEnv({ TEAM_TURN_TIMEOUT: ok }, () => assert.doesNotThrow(claudeCli, `TEAM_TURN_TIMEOUT=${ok}`));
  }
});

test("a timeout longer than a timer can count does not fire at once", { skip }, async () => {
  const { reply } = await withEnv({ TEAM_TURN_TIMEOUT: "99999999" }, () => turnWith());
  assert.equal(reply.text, "[SAY to=all] ok");
});

/** Runs a hanging turn until the timeout rejects it, and makes sure the fake had started its processes by then. */
async function timedOutTurn(root: string) {
  const started = Date.now();
  const error = await rejection(hangingTurn(root));
  const elapsed = Date.now() - started;
  assert.ok(fs.existsSync(path.join(root, "pids.json")), "the fake claude had not started its processes when the timeout fired: the machine is too busy for this test");
  return { error, elapsed };
}

/** Collects what is written to stderr until restored. */
function captureStderr() {
  const written: string[] = [];
  const spy = mock.method(process.stderr, "write", ((chunk: unknown) => (written.push(String(chunk)), true)) as typeof process.stderr.write);
  return { text: () => written.join(""), restore: () => spy.mock.restore() };
}

test("a turn that outlives TEAM_TURN_TIMEOUT fails and takes everything it started down with it", slow, async () => {
  await withFakeClaude(HANGING_CLAUDE, { TEAM_TURN_TIMEOUT: "3" }, async (root, pids) => {
    const listeners = listenerCounts();
    const { error, elapsed } = await timedOutTurn(root);
    const spent = error.usage?.durationMs ?? -1;
    assert.equal(error.name, "TurnTimeoutError");
    assert.match(error.message, /timed out after 3 seconds/);
    assert.equal(error.usage?.tokens, undefined, "a killed turn reports no tokens");
    assert.equal(error.usage?.costUsd, undefined, "or cost");
    assert.ok(spent >= 2900 && spent <= elapsed, `the time spent is reported: ${spent} ms of ${elapsed}`);
    assert.ok(elapsed >= 2900 && elapsed < 9000, `rejected after ${elapsed} ms`);
    await assertGone(pids());
    assert.deepEqual(listenerCounts(), listeners, "no listener is left behind");
  });
});

test("a turn whose processes ignore SIGTERM is killed outright after a grace period", slow, async () => {
  await withFakeClaude(HANGING_CLAUDE, { TEAM_TURN_TIMEOUT: "2", TEAM_FAKE_IGNORE_TERM: "1" }, async (root, pids) => {
    const { error, elapsed } = await timedOutTurn(root);
    assert.match(error.message, /timed out after 2 seconds/);
    assert.ok(elapsed > 2500 && elapsed < 15_000, `rejected after ${elapsed} ms: SIGTERM alone should not have ended it`);
    await assertGone(pids());
  });
});

for (const where of ["same-group", "own-group"]) {
  test(`a process the turn starts while it is being terminated, in ${where === "own-group" ? "a group of its own" : "the group it was started from"}, is killed too`, slow, async () => {
    await withFakeClaude(HANGING_CLAUDE, { TEAM_TURN_TIMEOUT: "2", TEAM_FAKE_LATE_CHILD: where }, async (root, pids) => {
      await timedOutTurn(root);
      const processes = pids();
      assert.ok(processes.late, "the shell started its late child when SIGTERM reached it");
      await assertGone(processes);
    });
  });
}

test("a turn ends when claude exits, even if something it started still holds its pipes open", slow, async () => {
  await withFakeClaude(LINGERING_CLAUDE, { TEAM_TURN_TIMEOUT: "5" }, async (root) => {
    const listeners = listenerCounts();
    const started = Date.now();
    const reply = await hangingTurn(root);
    const elapsed = Date.now() - started;
    assert.equal(reply.text, "[SAY to=all] ok");
    assert.ok(elapsed < 3000, `took ${elapsed} ms: claude's answer should not wait for what it left running`);
    assert.deepEqual(listenerCounts(), listeners, "no listener is left behind");
  });
});

test("a claude that dies before reading its prompt fails the turn instead of crashing the run", { skip }, async () => {
  await withFakeClaude(EXITING_CLAUDE, {}, async (root) => {
    // more than a pipe holds, so that writing it is still going on when claude is gone
    const turn = { ...TURN, user: "x".repeat(2_000_000) };
    await assert.rejects(claudeCli().respond(turn, contextOf(root)), /claude exited with 1/);
  });
});

test("a turn ends at its timeout even if its processes cannot be killed, and the failure is reported", slow, async () => {
  const { ProcessTree } = await import("../src/backends/process-tree.ts");
  await withFakeClaude(HANGING_CLAUDE, { TEAM_TURN_TIMEOUT: "2" }, async (root) => {
    const listeners = listenerCounts();
    const terminate = ProcessTree.prototype.terminate;
    ProcessTree.prototype.terminate = () => Promise.reject(new Error("ps exploded"));
    const stderr = captureStderr();
    try {
      const { error } = await timedOutTurn(root);
      assert.equal(error.name, "TurnTimeoutError");
      assert.match(stderr.text(), /could not kill.*ps exploded/);
    } finally {
      stderr.restore();
      ProcessTree.prototype.terminate = terminate;
    }
    assert.deepEqual(listenerCounts(), listeners, "the turn let go of its listeners");
  });
});

test("without a working ps only the turn's own process group is killed, and that is said once", slow, async () => {
  const { ProcessTree } = await import("../src/backends/process-tree.ts");
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), "team-ps-"));
  fs.writeFileSync(path.join(stub, "ps"), "#!/bin/sh\nexit 1\n");
  fs.chmodSync(path.join(stub, "ps"), 0o755);
  const stderr = captureStderr();
  try {
    await withFakeClaude(HANGING_CLAUDE, { TEAM_TURN_TIMEOUT: "2", PATH: `${stub}${path.delimiter}${process.env.PATH}` }, async (root, pids) => {
      await timedOutTurn(root);
      assert.deepEqual(survivors(pids()), ["shell", "sleeper"], "claude's group is gone, the group the shell runs in is not found");
      assert.equal(stderr.text().match(/cannot list processes/g)?.length, 1, stderr.text());
      new ProcessTree(2 ** 30).kill();
      assert.equal(stderr.text().match(/cannot list processes/g)?.length, 1, "not again for the next tree");
    });
  } finally {
    stderr.restore();
    fs.rmSync(stub, { recursive: true, force: true });
  }
});

test("parallel turns share one set of exit and signal listeners, and no turn leaves any behind", { skip }, async () => {
  await withFakeClaude(FAKE_CLAUDE, {}, async (root) => {
    const before = listenerCounts();
    const backend = claudeCli();
    const turns = [1, 2, 3].map(() => backend.respond(TURN, contextOf(root)));
    assert.deepEqual(listenerCounts(), before.map((n) => n + 1), "three live turns, one listener each");
    await Promise.all(turns);
    assert.deepEqual(listenerCounts(), before, "after turns that succeeded");
    await withEnv({ TEAM_FAKE_EXIT: "1" }, async () => {
      await rejection(backend.respond(TURN, contextOf(root)));
    });
    assert.deepEqual(listenerCounts(), before, "after a turn that failed");
    await withEnv({ TEAM_CLAUDE_BIN: path.join(root, "missing") }, async () => {
      await assert.rejects(claudeCli().respond(TURN, contextOf(root)), /failed to start/);
    });
    assert.deepEqual(listenerCounts(), before, "after a claude that could not start");
  });
});

// The turn's process group no longer gets the terminal's Ctrl-C, so the team process has to take the turn down itself.
const RUNNER = `import * as fs from "node:fs";
import * as path from "node:path";
const { ClaudeCliBackend } = await import(process.env.BACKEND_URL);
const [root, how] = process.argv.slice(2);
new ClaudeCliBackend({ type: "claude-cli" })
  .respond({ member: "e1", role: "engineer", canEdit: true, system: "s", user: "u", sections: [] }, { state: { externalWorkspace: false }, root })
  .catch(() => {});
if (how === "exit") {
  while (!fs.existsSync(path.join(root, "pids.json"))) await new Promise((resolve) => setTimeout(resolve, 25));
  process.exit(3);
}
`;

for (const how of ["SIGINT", "SIGTERM", "SIGHUP", "exit"] as const) {
  const when = how === "exit" ? "exiting" : `receiving ${how}`;
  test(`the team process ${when} while a turn runs takes the turn's whole tree down with it`, slow, async () => {
    await withFakeClaude(HANGING_CLAUDE, {}, async (root, pids) => {
      const script = path.join(root, "runner.mjs");
      fs.writeFileSync(script, RUNNER);
      const env = {
        ...process.env,
        TEAM_CLAUDE_BIN: path.join(root, "claude"),
        TEAM_TURN_TIMEOUT: "600",
        BACKEND_URL: new URL("../src/backends/claude-cli.ts", import.meta.url).href,
      };
      const runner = spawn(process.execPath, [script, root, how], { env, stdio: "ignore" });
      const ended = new Promise<[number | null, string | null]>((resolve) => runner.on("exit", (code, signal) => resolve([code, signal])));
      try {
        await waitFor("the fake claude to start its processes", () => fs.existsSync(path.join(root, "pids.json")));
        if (how !== "exit") runner.kill(how);
        assert.deepEqual(await ended, how === "exit" ? [3, null] : [null, how]);
        await assertGone(pids());
      } finally {
        runner.kill("SIGKILL");
      }
    });
  });
}

test("when another listener survives the signal, the next turn is guarded again", slow, async () => {
  await withFakeClaude(HANGING_CLAUDE, { TEAM_TURN_TIMEOUT: "600" }, async (root, pids) => {
    const quickClaude = path.join(root, "claude-quick");
    fs.writeFileSync(quickClaude, FAKE_CLAUDE);
    fs.chmodSync(quickClaude, 0o755);
    const baseline = listenerCounts();
    // The handler passes the signal on to its own process, which here is not allowed to end it.
    const raised: unknown[] = [];
    const realKill = process.kill;
    const kill = mock.method(process, "kill", ((pid: number, signal?: string | number) => {
      if (pid !== process.pid) return realKill.call(process, pid, signal);
      raised.push(signal);
      return true;
    }) as typeof process.kill);
    try {
      const first = hangingTurn(root).catch(() => {});
      await waitFor("the fake claude to start its processes", () => fs.existsSync(path.join(root, "pids.json")));
      const processes = pids();
      process.emit("SIGINT", "SIGINT"); // as Node does for a real one: the listener is told which signal it got
      assert.deepEqual(raised, ["SIGINT"]);
      const second = withEnv({ TEAM_CLAUDE_BIN: quickClaude }, () => claudeCli().respond(TURN, contextOf(root)));
      assert.deepEqual(listenerCounts(), baseline.map((n) => n + 1), "the second turn has its exit and signal listeners");
      assert.equal((await second).text, "[SAY to=all] ok");
      await first;
      await assertGone(processes);
      assert.deepEqual(listenerCounts(), baseline, "both turns let go of their listeners");
    } finally {
      kill.mock.restore();
    }
  });
});
