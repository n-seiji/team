# team — a simulated product team that talks and builds together

**English** | [日本語](README.ja.md)

`team` combines persona simulation from [microsoft/TinyTroupe](https://github.com/microsoft/TinyTroupe) with the role-based development process of MetaGPT / ChatDev. A small team builds a product by **talking to each other**:

- a **Product Manager** who interviews users, decides scope and writes acceptance criteria
- several **engineers** who design, implement and review each other's work, writing real code in `workspace/<session>/`
- several **user personas** who are outside the team: they answer interviews, then try what was built and accept or reject it

Key properties:

- **Runs anywhere.** It is written in TypeScript, but Node.js ≥ 22.18 runs `.ts` files directly, so there is no build step and no runtime dependency. It behaves the same on Linux, macOS and Windows, locally or in the cloud (CI tests all three OSes).
- **Runs inside Claude Code (Web) as-is.** No API key needed. Claude Code acts as the orchestrator and hands each member's turn to a role-specific subagent ("host mode").
- **Can also run unattended.** `team run --backend anthropic | claude-cli | mock` ("auto mode").

[docs/research.md](docs/research.md) (in Japanese) covers the prior work studied and how it maps to this design.

## How it works

```
             ┌──────────────── team engine (src/, state in .team/sessions/<name>/) ───────────────┐
             │  roster (personas/*.json) · SOP phases · who speaks next · transcript · backlog · decisions · verdicts │
             └───────▲───────────────────────────────┬──────────────────────────────────────────┘
       team record   │ reply (action tags)            │ team next → next speaker(s) + turn prompt
                     │                               ▼
  host mode: Claude Code (team-dev skill) ── subagents team-pm / team-engineer / team-persona
  auto mode: team run ── backend: anthropic (API) | claude-cli (claude -p) | mock
```

### Phases (SOP)

| Phase | Who speaks | What happens |
|---|---|---|
| discovery | PM, users | The PM interviews users and digs into concrete episodes. No solutions yet |
| planning | PM, engineers | The PM writes tasks with acceptance criteria and assigns owners; engineers debate feasibility, risks and tech choices |
| build | engineers (**in parallel**) | Each engineer implements their tasks in `workspace/<session>/` and reports `[TASK_DONE]` |
| review | engineers, PM | Cross-review and fixes; each engineer posts a `[DEMO]` with output they really produced and the team declares one verification command with `[VERIFY]`; the PM checks the acceptance criteria |
| acceptance | users, PM | First the engine itself runs the `[VERIFY]` command and keeps its real output and files (screenshots etc.) as a **trial run**. Users start from that trial run and the demos, read the result and give `[VERDICT accept/reject]`; the PM sums up |
| wrapup | engineers, PM | Only when the session is about to finish with open tasks, or with decisions made in review / acceptance that nobody has applied yet. Engineers apply them; tasks added in acceptance are handed over, not built, and the PM lists what is left for the real human |

If any user rejects, or the PM turns users' conditions into new tasks in acceptance, and the iteration limit (`maxIterations`) has not been reached, the team goes back to planning so users see the result. Each phase ends after its maximum number of rounds, or earlier when the PM sends `[ADVANCE]`. When the session finishes, the last log line names any task that is still open.

### Conversation protocol

Agents reply with plain-text tags, an extension of TinyTroupe's THINK / TALK / DONE actions (`src/protocol.ts`):

```
[THINK] a short private memo, visible only to its author
[SAY to=user-yamada] the addressed member speaks next (to=all addresses everyone)
[NOTE] long-term memory, shown to its author on every later turn
[TASK owner=eng-backend] title
acceptance criteria (on the following lines)
[TASK owner=eng-backend replaces=T1] a task that supersedes T1 (T1 is closed)
[TASK_DONE T1] what was implemented, in which files, and how it was verified (the command and its result, or "not run")
[TASK_BLOCKED T1] only a real person can finish this (a real device, an account, publishing): what they must do
[TASK_DROP T1] close a task the team will not do (PM only), with the reason; it cannot be reopened
[ASK_HUMAN] a question only the real human can answer, plus the default the team goes ahead with
[DEMO T1] what a user does and sees, with real output (pasted, or a generated file / screenshot path)
[VERIFY] one shell command that tries the product like a user, prints what it saw and saves screenshots to $TEAM_ARTIFACTS
[DECISION] a decision the team follows from now on
[VERDICT accept] / [VERDICT reject] reasons, what they are based on, what could not be checked
[ADVANCE] end the current phase (PM only)
[DONE]
```

Each role has its own set of allowed actions (for example, users cannot create tasks). Actions outside that set are ignored and noted in the log.

## Usage

### In Claude Code (Web / CLI / Desktop) — recommended

Open this repository in Claude Code and run:

```
/team-dev A tool that lets freelancers create an invoice from the terminal in under a minute
```

Claude Code then repeats `team next` → subagent → `team record`. Anything you say mid-session that is meant for the team ("tell them the budget is small") is shared with every member through `team say`. You can also set a stopping point, such as "just discovery" or "up to the next phase".

- Full conversation, including each member's private thoughts: `.team/sessions/<name>/transcript.md`, or `transcript.html` to read it in a browser (grouped by phase, filter by member, private memos hidden by default; `team log --html` prints its path and renders it for older sessions)
- Trial runs and evidence files: `.team/sessions/<name>/artifacts/`
- The product being built: `workspace/<name>/` (each session gets its own folder)

#### Claude Code on the web and Claude Projects

It works the same in cloud sessions. A few things differ because the container is temporary:

- `.claude/hooks/session-start.sh` installs pnpm and the dev dependencies in the background when a cloud session starts, so the session does not wait for it (the engine itself needs only Node).
- The session state and the product are saved by committing and pushing `.team/sessions/<name>/` and `workspace/<name>/`; the `team-dev` skill does this after each phase. Another thread or a later session resumes with "continue the <name> session".
- In a Claude Project, run one simulation per thread. Sessions build in separate folders, so threads never edit the same files.

### From the command line

```bash
node src/main.ts init --brief "what to build" --name my-session   # create a session
node src/main.ts status                                          # phase, next speaker, backlog
node src/main.ts run --backend claude-cli                        # auto mode: each turn via claude -p
ANTHROPIC_API_KEY=... node src/main.ts run --backend anthropic   # auto mode: Messages API directly
node src/main.ts run --backend mock                              # walk the flow without any LLM
node src/main.ts log --tail 20 --no-thoughts                     # transcript
node src/main.ts say "Let's focus on sole proprietors"           # speak to the team as the human
```

#### Working on an existing repository

To have the team work on another codebase (for example a GitHub issue), check it out as a git worktree and pass it as the workspace:

```bash
git -C ../app worktree add "$PWD/workspace/app-77" -b team/app-77   # one worktree per issue
node src/main.ts init --name app-77 --workspace workspace/app-77 --brief-file brief-77.md --config configs/app.json
node src/main.ts overlaps                                            # files / migration numbers other sessions also changed
```

With `--workspace` the folder is used in place (no `workspace/<session>/` is created). Prompts list only the files changed so far (git status and commits on top of the default branch), engineers are told to follow the codebase's own CLAUDE.md and rules, `claude-cli` turns run inside the workspace so its CLAUDE.md and hooks apply, and engineers see what other sessions on the same repository have changed. `team status` warns when two sessions touch the same file or create numbered files with the same number (such as `migrations/0021_*.sql`). Put personas that fit the product in a separate config (`--config`).

`pnpm team <command>` works too, as does `team <command>` after `pnpm link --global`.

To drive host mode yourself (for example from another agent framework):

```bash
node src/main.ts next --json          # → pending: [{ member, role, subagent, canEdit, promptFile }]
# give promptFile to an LLM and collect its reply
node src/main.ts record --as pm --file reply.txt
```

| Backend | Requires | Notes |
|---|---|---|
| (host mode) | Claude Code | No API key. Role-specific subagents. Engineers really edit files |
| `claude-cli` | the `claude` command | No API key. Engineers get edit tools in the phases that allow editing |
| `anthropic` | `ANTHROPIC_API_KEY` | Dependency-free `fetch` client. Conversation only (no file edits) |
| `mock` | nothing | Canned replies through one iteration. For tests and demos |

Set the model with `backend.model` in `team.config.json`, `--model`, or the `TEAM_MODEL` environment variable.

`claude-cli` turns load only the project's (and the external workspace's) Claude Code settings plus your deny rules, `env` and `apiKeyHelper` from the user settings. Global rules, plugins, hooks and skills are not loaded.

