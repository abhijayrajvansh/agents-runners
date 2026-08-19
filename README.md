# Codex Runners

Codex Runners is a macOS-first personal Codex plugin for autonomous software delivery. It opens a pure-white local Kanban board, keeps a persistent AI project manager named Donna available in browser and terminal, and coordinates stable Developer, Reviewer, and QA runner pools through isolated Git worktrees and tmux sessions.

Backlog is planning-only. Moving a ticket to Todo, In Progress, Review, or QA starts or resumes its workflow. Successful work progresses through review and QA, merges through one serialized integration lane, pushes the configured `dev` branch, and lands in Done.

## Requirements

- macOS
- Node.js 22 or newer
- Git
- tmux
- An authenticated Codex CLI

## Build and install

```bash
npm install
npm run build
codex plugin add codex-runners@personal
```

The repository is registered in the personal Codex marketplace as `codex-runners`. Start a new Codex thread after installation so the skill, MCP server, and lifecycle hooks are reloaded.

## Initialize a project

Run from a Git repository that has a local `dev` integration branch:

```bash
codex-runners init
codex-runners doctor
codex-runners start
codex-runners open
```

Initialization adds:

- `.codex-runners/config.json` — readable board and automation settings
- `.codex-runners/runtime/` — ignored process, event, retry, and thread state
- a managed Codex Runners section in `AGENTS.md`
- a project SessionStart hook in `.codex/hooks.json`
- safe ignore rules for runtime files, development environments, and runner worktrees

The SessionStart hook reuses or starts the loopback daemon, registers the project, injects MCP context, and opens `http://127.0.0.1:4777/projects/<project-id>` when enabled.

## Daily use

```bash
codex-runners start
codex-runners stop
codex-runners restart
```

Run lifecycle commands from a project folder. `codex-runners start` starts or reuses the shared daemon, registers the current project, opens its board, and then enters an interactive Codex CLI session in that project. The command returns to the shell when the Codex session exits. Repeated starts reuse the same daemon and project. `codex-runners stop` shuts down the background daemon. `codex-runners restart` stops the current daemon, clears any legacy foreground session, then reopens the same project in the background. All lifecycle commands preserve tickets, branches, worktrees, tmux panes, and Codex thread IDs.

The full CLI remains available for diagnostics and Donna:

```bash
codex-runners status
codex-runners ls
codex-runners doctor
codex-runners donna
```

The browser and terminal use the same persistent Donna thread. Stopping the daemon never deletes tickets, branches, worktrees, tmux identities, or Codex thread IDs.

See [configuration](docs/configuration.md) for every project setting and [architecture](docs/architecture.md) for the runtime model.

## Safety

Codex Runners binds only to `127.0.0.1`. Generated projects default to full local Codex permissions because the runner team must build and test without approval pauses; that choice remains visible as `automation.fullAccess`. Development environment files may be copied by filename and bytes, but their values are redacted from API responses, WebSocket events, MCP responses, logs, and the UI. Production-like environment files remain excluded unless the user explicitly enables them.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The complete release gate is `npm run gate`.
