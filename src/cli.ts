// team — simulate a product team (PM, engineers, user personas) that talks and builds together.
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { text } from "node:stream/consumers";
import { Store, loadConfig, loadPersona } from "./store.ts";
import { World, answersByQuestion, isPrivate, questionId } from "./world.ts";
import { DEFAULT_PHASES, subagentFor } from "./sop.ts";
import { buildPrompt, listWorkspace, promptAsText } from "./prompt.ts";
import { formatBacklog, formatEntry, formatQuestions, displayName } from "./render.ts";
import { createBackend } from "./backends/index.ts";
import { findOverlaps, formatOverlap, otherSessionChanges, sameRepoChanges } from "./overlap.ts";
import { runTrialIfDue } from "./verify.ts";
import { renderHtml } from "./html.ts";
import type { BackendConfig } from "./types.ts";

const HELP = `team — PM・エンジニア・ペルソナ(ユーザー)が会話しながら開発するシミュレーター

Usage: team <command> [options]

Session
  init [<brief>] --brief <text> | --brief-file <f>  [--name <n>] [--config <f>] [--workspace <dir>] [--force] [--json]
                       新しいセッションを作成して current にする (--json は next --json と同じ出力)
                       --workspace: 既存のコードベース (git worktree など) をそのまま作業場所にする
  status [--json]      フェーズ・バックログ・次の発言者を表示
  log [--tail N] [--md] [--html] [--no-thoughts]
                       会話ログを表示 (--md / --html は transcript.md / transcript.html のパス。HTML はブラウザで読む用)
  sessions             セッション一覧 / use <name> で切り替え
  overlaps [--json]    同じリポジトリを触る他のセッションと、同じファイル・同じ番号のファイルが重なっていないか確認
  say <text>           人間(あなた)としてチーム全員に発言を差し込む
  answer <Qn> <text>   メンバーの質問 Qn (status で一覧) に答える。チーム全員に伝わり、以降のプロンプトでは既定の案より優先される。
                       同じ Qn に答え直すと置き換わる。text は stdin でも可。終了済みのセッションにも答えられる

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
  html: { type: "boolean" },
  "no-thoughts": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

async function readStdin(missing: string): Promise<string> {
  if (process.stdin.isTTY) throw new Error(missing);
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
    // stderr, so `next --json` stays parseable
    runTrialIfDue(w, root, (s) => process.stderr.write(s + "\n"));
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
      const answers = answersByQuestion(view);
      const openQuestions = (w.state.questions ?? [])
        .map((q, i) => ({ id: questionId(i), by: q.by, text: q.text }))
        .filter((q) => !answers.has(q.id));
      out(JSON.stringify({ status: w.state.status, phase: w.phase.id, iteration: w.state.iteration, round: w.state.round, openQuestions, pending }, null, 2));
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
      out(statusText(w, new Map()));
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
        out(statusText(w, answersByQuestion(store.transcript(w.state.name))));
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
      if (flags.html) {
        // Rendered on demand too, so sessions saved before the HTML view existed get one.
        const file = path.join(store.sessionDir(w.state.name), "transcript.html");
        fs.writeFileSync(file, renderHtml(w.state, store.transcript(w.state.name)));
        out(file);
        return;
      }
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
      const text = pos.join(" ").trim() || (await readStdin("no text given: pass it as arguments or pipe it via stdin")).trim();
      w.broadcast(text, flags.as);
      store.save(w);
      out("ok");
      return;
    }

    case "answer": {
      const [id, ...words] = pos;
      if (!id) throw new Error("usage: team answer <Qn> <text>");
      const w = load();
      const given = words.join(" ").trim() || (await readStdin("no answer given: pass it after the id or pipe it via stdin")).trim();
      w.answer(id, given);
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
      const raw = file ? fs.readFileSync(path.resolve(root, file), "utf8") : await readStdin("no reply given: pipe it via stdin or use --file");
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
        if (runTrialIfDue(w, root, out)) out(`[${w.phase.id}] ${formatEntry(w.state, w.emitted.at(-1)!)}`);
        const view = es.concat(w.emitted);
        const files = listWorkspace(w.state, root);
        const others = otherSessionChanges(store, w.state);
        const ctx = { state: w.state, root };
        // Members scheduled in the same step act in parallel (like TinyWorld steps).
        const replies = await Promise.all(
          ids.map((id) => respondWithRetry(() => backend.respond(buildPrompt(w.state, id, view, files, { others }), ctx), id, out)),
        );
        ids.forEach((id, i) => {
          const before = w.emitted.length;
          w.record(id, replies[i]);
          for (const e of w.emitted.slice(before)) out(`[${e.phase}] ${formatEntry(w.state, e)}`);
        });
        const fresh = [...w.emitted];
        store.save(w, es);
        es.push(...fresh);
        turns += ids.length;
      }
      out(w.state.status === "done" ? "session is done." : `stopped after ${turns} turn(s); run again to continue.`);
      return;
    }

    default:
      throw new Error(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

/** One retry per turn; if that also fails, the member skips the turn so a single bad call does not stop the run. */
async function respondWithRetry(call: () => Promise<string>, id: string, out: (s: string) => void): Promise<string> {
  try {
    return await call();
  } catch (first) {
    out(`warning: ${id}'s turn failed, retrying once: ${(first as Error).message.split("\n")[0]}`);
    try {
      return await call();
    } catch (e) {
      const reason = (e as Error).message.split("\n")[0].slice(0, 200);
      out(`warning: ${id} skips this turn: ${reason}`);
      return "[SAY to=all] (could not attend this turn)";
    }
  }
}

function statusText(w: World, answers: ReadonlyMap<string, string>): string {
  const s = w.state;
  const next = w.next();
  const lines = [
    `session: ${s.name}  status: ${s.status}  iteration: ${s.iteration}/${s.maxIterations}`,
    `phase: ${w.phase.id} (round ${s.round}/${w.phase.maxRounds}, ${w.phase.mode}) — ${w.phase.goal}`,
    `next: ${s.status === "done" ? "-" : next.map((id) => displayName(s, id)).join(", ")}`,
    "backlog:",
    formatBacklog(s.tasks, "  (none)"),
  ];
  const open = formatQuestions(s, answers, "open");
  if (open) lines.push("open questions for the human (the team proceeds on the stated defaults; answer with: team answer <Qn> <text>):", open);
  const answered = formatQuestions(s, answers, "answered");
  if (answered) lines.push("answered questions:", answered);
  if (s.externalWorkspace) lines.splice(1, 0, `workspace: ${s.workspace} (existing codebase)`);
  return lines.join("\n");
}
