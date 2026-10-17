import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check } from "./check.ts";
import { CONFIG_NAME, ConfigError, STYLES, findRepoRoot, loadStyle } from "./config.ts";
import type { Style } from "./check.ts";
import { installHook } from "./install-hook.ts";
import { runHook } from "./hook.ts";
import { render } from "./render.ts";

const USAGE = `使い方:
  node src/main.ts check [--json] [--file <path>] "メッセージ"
  node src/main.ts init --style conventional|free [--force]
  node src/main.ts install-hook`;

function usage(msg?: string): never {
  console.error(msg ? `${msg}\n${USAGE}` : USAGE);
  process.exit(2);
}

function runCheck(args: string[]): never {
  let json = false;
  let file: string | undefined;
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--file") file = args[++i] ?? usage("--file にパスを指定してください");
    else words.push(args[i]);
  }
  let message = words.join(" ");
  if (file) {
    try {
      // コミットメッセージのファイル: # で始まる行はコメントとして除く
      message = readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n");
    } catch (e) {
      usage(`ファイルを読めません: ${(e as Error).message}`);
    }
  } else if (words.length === 0) usage("メッセージを指定してください");

  let style: Style;
  try {
    style = loadStyle(process.cwd());
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(e.message);
    process.exit(2);
  }
  const r = check(message, { style });
  if (json) {
    console.log(JSON.stringify(r));
  } else {
    // 5 行以内・直し案は 1 つだけ。OK でも警告(free の 1 語)があれば stderr に出す
    // 何も問題がないときは、手で打った人が通ったと分かるように1行だけ出す(フックは --json なので出ない)
    if (r.problems.length) (r.ok ? console.error : console.log)(render(r).join("\n"));
    else console.log("✓ 問題ありません");
  }
  process.exit(r.ok ? 0 : 1);
}

function runInit(args: string[]): never {
  const at = args.indexOf("--style");
  const style = at >= 0 ? args[at + 1] : undefined;
  if (!style || !STYLES.includes(style as Style)) usage('--style に "conventional" か "free" を指定してください');
  const root = findRepoRoot(process.cwd());
  if (!root) {
    console.error("git リポジトリの中で実行してください");
    process.exit(2);
  }
  const file = join(root, CONFIG_NAME);
  // コミット済みのチームのルールを黙って書き換えない
  if (existsSync(file) && !args.includes("--force")) {
    console.error(`すでに ${CONFIG_NAME} があります。上書きするには --force を付けてください`);
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify({ style }, null, 2) + "\n");
  console.log(`${CONFIG_NAME} を作りました (style: ${style})`);
  console.log("このファイルをコミットすると、チーム全員に同じルールが伝わります");
  process.exit(0);
}

function runHookCommand(args: string[]): never {
  if (!args[0]) usage("コミットメッセージのファイルを指定してください");
  runHook(args[0]);
  process.exit(0);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "install-hook") process.exit(installHook());
if (command === "hook") runHookCommand(rest);
if (command === "check") runCheck(rest);
else if (command === "init") runInit(rest);
else usage(command ? `知らないコマンドです: ${command}` : undefined);
