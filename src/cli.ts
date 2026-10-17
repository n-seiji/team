// team — simulate a product team (PM, engineers, user personas) that talks and builds together.
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { text } from "node:stream/consumers";
import { Store, loadConfig, loadPersona } from "./store.ts";
import { World, isPrivate } from "./world.ts";
import { DEFAULT_PHASES, subagentFor } from "./sop.ts";
import { buildPrompt, listWorkspace, promptAsText } from "./prompt.ts";
import { formatBacklog, formatEntry, displayName } from "./render.ts";
import { createBackend } from "./backends/index.ts";
import { findOverlaps, formatOverlap, otherSessionChanges, sameRepoChanges } from "./overlap.ts";
import type { BackendConfig } from "./types.ts";

const HELP = `team — PM・エンジニア・ペルソナ(ユーザー)が会話しながら開発するシミュレーター

Usage: team <command> [options]

Session
  init [<brief>] --brief <text> | --brief-file <f>  [--name <n>] [--config <f>] [--workspace <dir>] [--force] [--json]
                       新しいセッションを作成して current にする (--json は next --json と同じ出力)
                       --workspace: 既存のコードベース (git worktree など) をそのまま作業場所にする
  status [--json]      フェーズ・バックログ・次の発言者を表示
  log [--tail N] [--md] [--no-thoughts]
                       会話ログを表示 (--md は transcript.md のパス)
  sessions             セッション一覧 / use <name> で切り替え
  overlaps [--json]    同じリポジトリを触る他のセッションと、同じファイル・同じ番号のファイルが重なっていないか確認
  say <text>           人間(あなた)としてチーム全員に発言を差し込む

Host mode (Claude Code などの外部オーケストレーターが各エージェントを実行)
  next [--json] [--inline]
                       次に行動すべきメンバーと、そのメンバー用プロンプトを出力
                       (プロンプトは .team/sessions/<s>/turns/*.prompt.md にも保存)
  record --as <id> [--file <f>] [--force] [--json]
                       メンバーの返答(stdin か --file)を記録して次へ進める (--json は next --json と同じ出力)

Auto mode (このプロセスが LLM を呼ぶ)
  run [--backend anthropic|claude-cli|mock] [--model <m>] [--turns N]

Global options
  --root <dir>         リポジトリルート (default: cwd)
  --session <name>     current 以外のセッションを対象にする
`;

const OPTIONS = {
  root: { type: "string" },
  session: { type: "string" },
  config: { type: "string" },
  brief: { type: "string" },
  "brief-file": { type: "string" },
  name: { type: "string" },
  workspace: { type: "string" },
  as: { type: "string" },
  file: { type: "string" },
  backend: { type: "string" },
  model: { type: "string" },
  turns: { type: "string" },
  tail: { type: "string" },
  force: { type: "boolean" },
  json: { type: "boolean" },
  inline: { type: "boolean" },
  md: { type: "boolean" },
  "no-thoughts": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("no reply given: pipe it via stdin or use --file");
  return text(process.stdin);
}

