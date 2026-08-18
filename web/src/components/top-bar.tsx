import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import type { RoleName } from "../../../src/domain/types.js";

export type TopBarProps = {
  projectName: string;
  branch: string;
  poolMaximums: Record<RoleName, number>;
  onSetPoolMaximum(role: RoleName, maximum: number): Promise<void>;
  onCreate(): void;
};

export function TopBar({ projectName, branch, poolMaximums, onSetPoolMaximum, onCreate }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark">CR</div>
        <div><strong>Codex Runners</strong><span>{projectName} / {branch}</span></div>
      </div>
      <div className="top-actions">
        <div className="agent-counts" aria-label="Maximum agent counts">
          <AgentCapacity emoji="💻" label="developers" role="developer" maximum={poolMaximums.developer} onChange={onSetPoolMaximum} />
          <AgentCapacity emoji="🔍" label="reviewers" role="reviewer" maximum={poolMaximums.reviewer} onChange={onSetPoolMaximum} />
          <AgentCapacity emoji="🧪" label="QA testers" role="qa" maximum={poolMaximums.qa} onChange={onSetPoolMaximum} />
        </div>
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
