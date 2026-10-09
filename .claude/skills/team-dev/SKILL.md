---
name: team-dev
description: Run a simulated product team — a PM, several engineers and user personas — that interviews users, plans, builds real code in workspace/, reviews and gets user acceptance, all by talking to each other. Use when the user asks to start, continue or check a team simulation / "team dev" session, or invokes /team-dev with a product idea.
---

# team-dev: orchestrate the team (host mode)

You are the **facilitator / runtime**. The `team` engine (`node src/main.ts`, zero dependencies) owns all state:
who speaks next, the transcript, backlog, decisions and verdicts. You never invent turns yourself — each member's turn
is played by a dedicated subagent, and you just move messages between the engine and the subagents.

All commands run from the repository root. `team` below means `node src/main.ts`.

## 1. Start or resume

- `team status` — if it errors with "no session yet", or the user gave a new product idea, start one:
  `team init --brief "<product idea from the user, in their words>" --name <short-kebab-name>`
  (Brief is required. If the user gave none, ask them for one sentence about the product and who it is for.)
- Otherwise resume the current session (`team sessions` / `team use <name>` to switch).

Tell the user the session name, the team roster (from `team status`) and that they can interject at any time.

## 2. The loop

Repeat until the session is `done`, or until the stopping point the user asked for (e.g. "just discovery",
"one phase", "N turns"). If they gave none, run until the end of the current iteration.

1. `team next --json` → `{ status, phase, round, pending: [{ member, name, role, subagent, promptFile }] }`.
   If `status` is `"done"`, go to step 3.
2. For **every** entry in `pending`, launch the Agent tool with `subagent_type: <subagent>` and a prompt like:
   > Read `<promptFile>` and play the turn of `<name>` (`<member>`) exactly as it instructs. Your final message must be only the action tags.

   If that subagent type is not available (e.g. `.claude/agents/` was added after this Claude Code session started),
   use `general-purpose` instead and begin the prompt with the body of `.claude/agents/<subagent>.md`
   (its role rules and allowed tools still apply).
   When `pending` has several members (e.g. engineers in `build`), launch them **in the same message** so they work
   in parallel, and run them in the foreground (you need their results before the next step).
3. For each finished subagent, take its final message verbatim and record it:
   - Write it with the Write tool to `.team/inbox/<member>.txt` (overwrite).
   - `team record --as <member> --file .team/inbox/<member>.txt`
   Record the replies in the same order as `pending`. Do not edit, summarize or "fix" a reply; if a subagent
   replied with no tags at all, record it anyway (untagged text becomes `[SAY]`).
4. When the output of `record` shows a new phase started (or every ~6 turns), give the user a 2–4 line update:
   what happened, key decisions/tasks, what's next. Use `team log --tail 15 --no-thoughts` if you need a recap.

## 3. Finish

- Show `team status` (backlog with results) and the users' verdicts, and point to
  `.team/sessions/<name>/transcript.md` (full conversation including private thoughts) and `workspace/`.
- Suggest next steps: another iteration (if users rejected and iterations remain the engine already looped back to
  `planning` — just continue the loop), new personas, or committing the result.

## Human in the loop

- If the user says something meant for the team ("tell them the budget is small", "I want a web UI"), inject it:
  `team say "<their words>"` — every member sees it as a message from `human`.
- If the user wants to *be* a member for a turn, record their words with `team record --as <member> --force`.
- To change who is on the team, edit `team.config.json` / `personas/*.json` and start a new session.

## Rules

- Never write turn content yourself or skip a pending member; the engine refuses out-of-turn records anyway.
- Never edit `.team/sessions/**` by hand — only through the CLI.
- Engineers are the only ones who change `workspace/`. If you notice a broken build between turns, do not fix it
  yourself: the next engineer turn (or review phase) will see it.
- If a subagent fails (error, empty output), retry it once; if it fails again, record
  `[SAY to=all] (could not attend this turn)` for that member and continue.
