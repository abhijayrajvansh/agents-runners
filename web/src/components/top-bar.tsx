import { Command, Plus, Search } from "lucide-react";

import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { ProjectEvent } from "../../../src/server/event-bus.js";

export type TopBarProps = {
  projectName: string;
  branch: string;
  connected: boolean;
  runners: RunnerRecord[];
  activity: ProjectEvent[];
  onCreate(): void;
  onCommand(): void;
};

export function TopBar({ projectName, branch, connected, runners, activity, onCreate, onCommand }: TopBarProps) {
  const visible = runners.slice(0, 5);
  const activityText = activity.at(-1)?.type.replaceAll(".", " ") ?? "Donna and runner pools are ready";
  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark">CR</div>
        <div><strong>Codex Runners</strong><span>{projectName} / {branch}</span></div>
      </div>
      <div className="top-activity" aria-label="Latest activity">
        <span className={`connection-dot ${connected ? "connection-dot--online" : ""}`} />
        <div className="activity-marquee"><span>{activityText}</span><span aria-hidden="true">{activityText}</span></div>
      </div>
      <div className="top-actions">
        <div className="runner-faces" aria-label={`${runners.length} provisioned runners`}>
          {visible.map(runner => <span key={runner.id} data-status={runner.status}>{runner.role[0]?.toUpperCase()}{runner.slot}</span>)}
          {runners.length > visible.length && <span>+{runners.length - visible.length}</span>}
        </div>
        <button type="button" className="quiet-button command-button" onClick={onCommand}><Search size={15} />Search <kbd><Command size={10} />K</kbd></button>
        <button type="button" className="primary-button" onClick={onCreate}><Plus size={15} />Create ticket</button>
      </div>
    </header>
  );
}
