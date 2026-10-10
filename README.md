# team — a simulated product team that talks and builds together

**English** | [日本語](README.ja.md)

`team` combines persona simulation from [microsoft/TinyTroupe](https://github.com/microsoft/TinyTroupe) with the role-based development process of MetaGPT / ChatDev. A small team builds a product by **talking to each other**:

- a **Product Manager** who interviews users, decides scope and writes acceptance criteria
- several **engineers** who design, implement and review each other's work, writing real code in `workspace/`
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
| build | engineers (**in parallel**) | Each engineer implements their tasks in `workspace/` and reports `[TASK_DONE]` |
| review | engineers, PM | Cross-review and fixes; the PM checks the acceptance criteria |
| acceptance | users, PM | Users read or run the result and give `[VERDICT accept/reject]`; the PM sums up |

If any user rejects and the iteration limit (`maxIterations`) has not been reached, the team goes back to planning. Each phase ends after its maximum number of rounds, or earlier when the PM sends `[ADVANCE]`.

### Conversation protocol

Agents reply with plain-text tags, an extension of TinyTroupe's THINK / TALK / DONE actions (`src/protocol.ts`):

```
[THINK] private reasoning, visible only to its author
[SAY to=user-yamada] the addressed member speaks next (to=all addresses everyone)
[NOTE] long-term memory, shown to its author on every later turn
[TASK owner=eng-backend] title
acceptance criteria (on the following lines)
[TASK_DONE T1] what was implemented, in which files, and how it was verified
[DECISION] a decision the team follows from now on
[VERDICT accept] / [VERDICT reject] reasons
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

- Full conversation, including each member's private thoughts: `.team/sessions/<name>/transcript.md`
- The product being built: `workspace/`

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

## Customization

- **Members**: add or edit `personas/*.json` and list them under `members` in `team.config.json`. `role` is `pm`, `engineer` or `user`; other role names also work and join with a generic description. Everything under `persona` is free-form TinyTroupe-style JSON and goes into the prompt as-is. For users, details that affect how they would try the product (such as `tech_literacy`) make acceptance testing much more realistic.
- **Phases**: a `phases` array in `team.config.json` replaces `DEFAULT_PHASES` (`src/sop.ts`). Each phase has `id`, `goal`, `speakers`, `mode` (`round-robin` or `parallel`) and `maxRounds`. Optional fields:
  - `untilTasksDone`: end early once every task is done
  - `editors`: roles allowed to edit `workspace/` in this phase
  - `iterationStart`: where the next iteration restarts after a rejection
- **Language**: `language` (default `ja`) is the language the agents speak.
- **Memory length**: `historyWindow` is the number of recent transcript entries included in each prompt.

## Development

```bash
corepack enable      # once, if pnpm is not installed (pnpm version is pinned in package.json)
pnpm install         # devDependencies for type checking only
pnpm test            # node --test, no dependencies
pnpm typecheck       # tsc --noEmit
pnpm build:bin       # (optional) single executable via Bun
```

```
src/
  main.ts       entry point
  cli.ts        commands
  world.ts      the world: scheduling and applying actions (TinyWorld equivalent)
  sop.ts        phase definitions, role responsibilities and permissions
  protocol.ts   reply tag parser
  prompt.ts     per-turn prompt (persona, shared state, memory)
  store.ts      persistence under .team/
  render.ts     log and transcript.md formatting
  backends/     anthropic / claude-cli / mock
personas/       member definitions
.claude/        subagents (agents/) and the team-dev skill (skills/)
```

## Limitations

- Simulated users do not replace real users. Use them to widen hypotheses and catch obvious problems, then confirm important decisions with real people.
- Engineers in the build phase edit the same `workspace/` in parallel. They are told to keep to their own files, and conflicts are expected to be fixed in review.
- The `claude-cli` backend gives engineers Bash and edit tools in phases that allow editing. Run it in a trusted environment, such as a container or a cloud session.
