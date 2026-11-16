// team — simulate a product team (PM, engineers, user personas) that talks and builds together.
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { text } from "node:stream/consumers";
import { Store, loadConfig, loadPersona } from "./store.ts";
import { World, answersByQuestion, isPrivate, questionId } from "./world.ts";
import { DEFAULT_PHASES, subagentFor } from "./sop.ts";
import { buildPrompt, listWorkspace, promptAsText } from "./prompt.ts";
import { SKIPPED_TURN_REPLY, displayName, formatBackendLine, formatBacklog, formatContinued, formatEmptyReply, formatEmptyWorkspace, formatEntry, formatLeftoverWorkspace, formatNextSteps, formatQuestions, formatSkipStop, formatStatusHead, formatUnstaffedRoles, openQuestionIds } from "./render.ts";
import { formatStatusSummary } from "./summary.ts";
import { formatSessionList, readSessionRows } from "./session-list.ts";
import { defaultSessionName } from "./session-name.ts";
import { createBackend } from "./backends/index.ts";
import type { BackendReply } from "./backends/index.ts";
import { findOverlaps, formatOverlap, otherSessionChanges, sameRepoChanges } from "./overlap.ts";
import { runTrialIfDue } from "./verify.ts";
import { renderHtml } from "./html.ts";
import { ReplyError, TurnTimeoutError, addUsage, formatStats, summarizeUsage } from "./usage.ts";
import type { BackendConfig, ReplyUsage, TurnUsage } from "./types.ts";

/** Turns skipped one after the other, with no reply in between, after which `run` stops instead of finishing the session on skips. */
const MAX_SKIPPED_IN_A_ROW = 3;

