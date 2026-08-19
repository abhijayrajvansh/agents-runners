# Agents Runners

Agents Runners is a macOS-first personal plugin for skill-driven autonomous software delivery, running on **Codex, Claude Code, or both**. It opens a local issue board, keeps a persistent AI project manager named Donna available in browser and terminal, and coordinates stable Developer, Reviewer, and QA runner pools through isolated Git worktrees and tmux sessions.

Both CLIs are driven the same way: one headless turn per delivery stage, streaming JSONL, resumed by a thread handle that survives restarts. `agent.kind` in a project's config picks the CLI, and Donna and each pool can override it, so one board can run Claude Code developers next to Codex reviewers.

The plugin bundles Matt Pocock's composable engineering skills under `skills/` and wires them as the workflow: `/grill-with-docs` to settle a plan and build the domain glossary, `/to-spec` to record a spec, `/to-tickets` to cut tracer-bullet vertical-slice tickets with blocking edges, `/implement` to build one ticket per fresh session, and `/code-review` to check the diff against the originating spec. `/triage` routes inbound issues, and `/wayfinder` charts efforts too large for one session into decision tickets.

Planning and triage (`backlog`, `needs_triage`, `needs_info`, `ready_for_human`, `wontfix`) are inert. An issue is fully specified and ready by the time it reaches `ready_for_agent`; moving it there starts autonomous delivery. It progresses through implement, review, and verification, merges through one serialized integration lane, pushes the configured `dev` branch, and lands in Done.

## Requirements

- macOS
- Node.js 22 or newer
- Git
- tmux
- At least one authenticated agent CLI: Codex, Claude Code, or both

## Build and install

```bash
npm install
npm run build
```

Then install it into whichever agent you use.

**Codex**

```bash
codex plugin add agents-runners@personal
```

**Claude Code**

```bash
claude plugin marketplace add ~/path/to/agents-runners
claude plugin install agents-runners@agents-runners
```

Start a new session afterwards so the skills, MCP server, and lifecycle hooks are reloaded.

## Initialize a project

Run from a Git repository that has a local `dev` integration branch:

```bash
agents-runners init                  # detects the installed agent CLI
agents-runners init --agent claude   # or name it explicitly
agents-runners doctor
agents-runners start
agents-runners open
```

Initialization adds:

- `.agents-runners/config.json` — readable board and automation settings, including `agent.kind`
- `.agents-runners/runtime/` — ignored process, event, retry, and thread state
- a managed Agents Runners section in `AGENTS.md` and/or `CLAUDE.md`
- a project SessionStart hook in `.codex/hooks.json` and/or `.claude/settings.json`
- safe ignore rules for runtime files, development environments, and runner worktrees

Hooks are installed for every agent CLI found on this machine, so the board comes up whichever editor you open the repo in. `agent.kind` separately decides which CLI the runners themselves use. Re-running `init --agent <kind>` switches an existing project; the board, tickets, worktrees, and branches carry over, while agent threads restart because they belong to the CLI that created them.

Projects initialized before dual-agent support keep their existing `.codex-runners/` directory and continue to work unchanged.

The SessionStart hook reuses or starts the loopback daemon, registers the project, injects MCP context, and opens `http://127.0.0.1:4777/projects/<project-id>` when enabled.

## Daily use

```bash
agents-runners start
agents-runners stop
agents-runners restart
```

Run lifecycle commands from a project folder. `agents-runners start` starts or reuses the shared daemon, registers the current project, opens its board, and immediately returns to the shell while work continues in the background. Repeated starts reuse the same daemon and project. `agents-runners stop` shuts down the background daemon. `agents-runners restart` stops the current daemon, clears any legacy foreground session, then reopens the same project in the background. All lifecycle commands preserve tickets, branches, worktrees, tmux panes, and agent thread IDs.

The full CLI remains available for diagnostics and Donna:

```bash
agents-runners status
agents-runners ls
agents-runners doctor
agents-runners donna
```

The browser and terminal use the same persistent Donna thread. Stopping the daemon never deletes tickets, branches, worktrees, tmux identities, or agent thread IDs.

See [configuration](docs/configuration.md) for every project setting and [architecture](docs/architecture.md) for the runtime model.

## Safety

Agents Runners binds only to `127.0.0.1`. Generated projects default to full local agent permissions (`--dangerously-bypass-approvals-and-sandbox` on Codex, `--dangerously-skip-permissions` on Claude Code) because the runner team must build and test without approval pauses; that choice remains visible as `automation.fullAccess`. Development environment files may be copied by filename and bytes, but their values are redacted from API responses, WebSocket events, MCP responses, logs, and the UI. Production-like environment files remain excluded unless the user explicitly enables them.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The complete release gate is `npm run gate`.
