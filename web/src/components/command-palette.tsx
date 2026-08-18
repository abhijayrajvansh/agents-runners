import { useEffect, useState } from "react";
import { ArrowRight, Plus, Search, X } from "lucide-react";

export type CommandPaletteProps = {
  open: boolean;
  onClose(): void;
  onCreate(): void;
  onOpenDonna(): void;
};

export function CommandPalette({ open, onClose, onCreate, onOpenDonna }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  if (!open) return null;
  const commands = [
    { label: "Create ticket", detail: "Add work to Backlog or start it in Todo", icon: Plus, run: onCreate },
    { label: "Message Donna", detail: "Plan, assign, or inspect project work", icon: ArrowRight, run: onOpenDonna }
  ].filter(command => command.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="palette-scrim" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search"><Search size={17} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} aria-label="Search commands" placeholder="Search commands…" /><button type="button" aria-label="Close command palette" onClick={onClose}><X size={16} /></button></div>
        <div className="palette-results">{commands.map(command => <button type="button" key={command.label} onClick={() => { command.run(); onClose(); }}><command.icon size={16} /><span><strong>{command.label}</strong><small>{command.detail}</small></span><ArrowRight size={14} /></button>)}</div>
      </div>
    </div>
  );
}
