// `main.ts install-hook`: いま居るリポジトリに commit-msg フックを入れる。
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ENGINE = resolve(import.meta.dirname, "main.ts");
const shq = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

// Node が古い・無いときは、案内だけ出してコミットは通す。
export function hookScript(engine = ENGINE): string {
  return `#!/bin/sh
# commitcheck: コミットメッセージのチェック(警告のみ。コミットは止めません)
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null || {
  echo "Node 22.18 以上が必要です(チェックはスキップしました)" >&2
  exit 0
}
node ${shq(engine)} hook "$1" || true
`;
}

export function installHook(engine = ENGINE): number {
  const g = spawnSync("git", ["rev-parse", "--git-path", "hooks/commit-msg"], { encoding: "utf8" });
  if (g.status !== 0) {
    console.error("git リポジトリの中で実行してください");
    return 2;
  }
  const target = resolve(g.stdout.trim());
  if (existsSync(target)) {
    console.error(
      `${target} がすでにあるため、何も変更していません。\n` +
        `手動で足すには、そのファイルの末尾に次の1行を書いてください:\n` +
        `node ${shq(engine)} hook "$1" || true`,
    );
    return 1;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, hookScript(engine));
  chmodSync(target, 0o755);
  console.log("✓ commit-msg フックを入れました。次の git commit からチェックが走ります");
  return 0;
}
