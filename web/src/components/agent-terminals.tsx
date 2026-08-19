import { useEffect, useRef, useState } from "react";
import { Check, Copy, TerminalSquare } from "lucide-react";

import type { AgentTerminalSnapshot } from "../../../src/orchestration/automation-manager.js";
import { RunnersApi } from "../api/client.js";

const api = new RunnersApi();

export function AgentTerminals({ projectId }: { projectId: string }) {
  const [terminals, setTerminals] = useState<AgentTerminalSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await api.listTerminals(projectId);
        if (active) {
          setTerminals(next);
          setError(null);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 750);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId]);

  const activeCount = terminals.filter(terminal => terminal.status === "working").length;
  const visibleTerminals = filter === "active" ? terminals.filter(terminal => terminal.status === "working") : terminals;
  return (
    <main className="terminals-page">
      <div className="terminals-heading">
        <div><span className="eyebrow">Live agent workspace</span><h1>Agent terminals</h1></div>
        <div className="terminals-toolbar">
          <div className="terminal-filters" role="tablist" aria-label="Terminal filters">
            <button type="button" role="tab" aria-selected={filter === "active"} onClick={() => setFilter("active")}>Active <span>{activeCount}</span></button>
            <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All <span>{terminals.length}</span></button>
          </div>
          <span className="terminals-live"><i /> Updating live</span>
        </div>
      </div>
      {error && <div className="terminal-error">{error}</div>}
      <div className="terminal-grid">
        {visibleTerminals.map(terminal => <TerminalCard key={terminal.id} terminal={terminal} />)}
        {visibleTerminals.length === 0 && !error && <div className="terminal-empty"><TerminalSquare size={22} /><span>{filter === "active" ? "No agents are working right now." : "No agent terminals are provisioned yet."}</span></div>}
      </div>
    </main>
  );
}

function TerminalCard({ terminal }: { terminal: AgentTerminalSnapshot }) {
  const output = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [terminal.output]);
  const copyAttachCommand = async () => {
    await navigator.clipboard.writeText(terminal.attachCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <section className="terminal-card" data-status={terminal.status}>
      <header>
        <div className="terminal-identity"><span>{iconFor(terminal.role)}</span><div><strong>{terminal.id}</strong><small>{terminal.role}</small></div></div>
        <div className="terminal-header-actions">
          <button type="button" className="terminal-copy" title={terminal.attachCommand} aria-label={`Copy attach command for ${terminal.id}`} onClick={() => void copyAttachCommand()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? "Copied" : "Attach"}</span>
          </button>
          <div className="terminal-state"><i /><span>{terminal.status}</span></div>
        </div>
      </header>
      <div className="terminal-context">
        <span>{terminal.ticketId ?? "Waiting for work"}</span>
        <span>{terminal.command} · PID {terminal.pid || "—"}</span>
      </div>
      <pre ref={output}>{terminal.output || "$ Waiting for terminal output…"}</pre>
    </section>
  );
}

function iconFor(role: AgentTerminalSnapshot["role"]): string {
  if (role === "donna") return "✦";
  if (role === "reviewer") return "🔍";
  if (role === "qa") return "🧪";
  return "💻";
}
