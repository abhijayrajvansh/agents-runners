import { Plus } from "lucide-react";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import { GlobalSearch } from "./global-search.js";

export type TopBarProps = {
  projectName: string;
  branch: string;
  runners: RunnerRecord[];
  onCreate(): void;
};

export function TopBar({ projectName, branch, runners, onCreate }: TopBarProps) {
  const count = (role: RunnerRecord["role"]) => runners.filter(runner => runner.role === role).length;
  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark">CR</div>
        <div><strong>Codex Runners</strong><span>{projectName} / {branch}</span></div>
      </div>
      <GlobalSearch />
      <div className="top-actions">
        <div className="agent-counts" aria-label="Provisioned agent counts">
          <span title="Developers" aria-label={`${count("developer")} developers`}>💻 <strong>{count("developer")}</strong></span>
          <span title="Reviewers" aria-label={`${count("reviewer")} reviewers`}>🔍 <strong>{count("reviewer")}</strong></span>
          <span title="QA testers" aria-label={`${count("qa")} QA testers`}>🧪 <strong>{count("qa")}</strong></span>
        </div>
        <button type="button" className="primary-button" onClick={onCreate}><Plus size={15} />Create ticket</button>
      </div>
    </header>
  );
}
