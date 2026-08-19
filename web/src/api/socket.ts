import type { ProjectEvent } from "../../../src/server/event-bus.js";

export function reconnectDelay(attempt: number): number {
  return Math.min(250 * 2 ** Math.max(attempt, 0), 5_000);
}

export function connectProjectSocket(
  projectId: string,
  since: number,
  onEvent: (event: ProjectEvent) => void,
  onState: (connected: boolean) => void
): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let lastSequence = since;
  let closed = false;

  const scheduleReconnect = () => {
    if (closed || retryTimer) return;
    onState(false);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, reconnectDelay(attempt++));
  };

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(
      `${protocol}//${window.location.host}/ws?projectId=${encodeURIComponent(projectId)}&since=${lastSequence}`
    );
    socket.addEventListener("open", () => {
      attempt = 0;
      onState(true);
    });
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => onState(false));
    socket.addEventListener("message", event => {
      try {
        const parsed = JSON.parse(String(event.data)) as ProjectEvent;
        lastSequence = Math.max(lastSequence, parsed.sequence);
        onEvent(parsed);
      } catch {
        // Ignore malformed local events and let the next refresh repair state.
      }
    });
  };

  connect();
  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    socket?.close();
  };
}
