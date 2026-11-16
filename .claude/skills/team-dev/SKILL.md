---
name: team-dev
description: Run a simulated product team — a PM, several engineers and user personas — that interviews users, plans, builds real code in workspace/, reviews and gets user acceptance, all by talking to each other. Use when the user asks to start, continue or check a team simulation / "team dev" session, or invokes /team-dev with a product idea.
---

# team-dev: orchestrate the team (host mode)

You are the **facilitator / runtime**. The `team` engine (`node src/main.ts`, zero dependencies) owns all state:
who speaks next, the transcript, backlog, decisions and verdicts. You never invent turns yourself — each member's turn
is played by a dedicated subagent, and you just move messages between the engine and the subagents.

All commands run from the repository root. `team` below means `node src/main.ts`: always type the full
`node src/main.ts ...` at the start of the command (no `cd`, no env prefix, no pipe), so the user can see at a
glance what runs and add a permission rule for it if they want one.

## 1. Start or resume (one command, no checks first)

- **The user gave a product idea** → `team init "<their idea, in their words>" --name <short-kebab-name> --json`.
  Its output is the same as `team next --json`, so go straight to step 2.2 and launch the first subagent.
  If the name is already taken, choose another one; `--force` deletes everything saved for that session
  (`.team/sessions/<name>/`), so use it only when the user asked to start it over. A short name is easier for the
  user to say later ("continue the <name> session"); without `--name` the session is named after the local date and
  time (`20261115-1554`).
- **Work on an existing repository / a GitHub issue** → check the repository out as a git worktree under `workspace/`
  (one per issue, its own branch), write the issue (title, body, links) to a brief file, and run
  `team init --name <short-name> --workspace workspace/<short-name> --brief-file <file> --json`. Use a config with
  personas that fit that product (`--config`). After each session, run `team overlaps` and tell the user about any
  file or migration-number clash with other sessions on the same repository.
- **"Continue" / no idea** → `team next --json` resumes the current session (`team sessions` lists every session with
  its state, result and last activity, `*` marking the current one; `team use <name>` switches). If the user named a
  session ("continue the <name> session", which is what the `Next:` line of `team status` tells them to say), run
  `team use <name>` first, then `team next --json`. If there is no session, ask for one sentence about the product and
  who it is for.
  If the session is `done` (`status` is `"done"` in that output), it is finished and `team next` will not move it. Another
  iteration costs about as many tokens as the first one did, so do not start it on your own: say that the session is
  finished, and ask whether to give it one more iteration (`team continue`, optionally with what they want changed or
  added, e.g. `team continue "<their words>"`; `--iterations N` for more than one) or to start a new product.
  Run `team continue ... --json` only after they agree: its output is the same as `team next --json`, so go straight to
  step 2.2. It warns on stderr when `workspace/<name>/` is missing or empty (the team then cannot see what it built
  before); tell the user. `team continue` refuses a session that is still running.

Do not run `team status` or read other files before the first turn. In the same message that launches the first
subagent, tell the user, in a few lines:

- the session name;
- that the conversation so far can be read by opening `.team/sessions/<name>/transcript.html` in a browser (the file
  is rewritten each time a reply is recorded, so reload it);
- that they can interject at any time (the team hears it through `team say`).

## 2. The loop

Repeat until the session is `done`, or until the stopping point the user asked for (e.g. "just discovery",
"one phase", "N turns"). If they gave none, run until the end of the current iteration.

1. `team next --json` → `{ status, phase, round, openQuestions: [{ id, by, text }], pending: [{ member, name, role, subagent, promptFile }] }`.
   If `status` is `"done"`, go to step 3.
   Every result of this shape (from `next`, and from `init`, `continue` and `record` with `--json`) can carry new
   questions for the human (`[ASK_HUMAN]`). Ids only grow (`Q1`, `Q2`, ...), so an `openQuestions` entry is new exactly
   when its number is greater than the highest one you have already told the user about in this conversation (none yet
   on a resumed session). Tell the user about every new one at once, in the same message that launches the next
   subagents, without waiting for a phase change or the ~6-turn update: the id, the question with the default the team
   went ahead with (it is in the text), and how to answer, `team answer <id> "<answer>"`, which you run for them from
   their words. Say that the team keeps going on its default until they answer.
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
   The `--json` output is the next step 1 result, so go straight to step 2 (no separate `team next`). It also has
   `recorded: { member, actions }`: the kinds of action found in the last reply (for example `["SAY", "TASK"]`),
   including any the role may not use, which the engine ignores. Use it only as material for the user update, not to
   judge whether the reply took effect.
   When the Agent result reports a token total for the subagent (shown as `subagent_tokens` in Claude Code), pass
   it to that member's `record` as `--tokens <n>` (and `--duration-ms <n>` if a duration is reported). The number is
   recorded as reported and `team stats` keeps it apart from the tokens the engine measures itself, so do not adjust,
   add up or estimate it. Leave the flags off when no number is reported.
   Do not edit, summarize or "fix" a reply; if a subagent replied with text but no tags at all, record it anyway
   (untagged text becomes `[SAY]`). An empty reply is the one exception: `record` refuses it (exit 1, nothing is
   recorded), so retry the subagent as described under Rules. If a reply itself contains a line `TEAM_REPLY_END`, write it to `.team/inbox/<member>.txt`
   and use `--file` instead.
   When the session enters `acceptance`, that call first runs the team's `[VERIFY]` command (the trial run, up to
   10 minutes), so give the Bash call recording the last `review` reply a long timeout (600000 ms).
