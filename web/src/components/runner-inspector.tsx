import { useState } from "react";
import { ChevronDown, GitBranch, TerminalSquare } from "lucide-react";

import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";

export type RunnerInspectorProps = { runners: RunnerRecord[] };

export function RunnerInspector({ runners }: RunnerInspectorProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const byRole = (["developer", "reviewer", "qa"] as const).map(role => ({
    role,
    runners: runners.filter(runner => runner.role === role)
  }));

  return (
    <section className="runner-inspector" aria-label="Runner inspector">
      <header>
        <div><span className="eyebrow">Persistent team</span><h2>Runner inspector</h2></div>
        <span>{runners.filter(runner => runner.status === "working").length} active · {runners.length} provisioned</span>
      </header>
      <div className="runner-groups">
        {byRole.map(group => (
          <div key={group.role} className="runner-group">
            <div className="runner-group__label">{roleLabel(group.role)} <span>{group.runners.length}</span></div>
            <div className="runner-stack">
              {group.runners.length === 0 && <div className="runner-placeholder">Waiting for work</div>}
              {group.runners.map(runner => {
                const open = expanded === runner.id;
                return (
                  <article className="runner-card" key={runner.id} data-runner-card data-status={runner.status}>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`runner-${runner.id}`}
                      aria-label={`${roleLabel(runner.role)} ${String(runner.slot).padStart(2, "0")} — ${statusLabel(runner.status)}`}
                      onClick={() => setExpanded(open ? null : runner.id)}
                    >
                      <span className="runner-avatar">{initials(runner.role, runner.slot)}</span>
                      <span><strong>{runner.id}</strong><small>{runner.status}{runner.ticketId ? ` · ${runner.ticketId}` : ""}</small></span>
                      <ChevronDown size={15} className={open ? "rotate" : ""} />
                    </button>
                    {open && (
                      <div className="runner-details" id={`runner-${runner.id}`}>
                        <p><GitBranch size={13} /><span>{runner.branch}</span></p>
                        <p><TerminalSquare size={13} /><span>{runner.tmuxTarget}</span></p>
                        <p className="runner-path">{runner.worktreePath}</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function roleLabel(role: RunnerRecord["role"]): string {
  return role === "qa" ? "QA" : `${role[0]?.toUpperCase()}${role.slice(1)}`;
}

function statusLabel(status: RunnerRecord["status"]): string {
  return `${status[0]?.toUpperCase()}${status.slice(1)}`;
}

function initials(role: RunnerRecord["role"], slot: number): string {
  const initial = role === "developer" ? "D" : role === "reviewer" ? "R" : "Q";
  return `${initial}${slot}`;
}
