import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { AlertCircle, PanelLeftOpen, RefreshCw, Rows3 } from "lucide-react";

import type { Ticket } from "../../src/domain/types.js";
import { Board } from "./components/board.js";
import { CommandPalette } from "./components/command-palette.js";
import { DonnaRail } from "./components/donna-rail.js";
import { RunnerInspector } from "./components/runner-inspector.js";
import { TicketDrawer } from "./components/ticket-drawer.js";
import { TopBar } from "./components/top-bar.js";
import { useProject } from "./state/use-project.js";

export function App() {
  const projectId = projectIdFromLocation();
  const state = useProject(projectId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [donnaOpen, setDonnaOpen] = useState(true);
  const [compactCards, setCompactCards] = useState(() => localStorage.getItem("codex-runners:compact-cards") !== "false");
  const shell = useRef<HTMLDivElement>(null);
  const selectedTicket = useMemo<Ticket | null>(() => (
    state.project?.board.tickets.find(ticket => ticket.id === selectedTicketId) ?? null
  ), [selectedTicketId, state.project]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(current => !current);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setDonnaOpen(current => !current);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useLayoutEffect(() => {
    if (!state.project || !shell.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.from("[data-ticket-card]", { y: 12, opacity: 0, stagger: 0.025, duration: 0.34, ease: "power2.out" });
      gsap.from(".donna-rail", { x: 14, opacity: 0, duration: 0.4, ease: "power2.out" });
      gsap.from("[data-runner-card]", { y: 8, opacity: 0, stagger: 0.03, duration: 0.3, ease: "power2.out" });
    }, shell);
    return () => context.revert();
  }, [state.project?.project.id]);

  const createTicket = () => {
    setSelectedTicketId(null);
    setDrawerOpen(true);
  };
  const openTicket = (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setDrawerOpen(true);
  };

  if (state.loading) return <LoadingScreen />;
  if (!state.project) return <ErrorScreen message={state.error ?? "This project is not registered."} onRetry={() => void state.refresh()} />;

  return (
    <div className="app-shell" ref={shell}>
      <TopBar
        projectName={state.project.project.name}
        branch={state.project.project.integrationBranch}
        onCreate={createTicket}
      />
      {state.error && <div className="error-banner"><AlertCircle size={15} />{state.error}<button type="button" onClick={() => void state.refresh()}>Retry</button></div>}
      <main className="workspace" data-donna-collapsed={!donnaOpen || undefined}>
        <section className="board-pane">
          <div className="workspace-heading">
            <div><span className="eyebrow">Autonomous delivery</span><h1>{state.project.project.name}</h1></div>
            <div className="board-summary">
              <span><strong>{state.project.board.tickets.filter(ticket => ticket.status !== "done").length}</strong> open</span>
              <span><strong>{state.project.board.tickets.filter(ticket => ticket.status === "done").length}</strong> done</span>
              <span><strong>{state.runners.filter(runner => runner.status === "working").length}</strong> active</span>
              <button
                type="button"
                className="card-density-toggle"
                aria-pressed={compactCards}
                onClick={() => setCompactCards(current => {
                  localStorage.setItem("codex-runners:compact-cards", String(!current));
                  return !current;
                })}
              >
                <Rows3 size={13} /> {compactCards ? "Compact" : "Expanded"}
              </button>
            </div>
          </div>
          <Board
            project={state.project}
            runners={state.runners}
            onMove={state.moveTicket}
            onOpenTicket={openTicket}
            compactCards={compactCards}
          />
        </section>
        {donnaOpen && (
          <DonnaRail
            projectName={state.project.project.name}
            messages={state.donnaMessages}
            onSend={state.messageDonna}
            onCollapse={() => setDonnaOpen(false)}
          />
        )}
      </main>
      {!donnaOpen && (
        <button type="button" className="donna-reopen" aria-label="Expand Donna (⌘B)" onClick={() => setDonnaOpen(true)}>
          <PanelLeftOpen size={16} /><span>Donna</span><kbd>⌘B</kbd>
        </button>
      )}
      {state.runners.length > 0 && <RunnerInspector runners={state.runners} />}
      <TicketDrawer
        open={drawerOpen}
        ticket={selectedTicket}
        runners={state.runners}
        onClose={() => setDrawerOpen(false)}
        onSave={state.saveTicket}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onCreate={createTicket}
        onOpenDonna={() => {
          setDonnaOpen(true);
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("#donna-message")?.focus());
        }}
      />
    </div>
  );
}

function projectIdFromLocation(): string {
  const match = /^\/projects\/([^/]+)/.exec(window.location.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : new URLSearchParams(window.location.search).get("projectId") ?? "";
}

function LoadingScreen() {
  return <div className="state-screen"><div className="loading-mark">CR</div><p>Preparing your runner workspace…</p></div>;
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry(): void }) {
  return <div className="state-screen state-screen--error"><AlertCircle size={24} /><h1>Codex Runners is unavailable</h1><p>{message}</p><button type="button" className="primary-button" onClick={onRetry}><RefreshCw size={15} />Try again</button></div>;
}
