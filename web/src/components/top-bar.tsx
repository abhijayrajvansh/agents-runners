import { ChevronDown, ChevronUp, LayoutDashboard, Moon, Plus, Sun, TerminalSquare } from "lucide-react";
import type { RoleName } from "../../../src/domain/types.js";

export type TopBarProps = {
  projectName: string;
  projectId: string;
  branch: string;
  agent: "codex" | "claude";
  view: "board" | "terminals";
  poolMaximums: Record<RoleName, number>;
  theme: "light" | "dark";
  onSetPoolMaximum(role: RoleName, maximum: number): Promise<void>;
  onToggleTheme(): void;
  onCreate(): void;
};

const AGENT_LABELS = { codex: "Codex", claude: "Claude Code" } as const;

export function TopBar({ projectName, projectId, branch, agent, view, poolMaximums, theme, onSetPoolMaximum, onToggleTheme, onCreate }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark">AR</div>
        <div><strong>Agents Runners</strong><span>{projectName} / {branch} · {AGENT_LABELS[agent]}</span></div>
      </div>
      <div className="top-actions">
        <nav className="view-switcher" aria-label="Project views">
          <a data-active={view === "board" || undefined} href={`/projects/${encodeURIComponent(projectId)}`}><LayoutDashboard size={13} />Board</a>
          <a data-active={view === "terminals" || undefined} href={`/projects/${encodeURIComponent(projectId)}/agents-terminals`}><TerminalSquare size={13} />Terminals</a>
        </nav>
        <div className="agent-counts" aria-label="Maximum agent counts">
          <AgentCapacity emoji="💻" label="developers" role="developer" maximum={poolMaximums.developer} onChange={onSetPoolMaximum} />
          <AgentCapacity emoji="🔍" label="reviewers" role="reviewer" maximum={poolMaximums.reviewer} onChange={onSetPoolMaximum} />
          <AgentCapacity emoji="🧪" label="QA testers" role="qa" maximum={poolMaximums.qa} onChange={onSetPoolMaximum} />
        </div>
        <button
          type="button"
          className="theme-toggle"
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          onClick={onToggleTheme}
        >
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <button type="button" className="primary-button" onClick={onCreate}><Plus size={15} />Create ticket</button>
      </div>
    </header>
  );
}

function AgentCapacity({ emoji, label, role, maximum, onChange }: {
  emoji: string;
  label: string;
  role: RoleName;
  maximum: number;
  onChange(role: RoleName, maximum: number): Promise<void>;
}) {
  return (
    <span className="agent-capacity" title={`Maximum ${label}`}>
      <span aria-hidden="true">{emoji}</span>
      <strong aria-label={`Maximum ${label}: ${maximum}`}>{maximum}</strong>
      <span className="agent-capacity__steps">
        <button type="button" aria-label={`Increase maximum ${label}`} disabled={maximum >= 20} onClick={() => void onChange(role, maximum + 1)}><ChevronUp size={9} /></button>
        <button type="button" aria-label={`Decrease maximum ${label}`} disabled={maximum <= 0} onClick={() => void onChange(role, maximum - 1)}><ChevronDown size={9} /></button>
      </span>
    </span>
  );
}
