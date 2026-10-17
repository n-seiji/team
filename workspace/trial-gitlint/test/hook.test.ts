import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hookScript } from "../src/install-hook.ts";

const SRC = resolve(import.meta.dirname, "../src");

// check だけ差し替えた偽エンジン。install-hook / hook は本物を使う。
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  const engine = join(dir, "main.ts");
  writeFileSync(
    engine,
    `import { readFileSync } from "node:fs";
const [c, ...a] = process.argv.slice(2);
if (c === "check") {
  const m = readFileSync(a[a.indexOf("--file") + 1], "utf8").split("\\n")[0];
  if (m === "ok: 直す") process.exit(0);
  if (m === "!") { console.error(".commitrules.json を読めません: 壊れた JSON"); process.exit(2); }
  console.log(JSON.stringify({ ok: false, problems: [{ where: "先頭", why: "『何をしたか』の種類がありません" }], suggestions: [m === "fix" ? "fix: <何を直したか>" : "feat: " + m] }));
  process.exit(1);
}
if (c === "hook") { const { runHook } = await import(${JSON.stringify(join(SRC, "hook.ts"))}); runHook(a[0], process.argv[1]); }
`,
  );
  const repo = join(dir, "repo");
  spawnSync("git", ["init", "-q", repo]);
  return { dir, engine, repo };
}

function install(repo: string, engine: string) {
  const file = join(repo, ".git/hooks/commit-msg");
  writeFileSync(file, hookScript(engine));
  chmodSync(file, 0o755);
  return file;
}

function commit(repo: string, msg: string, env: Record<string, string> = {}) {
  return spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", msg], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdin: "ignore",
  } as never);
}

function last(repo: string) {
  return spawnSync("git", ["-C", repo, "log", "-1", "--format=%s"], { encoding: "utf8" }).stdout.trim();
}

test("終了コード0: 何も出さず通る", () => {
  const { engine, repo } = setup();
  install(repo, engine);
  const r = commit(repo, "ok: 直す", { COMMITCHECK_TTY: "/nonexistent" });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /✗/);
});

test("終了コード1・TTYなし: 警告を stderr に出して通す", () => {
  const { engine, repo } = setup();
  install(repo, engine);
  const r = commit(repo, "fix", { COMMITCHECK_TTY: "/nonexistent" });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /✗ 先頭/);
  assert.match(r.stderr, /対話できない/);
  assert.equal(last(repo), "fix");
  assert.ok(r.stderr.trim().split("\n").filter((l) => !l.startsWith("[")).length <= 6);
});

test("終了コード1・Enter: そのまま続ける。画面は5行以内", () => {
  const { dir, engine, repo } = setup();
  install(repo, engine);
  const tty = join(dir, "tty");
  writeFileSync(tty, "\n");
  const r = commit(repo, "fix", { COMMITCHECK_TTY: tty });
  assert.equal(last(repo), "fix");
  const screen = r.stderr.split("\n").filter((l) => /^(✗|→|\[)/.test(l));
  assert.ok(screen.length <= 5 && screen.length >= 2, r.stderr);
  assert.doesNotMatch(r.stderr, /footer|BREAKING/);
});

test("終了コード1・[1]: メッセージを置き換える(履歴には触れない)", () => {
  const { dir, engine, repo } = setup();
  install(repo, engine);
  const tty = join(dir, "tty");
  writeFileSync(tty, "1\n");
  const r = commit(repo, "ログイン修正", { COMMITCHECK_TTY: tty });
  assert.equal(r.status, 0);
  assert.equal(last(repo), "feat: ログイン修正");
  assert.match(r.stderr, /→ feat: ログイン修正 に置き換えました/);
});

test("雛形(<...>)しかないときは [1] を出さず、置き換えない", () => {
  const { dir, engine, repo } = setup();
  install(repo, engine);
  const tty = join(dir, "tty");
  writeFileSync(tty, "1\n");
  const r = commit(repo, "fix", { COMMITCHECK_TTY: tty });
  assert.equal(last(repo), "fix");
  assert.doesNotMatch(r.stderr, /\[1\]/);
});

test("終了コード2: メッセージだけ表示して通す", () => {
  const { engine, repo } = setup();
  install(repo, engine);
  const r = commit(repo, "!");
  assert.equal(r.status, 0);
  assert.match(r.stderr, /\.commitrules\.json を読めません/);
  assert.equal(last(repo), "!");
});

test("Node が古いときは案内して通す", () => {
  const { dir, engine, repo } = setup();
  const file = install(repo, engine);
  const fake = join(dir, "bin");
  spawnSync("mkdir", ["-p", fake]);
  writeFileSync(join(fake, "node"), `#!/bin/sh\n[ "$1" = "-e" ] && exit 1\nexec ${process.execPath} "$@"\n`);
  chmodSync(join(fake, "node"), 0o755);
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "fix"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fake}:${process.env.PATH}` },
  });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Node 22\.18 以上が必要です/);
  assert.ok(existsSync(file));
});

test("install-hook: 入る・既存があれば上書きせず終了コード1・リポジトリ外は2", () => {
  const { dir, repo } = setup();
  const main = join(SRC, "main.ts");
  const run = (cwd: string) => spawnSync(process.execPath, [main, "install-hook"], { cwd, encoding: "utf8" });
  const a = run(repo);
  assert.equal(a.status, 0);
  const hook = join(repo, ".git/hooks/commit-msg");
  assert.match(readFileSync(hook, "utf8"), /main\.ts/);
  writeFileSync(hook, "#!/bin/sh\necho mine\n");
  const b = run(repo);
  assert.equal(b.status, 1);
  assert.match(b.stderr, /何も変更していません/);
  assert.match(b.stderr, /hook "\$1"/);
  assert.equal(readFileSync(hook, "utf8"), "#!/bin/sh\necho mine\n");
  const c = run(dir);
  assert.equal(c.status, 2);
  assert.match(c.stderr, /git リポジトリの中で実行してください/);
});