const HELP = `team — PM・エンジニア・ペルソナ(ユーザー)が会話しながら開発するシミュレーター

Usage: team <command> [options]

Session
  init [<brief>] --brief <text> | --brief-file <f>  [--name <n>] [--config <f>] [--workspace <dir>] [--force] [--json]
                       新しいセッションを作成して current にする (--json は next --json と同じ出力)
                       --name を省くとローカルの日時 YYYYMMDD-HHmm が名前になる (brief からは付けない)
                       --workspace: 既存のコードベース (git worktree など) をそのまま作業場所にする
                       --force: 同名のセッションを作り直す (そのセッションの保存内容すべて (.team/sessions/<name>/) が消える。workspace/<name>/ のファイルは消さず、残っていれば警告する)
  status [--full] [--json]
                       状況と次の一手の要約: フェーズ・task 一覧・人の作業 (引き継ぎと確認待ち)・verdict・質問・次の発言者
                       --full: 従来の全文 (フェーズの goal と、各 task の acceptance / result まで)
  log [--tail N] [--md] [--html] [--no-thoughts]
                       会話ログを表示 (N は 0 以上の整数。--md / --html は transcript.md / transcript.html のパス。HTML はブラウザで読む用)
  sessions             セッション一覧 (1 行ずつ: 状態・フェーズ・イテレーション・結果・最終更新・brief。* が current) / use <name> で切り替え
  stats [--json]       ターンごとの実際の使用量 (usage.jsonl) の合計。フェーズ別・ロール別の内訳つき
  overlaps [--json]    同じリポジトリを触る他のセッションと、同じファイル・同じ番号のファイルが重なっていないか確認
  say <text>           人間(あなた)としてチーム全員に発言を差し込む (空は不可。終了済みのセッションには使えない: continue を使う)
  answer <Qn> <text>   メンバーの質問 Qn (status で一覧) に答える。チーム全員に伝わり、以降のプロンプトでは既定の案より優先される。
                       同じ Qn に答え直すと置き換わる。text は stdin でも可。終了済みのセッションにも答えられる (チームが読むのは continue したあと)
  continue [<text> | --say <text>] [--iterations N] [--json]
                       終了 (done) したセッションをもう N イテレーション (既定 1) 続ける。text は人間としての発言 (空は不可)。実行中のセッションには使えない。--json は next --json と同じ出力

Host mode (Claude Code などの外部オーケストレーターが各エージェントを実行)
  next [--json] [--inline]
                       次に行動すべきメンバーと、そのメンバー用プロンプトを出力
                       (プロンプトは .team/sessions/<s>/turns/*.prompt.md にも保存)
  record --as <id> [--file <f>] [--force] [--tokens N] [--duration-ms N] [--json]
                       メンバーの返答(stdin か --file)を記録して次へ進める (--json は next --json の出力に recorded: { member, actions } を足したもの)
                       返答が空 (空白だけも含む) なら何も記録せず exit 1 (--force でも同じ)。返答できなかったメンバーは ${SKIPPED_TURN_REPLY} を記録する
                       --tokens / --duration-ms: オーケストレーターが報告したそのターンのトークン数・所要時間
                       (usage.jsonl に記録。トークン数は報告値のまま、測定したトークン数とは別に集計される)

Auto mode (このプロセスが LLM を呼ぶ)
  run [--backend anthropic|claude-cli|mock] [--model <m>] [--turns N]
                       N は 0 以上の整数。claude コマンドや API キーが無いなど、動かない設定なら何も変えずに止まる。
                       返答が空 (空白だけも含む) の試行も失敗として数え、1 回リトライしてもだめならスキップする。
                       ターンが ${MAX_SKIPPED_IN_A_ROW} 回続けて失敗 (スキップ) したら、その step は記録せずに止まる。原因を直して run すれば続きから再開できる
                       (連続数は 1 回の run の中で数える。再開や --turns の短い実行では 0 から)

Global options
  --root <dir>         リポジトリルート (default: cwd)。.team はここだけを見る (親ディレクトリは探さない)
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
  iterations: { type: "string" },
  say: { type: "string" },
  tokens: { type: "string" },
  "duration-ms": { type: "string" },
  tail: { type: "string" },
  force: { type: "boolean" },
  full: { type: "boolean" },
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

/**
 * `warn` is stderr: a warning must not end up in the JSON that `init --json` and `record --json` print.
 * `now` is the clock a new session is named and dated by (an ISO time, like the one a World takes).
 */
export async function main(
  argv: string[],
  out: (s: string) => void = (s) => process.stdout.write(s + "\n"),
  warn: (s: string) => void = (s) => process.stderr.write(s + "\n"),
  now: () => string = () => new Date().toISOString(),
) {
  const { values: flags, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [first = "help", ...pos] = positionals;
  const cmd = flags.help ? "help" : first;
  const root = path.resolve(flags.root ?? process.cwd());
  const store = new Store(root);
  const session = flags.session;
  const load = () => store.load(session);
  const turnsDir = (w: World) => path.join(store.sessionDir(w.state.name), "turns");

  /**
   * ` --session <name>` when a bare command would not reach the session that was asked for, so the commands we suggest do
   * what they say. The name is the folder's, as `use` takes it: a copied folder's state still holds the old name.
   */
  function sessionFlag(): string {
    if (flags.session === undefined) return "";
    let current = "";
    try {
      current = store.current();
    } catch {}
    return current === flags.session ? "" : ` --session ${flags.session}`;
  }

  /** The commands to run next in this session, which these text outputs end with. JSON never gets them. */
  const nextSteps = (w: World, afterAnswer = false) => formatNextSteps(w.state, openQuestionIds(w.state, w.answered), sessionFlag(), afterAnswer);

  /** The default `status` text (`status --full` is `statusText`). */
  const summaryOf = (w: World, answers: ReadonlyMap<string, string>, overlaps: readonly string[]) =>
    formatStatusSummary(w.state, { answers, next: w.next(), overlaps, via: sessionFlag() });

  /** Schedule the next speaker(s) and print their turn prompts (`next`, and `init --json`). `recorded` is what `record --json` adds to that JSON. */
  function next(w: World, recorded?: { member: string; actions: string[] }) {
    const ids = w.next();
    // stderr, so `next --json` stays parseable
    runTrialIfDue(w, root, warn);
    const es = store.transcript(w.state.name);
    const view = es.concat(w.emitted);
    const files = listWorkspace(w.state, root);
    const others = otherSessionChanges(store, w.state);
    const promptsDir = turnsDir(w);
    if (ids.length) fs.mkdirSync(promptsDir, { recursive: true });
    const items = ids.map((id) => {
      const p = buildPrompt(w.state, id, view, files, { others });
      const text = promptAsText(p);
      // Prompts are also written to files so an orchestrator can hand a short
      // path to a subagent instead of copying the whole prompt through its context.
      const file = path.join(promptsDir, `${String(w.state.turn).padStart(4, "0")}-${id}.prompt.md`);
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
      out(JSON.stringify({ status: w.state.status, phase: w.phase.id, iteration: w.state.iteration, round: w.state.round, openQuestions, pending, ...(recorded && { recorded }) }, null, 2));
    } else if (w.state.status === "done") {
      out(`session is done.\n${nextSteps(w)}`);
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
      const name = flags.name ?? defaultSessionName(new Date(now()));
      if (store.exists(name) && !flags.force) {
        throw new Error(`session "${name}" already exists. Pass another --name, continue it with "team use ${name}", or start it over with --force (this deletes everything saved for it in .team/sessions/${name}/).`);
      }
      // An existing codebase (e.g. a git worktree of another repository) is used in place.
      const external = flags.workspace ? path.resolve(root, flags.workspace) : undefined;
      if (external && !fs.statSync(external, { throwIfNoEntry: false })?.isDirectory())
        throw new Error(`workspace not found: ${flags.workspace}`);
      // Read and built in memory first; `store.create` puts the session in place only once all of it is written.
      const members = cfg.members.map((f) => loadPersona(root, f));
      const phases = cfg.phases ?? DEFAULT_PHASES;
      const w = World.create({
        name,
        brief,
        members,
        phases,
        language: cfg.language,
        // each session builds in its own folder so sessions (e.g. parallel cloud threads) never share files
        workspace: external
          ? path.relative(root, external).split(path.sep).join("/") || "."
          : path.posix.join(cfg.workspace ?? "workspace", name),
        externalWorkspace: !!external,
        maxIterations: cfg.maxIterations,
        historyWindow: cfg.historyWindow,
        now,
      });
      const workspace = path.resolve(root, w.state.workspace);
      const leftovers = !!flags.force && !external && hasFiles(workspace);
      const unstaffed = formatUnstaffedRoles(phases, members);
      fs.mkdirSync(workspace, { recursive: true });
      store.create(w);
      store.setCurrent(name);
      for (const warning of unstaffed) warn(warning);
      if (leftovers) warn(formatLeftoverWorkspace(w.state.workspace));
      // With --json, answer like `next --json` so an orchestrator can start the first turn without another call.
      if (flags.json) return next(w);
      out(`created session "${name}" with ${w.state.members.length} members → .team/sessions/${name}/`);
      out(summaryOf(w, new Map(), []));
      return;
    }

    case "sessions": {
      let cur = "";
      try {
        cur = store.current();
      } catch {}
      out(formatSessionList(readSessionRows(store), cur));
      return;
    }

    case "use": {
      const [name] = pos;
      if (!name) throw new Error('usage: team use <name> (the names are listed by "team sessions")');
      store.requireSession(name);
      store.setCurrent(name);
      out(`current session: ${name}`);
      return;
    }

    case "status": {
      const w = load();
      const overlaps = findOverlaps(sameRepoChanges(store, w.state)).filter((o) => o.sessions.some((x) => x.session === w.state.name));
      if (flags.json) out(JSON.stringify({ ...w.state, phase: w.phase.id, next: w.next(), overlaps }, null, 2));
      else {
        const answers = answersByQuestion(store.transcript(w.state.name));
        if (!flags.full) out(summaryOf(w, answers, overlaps.map(formatOverlap)));
        else {
          out(statusText(w, answers));
          if (overlaps.length) out(["overlaps with other sessions:", ...overlaps.map((o) => "  " + formatOverlap(o))].join("\n"));
        }
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
      const tail = wholeNumber(flags.tail, "--tail") ?? 0;
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
      if (tail > 0) es = es.slice(-tail);
      for (const e of es) out(`[${e.iteration}:${e.phase}#${e.turn}] ${formatEntry(w.state, e)}`);
      return;
    }

    case "say": {
      const w = load();
      const missing = "no text given: pass it as arguments or pipe it via stdin";
      const text = pos.join(" ").trim() || (await readStdin(missing)).trim();
      if (!text) throw new Error(missing);
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
      if (w.state.status === "done") out(nextSteps(w, true));
      return;
    }

    case "continue": {
      const iterations = wholeNumber(flags.iterations, "--iterations", 1) ?? 1;
      // like `say`, the words may be arguments; a command that cannot be undone must not drop them
      if (pos.length && flags.say !== undefined) throw new Error("give the message for the team either as arguments or with --say, not both");
      const w = load();
      w.continueSession(iterations, pos.length ? pos.join(" ") : flags.say);
      store.save(w);
      if (!hasFiles(path.resolve(root, w.state.workspace))) warn(formatEmptyWorkspace(w.state.workspace));
      // With --json, answer like `next --json` so an orchestrator can start the first turn without another call.
      if (flags.json) return next(w);
      const ids = w.next();
      store.save(w);
      out(formatContinued(w.state, ids));
      out(nextSteps(w));
      return;
    }

    case "next":
      next(load());
      return;

    case "record": {
      const w = load();
      const id = flags.as;
      if (!id) throw new Error("--as <member-id> is required");
      const tokens = wholeNumber(flags.tokens, "--tokens");
      const durationMs = wholeNumber(flags["duration-ms"], "--duration-ms");
      const file = flags.file;
      const raw = file ? fs.readFileSync(path.resolve(root, file), "utf8") : await readStdin("no reply given: pipe it via stdin or use --file");
      // --force lets a member interject out of turn; it never lets an empty reply through
      if (!raw.trim()) throw new Error(formatEmptyReply(id));
      // an interjection (--force) has no prompt of its own; an older file would be another turn's
      const promptChars = w.state.pending.includes(id) ? latestPromptChars(turnsDir(w), id) : undefined;
      const measured = { source: "host" as const, promptChars, durationMs, reportedTokens: tokens };
      const { actions, usage } = recordTurn(w, id, raw, measured, !!flags.force);
      store.save(w);
      store.appendUsage(w.state.name, [usage]);
      // With --json, answer like `next --json` so the orchestrator saves a call per turn.
      if (flags.json) return next(w, { member: id, actions: actions.map((a) => a.type) });
      const ids = w.next();
      store.save(w);
      out(`recorded ${actions.length} action(s) from ${id}: ${actions.map((a) => a.type).join(", ") || "-"}`);
      // Only when the session ends: the host loop reads this output after every reply, and a command to run is not for it.
      if (w.state.status === "done") out(`session is done.\n${nextSteps(w)}`);
      else out(`next: ${ids.join(", ")} (phase ${w.phase.id}, round ${w.state.round})`);
      return;
    }

    case "run": {
      const maxTurns = wholeNumber(flags.turns, "--turns") ?? 200;
      const cfg = loadConfig(root, flags.config);
      const bcfg: BackendConfig = { ...(cfg.backend ?? { type: "mock" }) };
      const b = flags.backend;
      if (b) bcfg.type = b as BackendConfig["type"];
      if (flags.model) bcfg.model = flags.model;
      const backend = createBackend(bcfg);
      let turns = 0;
      const w = load();
      const ctx = { state: w.state, root };
      out(formatBackendLine(bcfg.type, backend.model));
      // Before anything changes: a backend that can never answer would skip every turn and finish a session that cannot be continued.
      if (w.state.status === "running") backend.preflight?.(ctx);
      const es = store.transcript(w.state.name); // kept in memory for the whole run
      let skippedInARow = 0;
      while (w.state.status === "running" && turns < maxTurns) {
        const ids = w.next();
        if (runTrialIfDue(w, root, out)) out(`[${w.phase.id}] ${formatEntry(w.state, w.emitted.at(-1)!)}`);
        const view = es.concat(w.emitted);
        const files = listWorkspace(w.state, root);
        const others = otherSessionChanges(store, w.state);
        const prompts = ids.map((id) => buildPrompt(w.state, id, view, files, { others }));
        // Members scheduled in the same step act in parallel (like TinyWorld steps).
        const replies = await Promise.all(prompts.map((p) => respondWithRetry(() => backend.respond(p, ctx), p.member, out)));
        // Judged once the whole step has answered: one reply that is not a skip shows the backend works.
        const failures = replies.filter((r) => r.skipped === true);
        skippedInARow = failures.length === replies.length ? skippedInARow + ids.length : 0;
        const giveUp = skippedInARow >= MAX_SKIPPED_IN_A_ROW;
        const usage: TurnUsage[] = [];
        ids.forEach((id, i) => {
          const before = w.emitted.length;
          const { usage: spent, skipped } = replies[i];
          const measured = { ...spent, source: bcfg.type, promptChars: promptAsText(prompts[i]).length, skipped };
          if (giveUp) {
            // what the failed attempts cost is still owed, but the turn itself is left for the next run
            usage.push(usageLine(w, id, replies[i].text, measured, { phase: w.phase.id, iteration: w.state.iteration, turn: w.state.turn + 1 + i }));
            return;
          }
          usage.push(recordTurn(w, id, replies[i].text, measured).usage);
          for (const e of w.emitted.slice(before)) out(`[${e.phase}] ${formatEntry(w.state, e)}`);
        });
        const fresh = [...w.emitted];
        store.save(w, es);
        store.appendUsage(w.state.name, usage);
        es.push(...fresh);
        if (giveUp) throw new Error(formatSkipStop(skippedInARow, failures[failures.length - 1].reason));
        turns += ids.length;
      }
      out(w.state.status === "done" ? "session is done." : `stopped after ${turns} turn(s).`);
      out(nextSteps(w));
      return;
    }

    case "stats": {
      const name = load().state.name;
      const lines = store.usage(name);
      const stats = lines?.length ? summarizeUsage(lines) : null;
      if (flags.json) out(JSON.stringify(stats ? { session: name, recorded: true, ...stats } : { session: name, recorded: false }, null, 2));
      else if (stats) out(formatStats(name, stats));
      else out(`session ${name}: no usage recorded (saved before usage tracking, or no reply recorded yet)`);
      return;
    }

    default:
      throw new Error(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

/** Parses a count given on the command line, rejecting anything that is not a whole number of at least `min`. */
function wholeNumber(value: string | undefined, flag: string, min = 0): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min) throw new Error(`${flag} must be a whole number of ${min} or more, got "${value}"`);
  return Number(value);
}

