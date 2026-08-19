# Skill-Driven Runner

Agents Runners moved off a fixed Agile/Kanban pipeline and onto Matt Pocock's small, composable engineering skills. The skill files live in `skills/` (vendored from `github.com/mattpocock/skills` under the MIT license), and the run-once configuration lives in `docs/agents/` with an `## Agent skills` pointer block in `AGENTS.md`.

## The flow

The bundled skills form one connected chain:

```text
/grill-with-docs -> /to-spec -> /to-tickets -> /implement -> /code-review
        \                                                          /
         ------------------ /triage (inbound) ---------------------
        /wayfinder (efforts too large for one session)
```

- `/ask-matt` is the router: it reads the situation and points at the right skill or flow.
- `/grill-with-docs` settles a plan and writes the domain glossary into `CONTEXT.md` plus ADRs into `docs/adr/`.
- `/to-spec` records a settled conversation as a spec on the configured issue tracker.
- `/to-tickets` cuts that spec into tracer-bullet vertical-slice tickets, each declaring its blocking edges on `dependencies`. Every ticket starts `ready_for_agent`.
- `/implement` builds one ticket per fresh session, driving `/tdd` at the agreed seam and closing with `/code-review`.
- `/code-review` reviews the diff along two independent axes, Standards and Spec, against the originating issue.
- `/triage` routes inbound issues (bugs and external requests) through the five canonical triage roles.
- `/wayfinder` charts an effort too large for one session as a map of decision tickets; it plans, it does not build.

## How the runner consumes it

The Agents Runners daemon is the delivery engine underneath this flow. Planning and triage statuses are inert and editable (`backlog`, `needs_triage`, `needs_info`, `ready_for_human`, `wontfix`). When an issue reaches `ready_for_agent`, the scheduler claims it with a persistent developer runner and runs it through implement → review → verification → Done, then merges through one serialized integration lane.

The schema records how each issue entered the board:

- `kind` — `issue`, `spec`, `ticket`, `decision`, or `map`
- `source` — `manual`, `triage`, `to_spec`, `to_tickets`, `wayfinder`, or `donna`
- `category` and `triageState` — the triage dimension for inbound issues
- `dependencies` — the blocking edges `/to-tickets` and `/wayfinder` work with

## Updating the vendored skills

The skills were installed with the official loader into `skills/`. The `skills-lock.json` records the source (`mattpocock/skills`) and each skill's path and hash, so `npx skills update` can re-sync them. Because three promoted skills (`code-review`, `to-spec`, and `setup-matt-pocock-skills`) were skipped by the installer due to a YAML frontmatter colon-parse bug, they were copied from the upstream repo with their `description:` frontmatter quoted; keep that fix if you re-sync.
