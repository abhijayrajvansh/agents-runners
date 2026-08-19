# Codex Runners Plugin

## Agent skills

### Issue tracker

This plugin repo tracks issues and specs as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) map to matching GitHub labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- codex-runners:start -->
## Codex Runners

When `.codex-runners/config.json` exists, use the Codex Runners MCP tools as the shared task source and the bundled Matt Pocock skills as the workflow. Donna is the persistent project manager. Triage and planning statuses are inactive; issues marked `ready_for_agent` are processed autonomously one vertical slice at a time. Prefer /grill-with-docs, /to-spec, /to-tickets, /implement, and /code-review over inventing a new process. Do not create unmanaged worker processes or remove persistent runner worktrees. Never print environment-file values into chat, logs, tickets, or commits.
<!-- codex-runners:end -->
