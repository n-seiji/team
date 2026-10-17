// commit-msg フックの本体。`main.ts hook <コミットメッセージのファイル>` から呼ばれる。
// 方針: 強制しない。終了コードは常に 0(コミットは止めない)。
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { render, replaceable, type CheckResult } from "./render.ts";

const ENGINE = process.argv[1];

function firstLine(text: string): string {
  return text.split("\n").find((l) => !l.startsWith("#") && l.trim() !== "") ?? "";
}

// IDE のコミットボタンなど、端末がないときは undefined。
function openTty(): number | undefined {
  try {
    return openSync(process.env.COMMITCHECK_TTY ?? "/dev/tty", "r");
  } catch {
    return undefined;
  }
}

function readLine(fd: number): string {
  let line = "";
  const buf = Buffer.alloc(1);
  try {
    while (readSync(fd, buf, 0, 1, null) === 1 && buf[0] !== 10) line += String.fromCharCode(buf[0]);
  } catch {
    // 読めなければ空入力(= そのまま続ける)として扱う
  }
  return line.trim();
}

export function runHook(file: string, engine = ENGINE): void {
  const text = readFileSync(file, "utf8");
  const message = firstLine(text);
  const r = spawnSync(process.execPath, [engine, "check", "--json", "--file", file], { encoding: "utf8" });
  if (r.status === 0) {
    // free のときの警告: 通すが、気づけるように1画面だけ出す
    try {
      const w: CheckResult = JSON.parse(r.stdout);
      if (w.problems.length) console.error(render(w, "(警告だけです。コミットは通ります)").join("\n"));
    } catch {
      // 出力が読めなくても通す
    }
    return;
  }
  if (r.status !== 1) {
    // 2: 使い方の誤り・設定ファイルが読めない。表示だけして通す。
    const note = (r.stderr || r.stdout || "チェックを実行できませんでした").trim().split("\n")[0];
    console.error(`${note}\n(コミットは止めません)`);
    return;
  }
  let result: CheckResult;
  try {
    result = JSON.parse(r.stdout);
  } catch {
    console.error("チェック結果を読めませんでした(コミットは止めません)");
    return;
  }
  const fix = replaceable(result);
  const tty = openTty();
  if (tty === undefined) {
    console.error(render(result, "(対話できないため、警告だけ出してコミットは通します)").join("\n"));
    return;
  }
  const prompt = fix ? "[Enter] そのまま続ける / [1] 直し案で置き換える" : "[Enter] そのまま続ける (やめる: Ctrl+C)";
  console.error(render(result, prompt).join("\n"));
  const answer = readLine(tty);
  closeSync(tty);
  if (answer === "1" && fix) {
    const lines = text.split("\n");
    lines[lines.indexOf(message)] = fix;
    writeFileSync(file, lines.join("\n").endsWith("\n") ? lines.join("\n") : `${lines.join("\n")}\n`);
    console.error(`→ ${fix} に置き換えました`);
  }
}