## Customization

- **Members**: add or edit `personas/*.json` and list them under `members` in `team.config.json`. `role` is `pm`, `engineer` or `user`; other role names also work and join with a generic description. Everything under `persona` is free-form TinyTroupe-style JSON and goes into the prompt as-is. For users, details that affect how they would try the product (such as `tech_literacy`) make acceptance testing much more realistic.
- **Phases**: a `phases` array in `team.config.json` replaces `DEFAULT_PHASES` (`src/sop.ts`). Each phase has `id`, `goal`, `speakers`, `mode` (`round-robin` or `parallel`) and `maxRounds`. Optional fields:
  - `untilTasksDone`: end early once every task is done
  - `editors`: roles allowed to edit `workspace/` in this phase
  - `iterationStart`: where the next iteration restarts after a rejection
  - `finale`: a wrap-up phase, skipped in the normal order and run once before finishing when work is left
- **Language**: `language` (default `ja`) is the language the agents speak.
- **Memory length**: `historyWindow` is the number of recent transcript entries included in each prompt.

## Development

```bash
npm install -g pnpm@12.9.0   # once, if pnpm is not installed (the version pinned in package.json; corepack cannot start pnpm 12)
pnpm install         # devDependencies for type checking only
pnpm test            # node --test, no dependencies
pnpm typecheck       # tsc --noEmit
pnpm build:bin       # (optional) single executable via Bun
```

`pnpm-workspace.yaml` sets `minimumReleaseAge` to 7 days, so pnpm refuses package versions published less than a week ago (the pinned pnpm version follows the same rule).

```
src/
  main.ts       entry point
  cli.ts        commands
  world.ts      the world: scheduling and applying actions (TinyWorld equivalent)
  sop.ts        phase definitions, role responsibilities and permissions
  protocol.ts   reply tag parser
  prompt.ts     per-turn prompt (persona, shared state, memory)
  store.ts      persistence under .team/
  overlap.ts    clashes between sessions working on the same repository
  render.ts     log and transcript.md formatting
  html.ts       transcript.html (the browser view)
  verify.ts     trial runs of the team's [VERIFY] command before acceptance
  backends/     anthropic / claude-cli / mock
personas/       member definitions
.claude/        subagents (agents/) and the team-dev skill (skills/)
```

## Limitations

- Simulated users do not replace real users. Use them to widen hypotheses and catch obvious problems, then confirm important decisions with real people.
- Users judge only what the team shows them: the demos and the files they can open. They cannot use a browser or a phone, so anything not demonstrated stays unverified, and they are told to say so.
- Engineers in the build phase edit the same `workspace/<session>/` in parallel. They are told to keep to their own files, and conflicts are expected to be fixed in review.
- In auto mode a turn that fails (for example an API error) is retried once; if it fails again the member skips that turn and the run goes on.
- The `claude-cli` backend gives engineers Bash and edit tools in phases that allow editing. Run it in a trusted environment, such as a container or a cloud session.
