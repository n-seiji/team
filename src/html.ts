// A self-contained HTML view of a session for reading it later: the conversation grouped by iteration and
// phase, with the backlog, decisions, verdicts, questions and trial runs beside it. No external scripts.
import type { Entry, PersonaSpec, SessionState, Task } from "./types.ts";
import { answersByQuestion, currentPhase, isPrivate, questionId } from "./world.ts";

const LABELS = {
  ja: {
    brief: "お題",
    status: { running: "進行中", done: "終了" },
    iteration: "周",
    phase: "フェーズ",
    team: "メンバー",
    backlog: "タスク",
    check: "人が確認",
    decisions: "決定",
    verdicts: "判定",
    questions: "人への質問",
    answer: "回答",
    trials: "試用ログ",
    transcript: "会話",
    memos: "本人だけのメモも表示",
    everyone: "全員",
    filter: "表示する人",
    none: "なし",
    entries: "件",
  },
  en: {
    brief: "Brief",
    status: { running: "running", done: "done" },
    iteration: "iteration",
    phase: "phase",
    team: "Team",
    backlog: "Backlog",
    check: "check by a person",
    decisions: "Decisions",
    verdicts: "Verdicts",
    questions: "Questions for the human",
    answer: "answer",
    trials: "Trial runs",
    transcript: "Conversation",
    memos: "Show private memos",
    everyone: "Everyone",
    filter: "Show",
    none: "none",
    entries: "entries",
  },
};

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Light markup only: inline code and fenced blocks, everything else as written. */
function body(t: string): string {
  return esc(t)
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => `<pre>${code.replace(/\n$/, "")}</pre>`)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

const ROLE_CLASS: Record<string, string> = { pm: "pm", engineer: "eng", user: "user" };

function roleOf(s: SessionState, id: string): string {
  if (id === "system") return "sys";
  if (id === "human") return "human";
  const m = s.members.find((x) => x.id === id);
  return m ? (ROLE_CLASS[m.role] ?? "other") : "other";
}

function nameOf(s: SessionState, id: string): string {
  if (id === "human") return "human";
  return s.members.find((x) => x.id === id)?.persona.name ?? id;
}

const KIND_LABEL: Partial<Record<Entry["kind"], string>> = {
  think: "memo",
  note: "note",
  task: "TASK",
  task_update: "task",
  decision: "DECISION",
  verdict: "VERDICT",
  demo: "DEMO",
  ask_human: "ASK_HUMAN",
  verify: "VERIFY",
  advance: "ADVANCE",
};

function entryHtml(s: SessionState, e: Entry): string {
  if (e.kind === "system") return `<li class="sys" data-from="system"><p>${body(e.text)}</p></li>`;
  const role = roleOf(s, e.from);
  const to = e.to && !e.to.includes("all") && !isPrivate(e) ? ` <span class="to">→ ${esc(e.to.map((t) => nameOf(s, t)).join(", "))}</span>` : "";
  const kind = KIND_LABEL[e.kind];
  const verdict = e.kind === "verdict" ? (/^ACCEPT/.test(e.text) ? " accept" : " reject") : "";
  return (
    `<li class="msg ${role}${isPrivate(e) ? " private" : ""}" data-from="${esc(e.from)}">` +
    `<div class="who"><span class="name">${esc(nameOf(s, e.from))}</span>${to}` +
    (kind ? ` <span class="kind${verdict}">${kind}</span>` : "") +
    `<span class="turn">#${e.turn}</span></div>` +
    `<div class="text">${body(e.text)}</div></li>`
  );
}

function taskHtml(t: Task, checkLabel: string): string {
  const sub = (label: string, text: string) =>
    `<details class="sub"><summary>${label}</summary><div class="muted small text">${body(text)}</div></details>`;
  // A blocked task with a hand-off keeps what was done in its summary; older sessions kept the hand-off there.
  const summaryLabel = t.status === "done" || (t.status === "blocked" && t.handoff !== undefined) ? "result" : t.status;
  return (
    `<li><span class="st st-${t.status}">${t.status}</span> <b>${t.id}</b> ${esc(t.title)}` +
    (t.owner ? ` <span class="muted">${esc(t.owner)}</span>` : "") +
    (t.summary ? sub(summaryLabel, t.summary) : "") +
    (t.status === "blocked" && t.handoff ? sub(t.status, t.handoff) : "") +
    (t.checks ?? []).map((c) => `<div class="small text"><span class="muted">${checkLabel}:</span> ${body(c)}</div>`).join("") +
    `</li>`
  );
}

