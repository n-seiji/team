// Stopping what a turn started. `claude -p` runs its tools as child processes, and Claude Code's Bash tool even puts each command in a
// process group of its own, so signalling `claude` alone would leave a hung command running. A turn is claude's process group
// (`spawn(..., { detached: true })` makes claude its leader) plus everything descended from a member of it, in whatever groups that runs.
// A process whose parent has died is re-parented to init and nothing links it to the turn any more; only a subreaper (which Node cannot
// become) would still find it. Such an orphan is reached only while it stays in a group the turn is known to have. Windows has
// `taskkill /T` for the same job.
import { spawnSync } from "node:child_process";

const GRACE_MS = 3000;
const POLL_MS = 50;
const HOOKED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const win32 = process.platform === "win32";

interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
}

/** The turn's processes at one moment: every pid in it and every process group those belong to. */
interface Members {
  pids: Set<number>;
  groups: Set<number>;
}

let warnedAboutPs = false;

/** Every process on the machine, or undefined (with a warning, once) when `ps` cannot list them: missing, or BusyBox's without -A or -o. */
function listProcesses(): Proc[] | undefined {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8" });
  const procs: Proc[] = [];
  for (const line of (ps.stdout ?? "").split("\n")) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isInteger(pgid)) procs.push({ pid, ppid, pgid });
  }
  if (ps.status === 0 && procs.some((p) => p.pid === process.pid)) return procs;
  if (!warnedAboutPs) {
    warnedAboutPs = true;
    process.stderr.write("warning: cannot list processes with `ps -A -o pid=,ppid=,pgid=`, so only the process group of a stopped turn is killed\n");
  }
  return undefined;
}

const send = (pid: number, signal: NodeJS.Signals | 0): boolean => {
  if (Math.abs(pid) < 2) return false; // 0, -0 and -1 would reach our own group or every process, 1 is init
  try {
    return process.kill(pid, signal);
  } catch {
    return false; // already gone, or not ours to signal
  }
};

const merge = (a: Members, b: Members): Members => ({ pids: new Set([...a.pids, ...b.pids]), groups: new Set([...a.groups, ...b.groups]) });

const watched = new Set<ProcessTree>();

// There is no one to escalate to when this process is going away, so these kill outright.
const killWatched = (): void => {
  for (const tree of watched) tree.kill();
};
const onSignal = (signal: NodeJS.Signals): void => {
  killWatched();
  watched.clear(); // those turns are gone; another listener may keep this process alive, and it must not think they are still watched
  unhook();
  process.kill(process.pid, signal); // handled now by whatever the default is, as if we had never listened
};
const hook = (): void => {
  process.on("exit", killWatched);
  for (const signal of HOOKED_SIGNALS) process.on(signal, onSignal);
};
const unhook = (): void => {
  process.off("exit", killWatched);
  for (const signal of HOOKED_SIGNALS) process.off(signal, onSignal);
};

/** The processes of one running turn. */
export class ProcessTree {
  private readonly root: number;
  private rootGone = false;

  /** `root` is claude's pid. It leads the turn's process group, and no other group gets its id while a member of this one lives. */
  constructor(root: number) {
    this.root = root;
  }

  /**
   * Claude has exited and its pid may soon belong to another process, so nothing is killed by it now. On POSIX the group still finds the
   * turn: its id is not reused while a member lives.
   */
  rootExited(): void {
    this.rootGone = true;
  }

  /**
   * Taken before anything is signalled: once a parent dies its children are re-parented and lost. A later snapshot gets the earlier one
   * as `known`, because claude may be gone by then and only the groups it started, still alive, lead to what they have started since.
   */
  private snapshot(known?: Members): Members {
    const procs = win32 ? undefined : listProcesses();
    if (!procs) return { pids: new Set(), groups: new Set([this.root]) };
    const own = procs.find((p) => p.pid === process.pid)!.pgid;
    const children = new Map<number, Proc[]>();
    for (const p of procs) {
      const siblings = children.get(p.ppid);
      if (siblings) siblings.push(p);
      else children.set(p.ppid, [p]);
    }
    const roots = known?.groups ?? new Set([this.root]);
    const found = procs.filter((p) => roots.has(p.pgid)); // the members of the groups are the roots: claude itself may be gone
    const pids = new Set(found.map((p) => p.pid));
    for (const p of found) {
      for (const child of children.get(p.pid) ?? []) {
        if (!pids.has(child.pid)) {
          pids.add(child.pid);
          found.push(child);
        }
      }
    }
    const groups = new Set([this.root]);
    for (const p of found) if (p.pgid !== own) groups.add(p.pgid);
    return { pids, groups };
  }

  private signal(members: Members, signal: "SIGTERM" | "SIGKILL"): void {
    if (win32) {
      if (!this.rootGone) spawnSync("taskkill", ["/pid", String(this.root), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    }
    for (const group of members.groups) send(-group, signal);
    for (const pid of members.pids) send(pid, signal); // one that left its group after the snapshot is missed by the group signal
  }

  private alive(members: Members): boolean {
    return !win32 && ([...members.groups].some((group) => send(-group, 0)) || [...members.pids].some((pid) => send(pid, 0)));
  }

  /** SIGTERM so claude can clean up, SIGKILL for whatever is still alive after a grace period. Resolves once nothing is left to wait for. */
  async terminate(): Promise<void> {
    let members = this.snapshot();
    this.signal(members, "SIGTERM");
    for (let waited = 0; this.alive(members) && waited < GRACE_MS; waited += POLL_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (this.alive(members)) {
      // a process may start a child while it handles SIGTERM (a test runner starting workers), and the first snapshot cannot name it
      members = merge(members, this.snapshot(members));
      this.signal(members, "SIGKILL");
    }
  }

  /** SIGKILL at once. */
  kill(): void {
    this.signal(this.snapshot(), "SIGKILL");
  }

  /**
   * Kills this turn if the process exits or gets SIGINT, SIGTERM or SIGHUP before the turn ends. The turn's process group is out of the
   * terminal's reach, so it no longer gets the Ctrl-C that used to stop it. All turns share one set of listeners, added with the first
   * and removed with the last. Call the returned function when the turn is over.
   */
  watch(): () => void {
    if (watched.size === 0) hook();
    watched.add(this);
    return () => {
      watched.delete(this);
      if (watched.size === 0) unhook();
    };
  }
}
