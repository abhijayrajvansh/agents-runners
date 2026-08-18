import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ListTodo, Plus, Search, X } from "lucide-react";

import type { Ticket } from "../../../src/domain/types.js";
import { RunnersApi } from "../api/client.js";

type TicketSearchResult = { projectId: string; projectName: string; ticket: Ticket };

export type CommandPaletteProps = {
  open: boolean;
  onClose(): void;
  onCreate(): void;
  onOpenDonna(): void;
};

export function CommandPalette({ open, onClose, onCreate, onOpenDonna }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState<TicketSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const commands = useMemo(() => [
    { label: "Create ticket", detail: "Add work to Backlog or start it in Todo", icon: Plus, run: onCreate },
    { label: "Message Donna", detail: "Plan, assign, or inspect project work", icon: ArrowRight, run: onOpenDonna }
  ].filter(command => fuzzyMatch(query, `${command.label} ${command.detail}`)), [onCreate, onOpenDonna, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setTickets([]);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    const value = query.trim();
    if (!open || !value) {
      setTickets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void new RunnersApi().searchTickets(value)
        .then(setTickets)
        .catch(() => setTickets([]))
        .finally(() => setLoading(false));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  if (!open) return null;
  return (
    <div className="palette-scrim" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search"><Search size={17} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} aria-label="Search commands and tickets" placeholder="Search commands or tickets…" /><button type="button" aria-label="Close command palette" onClick={onClose}><X size={16} /></button></div>
        <div className="palette-results">
          {commands.length > 0 && <div className="palette-results__label">Commands</div>}
          {commands.map(command => <button type="button" key={command.label} onClick={() => { command.run(); onClose(); }}><command.icon size={16} /><span><strong>{command.label}</strong><small>{command.detail}</small></span><ArrowRight size={14} /></button>)}
          {query.trim() && <div className="palette-results__label">Tickets {loading && <small>Searching…</small>}</div>}
          {tickets.map(result => (
            <button
              type="button"
              key={`${result.projectId}:${result.ticket.id}`}
              onClick={() => window.location.assign(`/projects/${encodeURIComponent(result.projectId)}?ticket=${encodeURIComponent(result.ticket.id)}`)}
            >
              <ListTodo size={16} />
              <span><strong>{result.ticket.title}</strong><small>{result.ticket.id} · {result.projectName} · {result.ticket.status.replaceAll("_", " ")}</small></span>
              <ArrowRight size={14} />
            </button>
          ))}
          {query.trim() && !loading && commands.length === 0 && tickets.length === 0 && <div className="palette-results__empty">No matching commands or tickets</div>}
        </div>
      </div>
    </div>
  );
}

function fuzzyMatch(query: string, value: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = value.toLowerCase();
  if (haystack.includes(needle)) return true;
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}