function list<T>(items: T[], render: (x: T) => string, empty: string): string {
  return items.length ? `<ul>${items.map(render).join("")}</ul>` : `<p class="muted">${empty}</p>`;
}

export function renderHtml(s: SessionState, entries: Entry[]): string {
  const L = s.language === "ja" ? LABELS.ja : LABELS.en;
  const groups: { key: string; title: string; items: Entry[] }[] = [];
  for (const e of entries) {
    const key = `${e.iteration}:${e.phase}`;
    if (groups.at(-1)?.key !== key) groups.push({ key, title: `${L.iteration} ${e.iteration} · ${e.phase}`, items: [] });
    groups.at(-1)!.items.push(e);
  }
  const people = (m: PersonaSpec) =>
    `<li><span class="dot ${ROLE_CLASS[m.role] ?? "other"}"></span>${esc(m.persona.name)} <span class="muted">${esc(m.id)} · ${esc(m.role)}</span></li>`;
  const options = s.members.map((m) => `<option value="${esc(m.id)}">${esc(m.persona.name)}</option>`).join("");
  const trials = s.trials ?? [];
  const answers = answersByQuestion(entries);
  const questions = (s.questions ?? []).map((q, i) => ({ ...q, id: questionId(i), answer: answers.get(questionId(i)) }));

  return `<!doctype html>
<html lang="${esc(s.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(s.name)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+JP:wght@400;600;700&display=swap">
<style>
/* Layout: a reading column for the conversation, with the session's records in a side column on wide screens. */
:root {
  --bg: #f6f7f8; --panel: #ffffff; --fg: #1d2329; --muted: #5d6873; --line: #dfe3e7;
  --accent: #1f6f78; --pm: #7a4dbf; --eng: #1f6f78; --user: #b25a1d; --human: #b0324a;
  --ok: #2c7a3f; --bad: #b0324a; --code: #eef1f3;
  --body: "IBM Plex Sans JP", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #12161a; --panel: #1a2026; --fg: #e3e8ec; --muted: #9aa6b1; --line: #2c343c;
  --accent: #5fb7bf; --pm: #b796ec; --eng: #5fb7bf; --user: #e59a62; --human: #ec7d92;
  --ok: #6cc785; --bad: #ec7d92; --code: #232b33; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #12161a; --panel: #1a2026; --fg: #e3e8ec; --muted: #9aa6b1; --line: #2c343c;
  --accent: #5fb7bf; --pm: #b796ec; --eng: #5fb7bf; --user: #e59a62; --human: #ec7d92;
  --ok: #6cc785; --bad: #ec7d92; --code: #232b33; color-scheme: dark }
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.65 var(--body);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
header, main { max-width: 1180px; margin: 0 auto }
header { padding-block: 28px 12px; display: grid; gap: 8px }
h1 { font-size: 1.6rem; line-height: 1.25; margin: 0; text-wrap: balance }
h2 { font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px }
.brief { max-width: 72ch; margin: 0; white-space: pre-wrap }
.chips { display: flex; flex-wrap: wrap; gap: 6px }
.chip { font: 12px var(--mono); padding: 2px 8px; border: 1px solid var(--line); border-radius: 99px; background: var(--panel) }
main { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 28px; padding-block: 8px 48px; align-items: start }
@media (max-width: 860px) { main { grid-template-columns: minmax(0, 1fr) } }
aside { display: grid; gap: 20px; min-width: 0 }
aside section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; min-width: 0 }
aside ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px }
.controls { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 2; background: var(--bg);
  display: flex; flex-wrap: wrap; gap: 16px; align-items: center; padding-block: 10px; border-bottom: 1px solid var(--line) }
.controls label { display: inline-flex; gap: 6px; align-items: center; font-size: .9rem }
select { font: inherit; padding: 2px 6px }
details { border-bottom: 1px solid var(--line) }
summary { cursor: pointer; padding-block: 12px; font-weight: 600; display: flex; gap: 10px; align-items: baseline }
summary .muted { font-weight: 400; font-size: .85rem }
summary:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
ol { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 10px }
.msg { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--c, var(--line)); border-radius: 6px; padding: 10px 14px; min-width: 0 }
.msg.pm { --c: var(--pm) } .msg.eng { --c: var(--eng) } .msg.user { --c: var(--user) } .msg.human { --c: var(--human) }
.msg.private { background: transparent; border-style: dashed; color: var(--muted) }
.who { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; font-size: .85rem }
.name { font-weight: 700; color: var(--c, var(--fg)) }
.to, .turn, .muted { color: var(--muted) }
.turn { margin-left: auto; font: 11px var(--mono) }
.kind { font: 11px var(--mono); letter-spacing: .04em; padding: 0 6px; border-radius: 4px; background: var(--code) }
.kind.accept { color: var(--ok) } .kind.reject { color: var(--bad) }
.text { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 4px }
.sys { color: var(--muted); font-size: .85rem; padding-inline: 4px }
.sys p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere }
pre { background: var(--code); padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12.5px/1.5 var(--mono); white-space: pre; margin: 6px 0 }
code { font: .9em var(--mono); background: var(--code); padding: 0 4px; border-radius: 3px }
.small { font-size: .85rem }
details.sub { border: 0 } details.sub summary { padding-block: 2px; font-weight: 400; font-size: .8rem; color: var(--muted) }
.st { font: 11px var(--mono); padding: 0 6px; border-radius: 4px; background: var(--code) }
.st-done { color: var(--ok) } .st-blocked { color: var(--human) } .st-dropped { color: var(--muted); text-decoration: line-through }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--muted) }
.dot.pm { background: var(--pm) } .dot.eng { background: var(--eng) } .dot.user { background: var(--user) }
body:not(.show-private) .private { display: none }
</style>
</head>
<body>
<header>
  <h1>${esc(s.name)}</h1>
  <p class="brief"><b>${L.brief}:</b> ${esc(s.brief)}</p>
  <div class="chips">
    <span class="chip">${L.status[s.status]}</span>
    <span class="chip">${L.iteration} ${s.iteration}/${s.maxIterations}</span>
    <span class="chip">${L.phase}: ${esc(currentPhase(s).id)}</span>
    <span class="chip">${entries.length} ${L.entries}</span>
  </div>
</header>
<main>
<div style="min-width:0">
  <div class="controls">
    <label><input type="checkbox" id="show-private"> ${L.memos}</label>
    <label>${L.filter} <select id="who"><option value="">${L.everyone}</option>${options}</select></label>
  </div>
  <h2 style="margin-top:16px">${L.transcript}</h2>
  ${groups
    .map(
      (g, i) =>
        `<details open><summary>${esc(g.title)} <span class="muted">${g.items.filter((e) => !isPrivate(e)).length}</span></summary><ol>${g.items.map((e) => entryHtml(s, e)).join("")}</ol></details>`,
    )
    .join("\n  ")}
</div>
<aside>
  <section><h2>${L.team}</h2>${list(s.members, people, L.none)}</section>
  <section><h2>${L.backlog}</h2>${list(s.tasks, (t) => taskHtml(t, L.check), L.none)}</section>
  ${questions.length ? `<section><h2>${L.questions}</h2>${list(questions, (q) => `<li><b>${q.id}</b> ${body(q.text)} <span class="muted">${esc(nameOf(s, q.by))}</span>${q.answer === undefined ? "" : `<div class="small"><b>${L.answer}:</b> ${body(q.answer)}</div>`}</li>`, L.none)}</section>` : ""}
  <section><h2>${L.verdicts}</h2>${list(s.verdicts, (v) => `<li><span class="kind ${v.verdict}">${v.verdict}</span> ${esc(nameOf(s, v.by))} <span class="muted">${L.iteration} ${v.iteration}</span><div class="small">${body(v.reason)}</div></li>`, L.none)}</section>
  ${trials.length ? `<section><h2>${L.trials}</h2>${list(trials, (t) => `<li><span class="muted">${L.iteration} ${t.iteration}</span> ${t.command ? `<code>${esc(t.command)}</code> → ${t.timedOut ? "timeout" : `exit ${t.exitCode}`}<pre>${esc(t.output.trim())}</pre>${t.artifacts.map((a) => `<div class="small muted">${esc(a)}</div>`).join("")}` : L.none}</li>`, L.none)}</section>` : ""}
  <section><h2>${L.decisions}</h2>${list(s.decisions, (d) => `<li class="small">${body(d.text)} <span class="muted">${esc(d.phase)}</span></li>`, L.none)}</section>
</aside>
</main>
<script>
(() => {
  const priv = document.getElementById("show-private"), who = document.getElementById("who");
  const apply = () => {
    document.body.classList.toggle("show-private", priv.checked);
    for (const li of document.querySelectorAll("li[data-from]")) li.hidden = !!who.value && li.dataset.from !== who.value;
  };
  priv.addEventListener("change", apply);
  who.addEventListener("change", apply);
  apply();
})();
</script>
</body>
</html>
`;
}
