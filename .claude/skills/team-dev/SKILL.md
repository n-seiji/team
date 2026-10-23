---
name: team-dev
description: Run a simulated product team — a PM, several engineers and user personas — that interviews users, plans, builds real code in workspace/, reviews and gets user acceptance, all by talking to each other. Use when the user asks to start, continue or check a team simulation / "team dev" session, or invokes /team-dev with a product idea.
---

# team-dev: orchestrate the team (host mode)

You are the **facilitator / runtime**. The `team` engine (`node src/main.ts`, zero dependencies) owns all state:
who speaks next, the transcript, backlog, decisions and verdicts. You never invent turns yourself — each member's turn
is played by a dedicated subagent, and you just move messages between the engine and the subagents.

All commands run from the repository root. `team` below means `node src/main.ts`.

## 1. Start or resume (one command, no checks first)

- **The user gave a product idea** → `team init "<their idea, in their words>" --name <short-kebab-name> --json`.
  Its output is the same as `team next --json`, so go straight to step 2.2 and launch the first subagent.
- **Work on an existing repository / a GitHub issue** → check the repository out as a git worktree under `workspace/`
  (one per issue, its own branch), write the issue (title, body, links) to a brief file, and run
  `team init --name <short-name> --workspace workspace/<short-name> --brief-file <file> --json`. Use a config with
  personas that fit that product (`--config`). After each session, run `team overlaps` and tell the user about any
  file or migration-number clash with other sessions on the same repository.
- **"Continue" / no idea** → `team next --json` resumes the current session (`team sessions` / `team use <name>`
  to switch). Only if there is no session, or it is `done`, ask for one sentence about the product and who it is for.

Do not run `team status` or read other files before the first turn. In the same message that launches the first
subagent, tell the user in one line the session name and that they can interject at any time.

## 2. The loop

Repeat until the session is `done`, or until the stopping point the user asked for (e.g. "just discovery",
"one phase", "N turns"). If they gave none, run until the end of the current iteration.

1. `team next --json` → `{ status, phase, round, pending: [{ member, name, role, subagent, promptFile }] }`.
   If `status` is `"done"`, go to step 3.
2. For **every** entry in `pending`, launch the Agent tool with `subagent_type: <subagent>` and a prompt like:
   > Read `<promptFile>` and play the turn of `<name>` (`<member>`) exactly as it instructs. Your final message must be only the action tags. Do not message the user or call any chat/messaging tools.

   If that subagent type is not available (e.g. `.claude/agents/` was added after this Claude Code session started),
   use `general-purpose` instead and begin the prompt with the body of `.claude/agents/<subagent>.md`
   (its role rules and allowed tools still apply).
   When `pending` has several members (e.g. engineers in `build`), launch them **in the same message** so they work
   in parallel, and run them in the foreground (you need their results before the next step).
3. Record every reply in **one** Bash call, in the same order as `pending`, passing each final message verbatim
   through a quoted heredoc, and add `--json` to the last one:
   ```bash
   node src/main.ts record --as eng-backend <<'TEAM_REPLY_END'
   <eng-backend's final message, verbatim>
   TEAM_REPLY_END
   node src/main.ts record --as eng-frontend --json <<'TEAM_REPLY_END'
   <eng-frontend's final message, verbatim>
   TEAM_REPLY_END
   ```
   The `--json` output is the next step 1 result, so go straight to step 2 (no separate `team next`).
   When the Agent result reports a token total for the subagent (shown as `subagent_tokens` in Claude Code), pass
   it to that member's `record` as `--tokens <n>` (and `--duration-ms <n>` if a duration is reported). The number is
   recorded as reported and `team stats` keeps it apart from the tokens the engine measures itself, so do not adjust,
   add up or estimate it. Leave the flags off when no number is reported.
   Do not edit, summarize or "fix" a reply; if a subagent replied with no tags at all, record it anyway (untagged
   text becomes `[SAY]`). If a reply itself contains a line `TEAM_REPLY_END`, write it to `.team/inbox/<member>.txt`
   and use `--file` instead.
   When the session enters `acceptance`, that call first runs the team's `[VERIFY]` command (the trial run, up to
   10 minutes), so give the Bash call recording the last `review` reply a long timeout (600000 ms).
4. When `phase` in that output changed (or every ~6 turns), give the user a 2–4 line update:
   what happened, key decisions/tasks, what's next. Use `team log --tail 15 --no-thoughts` if you need a recap.

## 3. Finish

- Show `team status` (backlog with results, tasks waiting on a person, questions for the human), the users'
  verdicts and `team stats` (tokens, cost and prompt size per phase and role), and point to
  `.team/sessions/<name>/transcript.html` (the full conversation to read in a browser; `transcript.md` is the same in
  Markdown) and `workspace/<name>/`. Trial runs and screenshots are in `.team/sessions/<name>/artifacts/`.
- Suggest next steps: another iteration (if users rejected and iterations remain the engine already looped back to
  `planning` — just continue the loop), new personas, or committing the result.

## Cloud sessions (Claude Code on the web, Claude Projects)

When `CLAUDE_CODE_REMOTE=true`, the container is thrown away after the session, and other threads of a project each get
their own fresh clone. So:

- **Save by pushing.** After each phase change and when you stop, commit `.team/sessions/<name>/` and `workspace/<name>/`
  and push to the branch you were told to work on. That is the only way the session survives and another thread
  (or a later session) can resume it with `team use <name>`.
- **One simulation per thread.** Every session builds in its own `workspace/<name>/`, so threads running different
  sessions never touch the same files. Do not run the same session from two threads at once.
- **Talk to the user through the host.** Your plain text may not reach the user (in Projects only the thread's reply
  and status tools do). Send the loop's step 4 updates there and keep the status checklist on the current phase. Subagents never
  message the user themselves.
- `pnpm` and the dev dependencies are installed by `.claude/hooks/session-start.sh`; the engine itself needs only Node.

## Human in the loop

- If the user says something meant for the team ("tell them the budget is small", "I want a web UI"), inject it:
  `team say "<their words>"` — every member sees it as a message from `human`.
- Members never wait on the user. When a reply has `[ASK_HUMAN]`, put the question (and the default the team went
  ahead with) in your next update to the user and keep the loop running; relay their answer with `team say`.
- If the user wants to *be* a member for a turn, record their words with `team record --as <member> --force`.
- To change who is on the team, edit `team.config.json` / `personas/*.json` and start a new session.

## Rules

- Never write turn content yourself or skip a pending member; the engine refuses out-of-turn records anyway.
- Never edit `.team/sessions/**` by hand — only through the CLI.
- Engineers are the only ones who change `workspace/`. If you notice a broken build between turns, do not fix it
  yourself: the next engineer turn (or review phase) will see it.
- If a subagent fails (error, empty output), retry it once; if it fails again, record
  `[SAY to=all] (could not attend this turn)` for that member and continue.