function hasFiles(dir: string): boolean {
  return !!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() && fs.readdirSync(dir).length > 0;
}

/** The size of the newest prompt `next` wrote for a member. Files are `<turn>-<member id>.prompt.md` and ids contain hyphens, so compare the whole id. */
function latestPromptChars(dir: string, id: string): number | undefined {
  let newest: { turn: number; file: string } | undefined;
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const m = /^(\d+)-(.+)\.prompt\.md$/.exec(file);
    if (m && m[2] === id && (!newest || Number(m[1]) > newest.turn)) newest = { turn: Number(m[1]), file };
  }
  return newest && fs.readFileSync(path.join(dir, newest.file), "utf8").length;
}

/** Applies a reply and returns what the turn cost. The phase is read first: recording a reply can move the schedule on. */
function recordTurn(
  w: World,
  id: string,
  raw: string,
  measured: ReplyUsage & Pick<TurnUsage, "source" | "promptChars" | "reportedTokens" | "skipped">,
  force = false,
) {
  const where = { phase: w.phase.id, iteration: w.state.iteration };
  const actions = w.record(id, raw, { force });
  return { actions, usage: usageLine(w, id, raw, measured, { ...where, turn: w.state.turn }) };
}

function usageLine(
  w: World,
  id: string,
  raw: string,
  measured: ReplyUsage & Pick<TurnUsage, "source" | "promptChars" | "reportedTokens" | "skipped">,
  { phase, iteration, turn }: Pick<TurnUsage, "phase" | "iteration" | "turn">,
): TurnUsage {
  return {
    turn,
    member: id,
    role: w.member(id)!.role,
    phase,
    iteration,
    at: new Date().toISOString(),
    replyChars: raw.length,
    ...measured,
  };
}

