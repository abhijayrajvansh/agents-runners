import type { ProjectEvent } from "../../../src/server/event-bus.js";

export function connectProjectSocket(
  projectId: string,
  since: number,
  onEvent: (event: ProjectEvent) => void,
  onState: (connected: boolean) => void
): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/ws?projectId=${encodeURIComponent(projectId)}&since=${since}`
  );
  socket.addEventListener("open", () => onState(true));
  socket.addEventListener("close", () => onState(false));
  socket.addEventListener("error", () => onState(false));
  socket.addEventListener("message", event => {
    try {
      onEvent(JSON.parse(String(event.data)) as ProjectEvent);
    } catch {
      // Ignore malformed local events and let the next revision refresh state.
    }
  });
  return () => socket.close();
}
