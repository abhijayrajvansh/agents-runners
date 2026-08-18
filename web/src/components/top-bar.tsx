import { Plus } from "lucide-react";
import { GlobalSearch } from "./global-search.js";

export type TopBarProps = {
  projectName: string;
  branch: string;
  onCreate(): void;
};

export function TopBar({ projectName, branch, onCreate }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark">CR</div>
        <div><strong>Codex Runners</strong><span>{projectName} / {branch}</span></div>
      </div>
      <GlobalSearch />
      <div className="top-actions">
        <button type="button" className="primary-button" onClick={onCreate}><Plus size={15} />Create ticket</button>
      </div>
    </header>
  );
}