/** A member's answer for one step. A skipped one says why, so `run` can name the last failure when it stops. */
type StepReply = BackendReply & ({ skipped?: false } | { skipped: true; reason: string });

/**
 * One retry per turn; if that also fails, the member skips the turn so a single bad call does not stop the run. A turn that timed out
 * is skipped at once: it would only hang for the whole limit again, and the members of its step are waiting for it.
 * The usage of the reply is what every attempt cost, failed ones included.
 */
async function respondWithRetry(call: () => Promise<BackendReply>, id: string, out: (s: string) => void): Promise<StepReply> {
  const spentOn = (e: unknown) => (e instanceof ReplyError ? e.usage : undefined);
  const skipped = (usage: ReplyUsage | undefined, reason: string) => ({ text: SKIPPED_TURN_REPLY, usage, skipped: true, reason });
  // An empty reply would use up the member's turn without anyone having spoken, so it fails like an error does.
  const attempt = async () => {
    const reply = await call();
    if (!reply.text.trim()) throw new ReplyError("the backend returned an empty reply", reply.usage);
    return reply;
  };
  try {
    return await attempt();
  } catch (first) {
    if (first instanceof TurnTimeoutError) {
      out(`warning: ${id} skips this turn without a retry: ${first.message}`);
      return skipped(first.usage, first.message);
    }
    out(`warning: ${id}'s turn failed, retrying once: ${(first as Error).message.split("\n")[0]}`);
    try {
      const reply = await attempt();
      return { ...reply, usage: addUsage(spentOn(first), reply.usage) };
    } catch (e) {
      const reason = (e as Error).message.split("\n")[0].slice(0, 200);
      out(`warning: ${id} skips this turn: ${reason}`);
      return skipped(addUsage(spentOn(first), spentOn(e)), reason);
    }
  }
}

function statusText(w: World, answers: ReadonlyMap<string, string>): string {
  const s = w.state;
  const next = w.next();
  const lines = [
    ...formatStatusHead(s, true),
    `next: ${s.status === "done" ? "-" : next.map((id) => displayName(s, id)).join(", ")}`,
    "backlog:",
    formatBacklog(s.tasks, "  (none)"),
  ];
  const open = formatQuestions(s, answers, "open");
  if (open) lines.push("open questions for the human (the team proceeds on the stated defaults; answer with: team answer <Qn> <text>):", open);
  const answered = formatQuestions(s, answers, "answered");
  if (answered) lines.push("answered questions:", answered);
  return lines.join("\n");
}
