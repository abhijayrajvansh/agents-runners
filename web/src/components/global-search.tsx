import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import type { Ticket } from "../../../src/domain/types.js";
import { RunnersApi } from "../api/client.js";

type SearchResult = { projectId: string; projectName: string; ticket: Ticket };

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    const value = query.trim();
    if (!value) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void new RunnersApi().searchTickets(value)
        .then(next => { setResults(next); setOpen(true); })
        .catch(() => { setResults([]); setOpen(true); })
        .finally(() => setLoading(false));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="global-search" ref={root}>
      <Search size={14} />
      <input
        type="search"
        value={query}
        placeholder="Search every project task…"
        aria-label="Search every project task"
        onFocus={() => query.trim() && setOpen(true)}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}
      />
      {loading && <span className="global-search__loading">Searching…</span>}
      {open && !loading && (
        <div className="global-search__results" role="listbox" aria-label="Task search results">
          {results.length === 0 && <div className="global-search__empty">No matching tasks</div>}
          {results.map(result => (
            <button
              type="button"
              role="option"
              key={`${result.projectId}:${result.ticket.id}`}
              onClick={() => window.location.assign(`/projects/${encodeURIComponent(result.projectId)}?ticket=${encodeURIComponent(result.ticket.id)}`)}
            >
              <span>{result.ticket.title}</span>
              <small>{result.projectName} · {result.ticket.status.replaceAll("_", " ")}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