export async function main(argv: string[], out: (s: string) => void = (s) => process.stdout.write(s + "\n")) {
  const { values: flags, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [first = "help", ...pos] = positionals;
  const cmd = flags.help ? "help" : first;
  const root = path.resolve(flags.root ?? process.cwd());
  const store = new Store(root);
  const session = flags.session;
  const load = () => store.load(session);

  /** Schedule the next speaker(s) and print their turn prompts (`next`, and `init --json`). */
  function next(w: World) {
    const ids = w.next();
    const es = store.transcript(w.state.name);
    const view = es.concat(w.emitted);
    const files = listWorkspace(w.state, root);
    const others = otherSessionChanges(store, w.state);
    const turnsDir = path.join(store.sessionDir(w.state.name), "turns");
    if (ids.length) fs.mkdirSync(turnsDir, { recursive: true });
    const items = ids.map((id) => {
      const p = buildPrompt(w.state, id, view, files, { others });
      const text = promptAsText(p);
      // Prompts are also written to files so an orchestrator can hand a short
      // path to a subagent instead of copying the whole prompt through its context.
      const file = path.join(turnsDir, `${String(w.state.turn).padStart(4, "0")}-${id}.prompt.md`);
      fs.writeFileSync(file, text);
      return {
        member: id,
        name: w.member(id)!.persona.name,
        role: p.role,
        subagent: subagentFor(p.role),
        canEdit: p.canEdit,
        promptFile: path.relative(root, file).split(path.sep).join("/"),
        text,
      };
    });
    store.save(w, es); // no-op unless scheduling advanced
    if (flags.json) {
      const pending = items.map(({ text, ...it }) => (flags.inline ? { ...it, prompt: text } : it));
      out(JSON.stringify({ status: w.state.status, phase: w.phase.id, iteration: w.state.iteration, round: w.state.round, pending }, null, 2));
    } else if (w.state.status === "done") {
      out("session is done. See: team log / team status");
    } else {
      for (const it of items) {
        out(`===== NEXT: ${it.member} (${it.role}) → subagent: ${it.subagent} =====`);
        out(it.text);
      }
    }
  }

  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      out(HELP);
      return;

    case "init": {
      const cfg = loadConfig(root, flags.config);
      const briefFile = flags["brief-file"];
      const brief = (briefFile ? fs.readFileSync(path.resolve(root, briefFile), "utf8") : flags.brief ?? pos.join(" ")).trim();
      if (!brief) throw new Error("a product brief is required: --brief \"...\"");
      const name = flags.name ?? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      if (store.exists(name) && !flags.force) throw new Error(`session "${name}" already exists (use --force to overwrite)`);
      // An existing codebase (e.g. a git worktree of another repository) is used in place.
      const external = flags.workspace ? path.resolve(root, flags.workspace) : undefined;
      if (external && !fs.statSync(external, { throwIfNoEntry: false })?.isDirectory())
        throw new Error(`workspace not found: ${flags.workspace}`);
      if (flags.force) fs.rmSync(store.sessionDir(name), { recursive: true, force: true });
      const w = World.create({
        name,
        brief,
        members: cfg.members.map((f) => loadPersona(root, f)),
        phases: cfg.phases ?? DEFAULT_PHASES,
        language: cfg.language,
        // each session builds in its own folder so sessions (e.g. parallel cloud threads) never share files
        workspace: external
          ? path.relative(root, external).split(path.sep).join("/") || "."
          : path.posix.join(cfg.workspace ?? "workspace", name),
        externalWorkspace: !!external,
        maxIterations: cfg.maxIterations,
        historyWindow: cfg.historyWindow,
      });
      fs.mkdirSync(path.resolve(root, w.state.workspace), { recursive: true });
      store.save(w);
      store.setCurrent(name);
      // With --json, answer like `next --json` so an orchestrator can start the first turn without another call.
      if (flags.json) return next(w);
      out(`created session "${name}" with ${w.state.members.length} members → .team/sessions/${name}/`);
      out(statusText(w));
      return;
    }

    case "sessions": {
      let cur = "";
      try {
        cur = store.current();
      } catch {}
      for (const n of store.list()) out(`${n === cur ? "*" : " "} ${n}`);
      return;
    }

    case "use": {
      if (!pos[0] || !store.exists(pos[0])) throw new Error(`session not found: ${pos[0] ?? ""}`);
      store.setCurrent(pos[0]);
      out(`current session: ${pos[0]}`);
      return;
    }

    case "status": {
      const w = load();
      const overlaps = findOverlaps(sameRepoChanges(store, w.state)).filter((o) => o.sessions.some((x) => x.session === w.state.name));
      if (flags.json) out(JSON.stringify({ ...w.state, phase: w.phase.id, next: w.next(), overlaps }, null, 2));
      else {
        out(statusText(w));
        if (overlaps.length) out(["overlaps with other sessions:", ...overlaps.map((o) => "  " + formatOverlap(o))].join("\n"));
      }
      return;
    }

    case "overlaps": {
      const w = load();
      const changes = sameRepoChanges(store, w.state);
      const overlaps = findOverlaps(changes);
      if (flags.json) out(JSON.stringify({ sessions: changes.map((c) => c.session), overlaps }, null, 2));
      else if (!w.state.externalWorkspace) out("this session builds in its own folder; nothing to compare (see init --workspace).");
      else if (!overlaps.length) out(`no overlaps among ${changes.map((c) => c.session).join(", ")}`);
      else for (const o of overlaps) out(formatOverlap(o));
      return;
    }

    case "log": {
      const w = load();
      if (flags.md) {
        out(path.join(store.sessionDir(w.state.name), "transcript.md"));
        return;
      }
      let es = store.transcript(w.state.name);
      if (flags["no-thoughts"]) es = es.filter((e) => !isPrivate(e));
      const tail = Number(flags.tail ?? 0);
      if (tail > 0) es = es.slice(-tail);
      for (const e of es) out(`[${e.iteration}:${e.phase}#${e.turn}] ${formatEntry(w.state, e)}`);
      return;
    }

    case "say": {
      const w = load();
      const text = pos.join(" ").trim() || (await readStdin()).trim();
      w.broadcast(text, flags.as);
      store.save(w);
      out("ok");
      return;
    }

    case "next":
      next(load());
      return;

    case "record": {
      const w = load();
      const id = flags.as;
      if (!id) throw new Error("--as <member-id> is required");
      const file = flags.file;
      const raw = file ? fs.readFileSync(path.resolve(root, file), "utf8") : await readStdin();
      const actions = w.record(id, raw, { force: !!flags.force });
      store.save(w);
      // With --json, answer like `next --json` so the orchestrator saves a call per turn.
      if (flags.json) return next(w);
      const ids = w.next();
      store.save(w);
      out(`recorded ${actions.length} action(s) from ${id}: ${actions.map((a) => a.type).join(", ") || "-"}`);
      out(w.state.status === "done" ? "session is done." : `next: ${ids.join(", ")} (phase ${w.phase.id}, round ${w.state.round})`);
      return;
    }

    case "run": {
      const cfg = loadConfig(root, flags.config);
      const bcfg: BackendConfig = { ...(cfg.backend ?? { type: "mock" }) };
      const b = flags.backend;
      if (b) bcfg.type = b as BackendConfig["type"];
      if (flags.model) bcfg.model = flags.model;
      const backend = createBackend(bcfg);
      const maxTurns = Number(flags.turns ?? 200);
      let turns = 0;
      const w = load();
      const es = store.transcript(w.state.name); // kept in memory for the whole run
      while (w.state.status === "running" && turns < maxTurns) {
        const ids = w.next();
        const view = es.concat(w.emitted);
        const files = listWorkspace(w.state, root);
        const others = otherSessionChanges(store, w.state);
        const ctx = { state: w.state, root };
        // Members scheduled in the same step act in parallel (like TinyWorld steps).
        const replies = await Promise.allSettled(
          ids.map((id) => withRetry(() => backend.respond(buildPrompt(w.state, id, view, files, { others }), ctx))),
        );
        // Keep the replies that came back even if a sibling failed: their file edits are already on disk.
        ids.forEach((id, i) => {
          const r = replies[i];
          if (r.status === "rejected") return;
          const before = w.emitted.length;
          w.record(id, r.value);
          for (const e of w.emitted.slice(before)) out(`[${e.phase}] ${formatEntry(w.state, e)}`);
        });
        const fresh = [...w.emitted];
        store.save(w, es);
        es.push(...fresh);
        turns += ids.length;
        const failed = replies.flatMap((r, i) => (r.status === "rejected" ? [`${ids[i]}: ${String(r.reason?.message ?? r.reason)}`] : []));
        if (failed.length) throw new Error(`turn failed after retries (run again to resume)\n${failed.join("\n")}`);
      }
      out(w.state.status === "done" ? "session is done." : `stopped after ${turns} turn(s); run again to continue.`);
      return;
    }

    default:
      throw new Error(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

function statusText(w: World): string {
  const s = w.state;
  const next = w.next();
  const lines = [
    `session: ${s.name}  status: ${s.status}  iteration: ${s.iteration}/${s.maxIterations}`,
    `phase: ${w.phase.id} (round ${s.round}/${w.phase.maxRounds}, ${w.phase.mode}) — ${w.phase.goal}`,
    `next: ${s.status === "done" ? "-" : next.map((id) => displayName(s, id)).join(", ")}`,
    "backlog:",
    formatBacklog(s.tasks, "  (none)"),
  ];
  if (s.externalWorkspace) lines.splice(1, 0, `workspace: ${s.workspace} (existing codebase)`);
  return lines.join("\n");
}

/** Backends fail transiently (rate limits, overload, an occasional safeguard refusal); try a turn up to 3 times. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 5000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}
