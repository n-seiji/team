// Trial runs: before users judge, the runtime itself runs the team's verification command ([VERIFY]) and
// keeps its real output and files, so acceptance rests on what actually ran rather than on what agents say.
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { World } from "./world.ts";
import { artifactsDir } from "./prompt.ts";

const OUTPUT_TAIL = 4000;

/** Run the verification command if the current phase is due for one. Returns whether it ran (or was skipped). */
export function runTrialIfDue(w: World, root: string, log: (s: string) => void = () => {}): boolean {
  if (!w.trialDue) return false;
  const s = w.state;
  const command = s.verify?.command ?? "";
  if (!command) {
    w.addTrial({ command: "", exitCode: null, output: "", artifacts: [] });
    return true;
  }
  const dir = path.join(root, artifactsDir(s.name), `iteration-${s.iteration}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const timeout = Number(process.env.TEAM_VERIFY_TIMEOUT ?? 600) * 1000;
  log(`running the team's verification command: ${command}`);
  const r = spawnSync(command, {
    cwd: path.resolve(root, s.workspace),
    shell: true,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, TEAM_ARTIFACTS: dir },
  });
  const full = [r.stdout ?? "", r.stderr ? `--- stderr ---\n${r.stderr}` : "", r.error && !r.stdout ? String(r.error) : ""]
    .filter(Boolean)
    .join("\n");
  fs.writeFileSync(path.join(dir, "verify.log"), `$ ${command}\n${full}\n[exit ${r.status}${r.signal ? `, ${r.signal}` : ""}]\n`);
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  w.addTrial({
    command,
    exitCode: r.status,
    ...(timedOut ? { timedOut } : {}),
    output: full.length > OUTPUT_TAIL ? "…\n" + full.slice(-OUTPUT_TAIL) : full,
    artifacts: listFiles(dir).map((f) => path.relative(root, f).split(path.sep).join("/")),
  });
  return true;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(f));
    else out.push(f);
  }
  return out.sort();
}
