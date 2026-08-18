import { FormEvent, useEffect, useState } from "react";
import { X } from "lucide-react";

import type { Ticket, TicketStatus } from "../../../src/domain/types.js";
import { humanBlockerPrompt, readableBlockerReason } from "../../../src/orchestration/blockers.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";

export type TicketDrawerProps = {
  open: boolean;
  ticket: Ticket | null;
  tickets: Ticket[];
  runners: RunnerRecord[];
  onClose(): void;
  onSave(ticket: Partial<Ticket> & { id?: string }): Promise<void>;
};

export function TicketDrawer({ open, ticket, tickets, runners, onClose, onSave }: TicketDrawerProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TicketStatus>("backlog");
  const [priority, setPriority] = useState<Ticket["priority"]>("medium");
  const [assignedRunnerId, setAssignedRunnerId] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [humanInput, setHumanInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(ticket?.title ?? "");
    setDescription(ticket?.description ?? "");
    setStatus(ticket?.status ?? "backlog");
    setPriority(ticket?.priority ?? "medium");
    setAssignedRunnerId(ticket?.assignedRunnerId ?? "");
    setAcceptance(ticket?.acceptanceCriteria.join("\n") ?? "");
    setHumanInput("");
  }, [ticket, open]);

  if (!open) return null;
  const waitingForDependencies = Boolean(ticket?.dependencies.some(id => tickets.find(candidate => candidate.id === id)?.status !== "done"));
  const needsHumanInput = ticket?.status === "blocked" && (ticket.blocker?.kind ?? (waitingForDependencies ? "dependency" : "human_input")) === "human_input";
  const blockerReason = readableBlockerReason(ticket?.blocker?.reason);
  const blockerPrompt = humanBlockerPrompt(ticket?.title ?? title, blockerReason);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const response = humanInput.trim();
      const resume = Boolean(needsHumanInput && response);
      await onSave({
        ...(ticket ? { id: ticket.id } : {}),
        title: title.trim(),
        description: description.trim(),
        status: resume ? "todo" : status,
        priority,
        acceptanceCriteria: acceptance.split("\n").map(value => value.trim()).filter(Boolean),
        ...(resume ? {
          comments: [...(ticket?.comments ?? []), {
            id: `comment-${crypto.randomUUID()}`,
            author: "Human input",
            body: response,
            createdAt: new Date().toISOString()
          }]
        } : {}),
        ...(assignedRunnerId ? { assignedRunnerId } : {})
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-scrim" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <aside className="ticket-drawer" role="dialog" aria-modal="true" aria-labelledby="ticket-drawer-title">
        <header><div><span className="eyebrow">{ticket ? ticket.id : "New work"}</span><h2 id="ticket-drawer-title">{ticket ? "Ticket details" : "Create ticket"}</h2></div><button type="button" aria-label="Close ticket drawer" onClick={onClose}><X size={18} /></button></header>
        <form onSubmit={event => void submit(event)}>
          <label>Title<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs to be delivered?" /></label>
          <label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={5} placeholder="Give Donna and the runners useful context." /></label>
          <div className="form-row">
            <label>Status<select value={status} onChange={event => setStatus(event.target.value as TicketStatus)}><option value="backlog">Backlog</option><option value="todo">Todo — start automatically</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="qa">QA</option><option value="blocked">Blocked</option><option value="done">Done</option></select></label>
            <label>Priority<select value={priority} onChange={event => setPriority(event.target.value as Ticket["priority"])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
          </div>
          <label>Assign runner<select value={assignedRunnerId} onChange={event => setAssignedRunnerId(event.target.value)}><option value="">Automatic assignment</option>{runners.filter(runner => runner.role === "developer").map(runner => <option key={runner.id} value={runner.id}>{runner.id}</option>)}</select></label>
          <label>Acceptance criteria<textarea value={acceptance} onChange={event => setAcceptance(event.target.value)} rows={4} placeholder="One criterion per line" /></label>
          {needsHumanInput && (
            <div className="human-input-panel">
              <div className="human-input-panel__heading">
                <strong>Runner needs your decision</strong>
                <span>Answer one question to resume this ticket.</span>
              </div>
              <div className="human-input-panel__context">
                <span>What happened</span>
                <p>{blockerReason}</p>
              </div>
              <div className="human-input-panel__question">
                <span>Question</span>
                <strong>{blockerPrompt.question}</strong>
                <p>{blockerPrompt.guidance}</p>
              </div>
              <label>Your answer<textarea value={humanInput} onChange={event => setHumanInput(event.target.value)} rows={4} placeholder={blockerPrompt.example} required /></label>
              <small>Example: {blockerPrompt.example}</small>
              <small>Saving your response moves this ticket to Todo and resumes its persistent agent automatically.</small>
            </div>
          )}
          <div className="drawer-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={!title.trim() || saving || Boolean(needsHumanInput && !humanInput.trim())}>{saving ? "Saving…" : needsHumanInput ? "Save input & resume" : ticket ? "Save ticket" : "Create ticket"}</button></div>
        </form>
      </aside>
    </div>
  );
}