4. When `phase` in that output changed (or every ~6 turns), give the user a 2–4 line update:
   what happened, key decisions/tasks, what's next. Use `team log --tail 15 --no-thoughts` if you need a recap.
   Questions for the human are not part of this update: step 1 reports them as soon as they appear.

## 3. Finish

- Show `team status`. It is a summary that already holds what the user needs: one line per task, **what a person has to
  do** (the hand-offs of tasks waiting on a person and the checks a person should make on built tasks, both in full),
  the users' verdicts (accept or reject, with the start of the reason), the questions for the human (open and
  answered), any overlap with other sessions, and the next steps. Tell the user about the "needs a person" items, the
  verdicts and the open questions, in your own words; do not leave one out. Run `team status --full` only when the
  user asks what each task was built to do and how it was checked (every task's acceptance criteria and result).
  Then show `team stats` (tokens, cost and prompt size per phase and role), and point to
  `.team/sessions/<name>/transcript.html` (the full conversation to read in a browser; `transcript.md` is the same in
  Markdown) and `workspace/<name>/`. Trial runs and screenshots are in `.team/sessions/<name>/artifacts/`.
- Suggest next steps: another iteration (if users rejected and iterations remain the engine already looped back to
  `planning` — just continue the loop), new personas, or committing the result. To push a finished session further, offer
  `team continue "<what they want added or changed>"` (one more iteration planned by the PM from those words; it
  costs a full iteration of tokens, so run it only when they say yes). The words stay in the prompts only while they are
  among the last `historyWindow` entries, so for a lasting requirement tell the PM to record it as a `[DECISION]`.

## Cloud sessions (Claude Code on the web, Claude Projects)

When `CLAUDE_CODE_REMOTE=true`, the container is thrown away after the session, and other threads of a project each get
their own fresh clone. So:

- **Save by pushing.** After each phase change and when you stop, commit `.team/sessions/<name>/` and `workspace/<name>/`
  and push to the branch you were told to work on. That is the only way the session survives and another thread
  (or a later session) can resume it with `team use <name>`.
- **One simulation per thread.** Every session builds in its own `workspace/<name>/`, so threads running different
  sessions never touch the same files. Do not run the same session from two threads at once.
- **Talk to the user through the host.** Your plain text may not reach the user (in Projects only the thread's reply
  and status tools do). Send the loop's step 1 question reports and step 4 updates there and keep the status checklist on the current phase. Subagents never
  message the user themselves.
- `pnpm` and the dev dependencies are installed by `.claude/hooks/session-start.sh`; the engine itself needs only Node.

## Human in the loop

- If the user says something meant for the team ("tell them the budget is small", "I want a web UI"), inject it:
  `team say "<their words>"` — every member sees it as a message from `human`. A finished session refuses `team say`
  (nobody would read it); to tell it to the team, continue the session with `team continue "<their words>"`
  once the user agreed to another iteration (step 1).
- Members never wait on the user. When a reply has `[ASK_HUMAN]`, the question appears in `openQuestions` with its id
  (`Q1`, `Q2`, ...). Report it as loop step 1 says, and keep the loop running. Relay the user's answer to a specific
  question with `team answer Qn "<their words>"`; it overrides the default for the whole team from the next prompt on, the question then leaves `openQuestions`, and answering the same
  id again replaces the answer. When members asked the same thing (say two parallel engineers as Q3 and Q4), answer
  each id: a duplicate you leave open stays open and the team keeps going on its own default. On a finished session
  `team answer` only records the answer (nobody acts on it any more), so tell the user that instead of promising a
  change; the team acts on it only if the session is continued with `team continue` (step 1: ask the user first).
  Keep `team say` for everything else.
- If the user wants to *be* a member for a turn, record their words with `team record --as <member> --force`.
- To change who is on the team, edit `team.config.json` / `personas/*.json` and start a new session.

## Rules

- Never write turn content yourself or skip a pending member; the engine refuses out-of-turn records anyway.
- Never edit `.team/sessions/**` by hand — only through the CLI.
- Engineers are the only ones who change `workspace/`. If you notice a broken build between turns, do not fix it
  yourself: the next engineer turn (or review phase) will see it.
- If a subagent fails (error, empty or whitespace-only output), retry it once; if it fails again, record
  `[SAY to=all] (could not attend this turn)` for that member and continue. Never pass an empty reply to `record`.
  A member whose `record` failed (an empty reply, say) stays in `pending`: launch their subagent again, and record
  the skip line if the second reply fails too.
