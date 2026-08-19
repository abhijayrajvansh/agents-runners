import type { ProjectConfig, RoleName, Ticket, TicketStatus } from "../../../src/domain/types.js";
import { ticketSearchScore } from "../../../src/domain/ticket-search.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { AgentTerminalSnapshot } from "../../../src/orchestration/automation-manager.js";
import type { DonnaConversationMessage, TicketDeliveryState } from "../../../src/runtime/project-runtime.js";
import type { CodexModelOption } from "../../../src/runners/codex-models.js";
import type { DonnaEvent } from "../../../src/donna/donna-service.js";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class RunnersApi {
  async listModels(): Promise<CodexModelOption[]> {
    const response = await this.#request<{ models: CodexModelOption[] }>("/api/models");
    return response.models;
  }

  async searchTickets(query: string): Promise<Array<{ projectId: string; projectName: string; ticket: Ticket }>> {
    const response = await this.#request<{ projects: ProjectConfig["project"][] }>("/api/projects");
    const projects = await Promise.all(response.projects.map(project => this.getProject(project.id)));
    return projects.flatMap(project => project.board.tickets.map(ticket => ({
      projectId: project.project.id,
      projectName: project.project.name,
      ticket,
      score: ticketSearchScore(query, project.project.name, ticket)
    })))
      .filter(result => result.score >= 0)
      .sort((left, right) => right.score - left.score || right.ticket.updatedAt.localeCompare(left.ticket.updatedAt))
      .slice(0, 50)
      .map(({ projectId, projectName, ticket }) => ({ projectId, projectName, ticket }));
  }

  async getProject(projectId: string): Promise<ProjectConfig> {
    return this.#request(`/api/projects/${encodeURIComponent(projectId)}`);
  }

  async listRunners(projectId: string): Promise<RunnerRecord[]> {
    const response = await this.#request<{ runners: RunnerRecord[] }>(`/api/projects/${encodeURIComponent(projectId)}/runners`);
    return response.runners;
  }

  async listDeliveries(projectId: string): Promise<Record<string, TicketDeliveryState>> {
    const response = await this.#request<{ deliveries: Record<string, TicketDeliveryState> }>(
      `/api/projects/${encodeURIComponent(projectId)}/deliveries`
    );
    return response.deliveries;
  }

  async mergeTicket(projectId: string, ticketId: string): Promise<TicketDeliveryState> {
    const response = await this.#request<{ delivery: TicketDeliveryState }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/merge`,
      { method: "POST" }
    );
    return response.delivery;
  }

  async listTerminals(projectId: string): Promise<AgentTerminalSnapshot[]> {
    const response = await this.#request<{ terminals: AgentTerminalSnapshot[] }>(`/api/projects/${encodeURIComponent(projectId)}/terminals`);
    return response.terminals;
  }

  async moveTicket(projectId: string, ticketId: string, status: TicketStatus, expectedRevision: number) {
    return this.updateTicket(projectId, ticketId, { status }, expectedRevision);
  }

  async updatePoolMaximum(projectId: string, role: RoleName, maximum: number, expectedRevision: number) {
    return this.#request<{ revision: number; role: RoleName; maximum: number }>(
      `/api/projects/${encodeURIComponent(projectId)}/pools/${encodeURIComponent(role)}`,
      { method: "PATCH", body: JSON.stringify({ maximum, expectedRevision }) }
    );
  }

  async updateDonnaModel(projectId: string, model: string, expectedRevision: number) {
    return this.#request<{ revision: number; model: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/donna/model`,
      { method: "PATCH", body: JSON.stringify({ model, expectedRevision }) }
    );
  }

  async updateTicket(projectId: string, ticketId: string, patch: Partial<Ticket>, expectedRevision: number) {
    return this.#request<{ revision: number; ticket: Ticket }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}`,
      { method: "PATCH", body: JSON.stringify({ patch, expectedRevision }) }
    );
  }

  async createTicket(projectId: string, ticket: Partial<Ticket>, expectedRevision: number) {
    return this.#request<{ revision: number; ticket: Ticket }>(
      `/api/projects/${encodeURIComponent(projectId)}/tickets`,
      { method: "POST", body: JSON.stringify({ ticket, expectedRevision }) }
    );
  }

  async messageDonna(projectId: string, message: string, onEvent?: (event: DonnaEvent) => void): Promise<string> {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/donna`, {
      method: "POST",
      headers: { "accept": "application/x-ndjson", "content-type": "application/json" },
      body: JSON.stringify({ message, source: "browser" })
    });
    if (!response.ok) {
      const body = await response.json() as { error?: { message?: string } };
      throw new ApiError(response.status, body.error?.message ?? `Request failed with ${response.status}`);
    }
    if (!response.body) throw new ApiError(502, "Donna returned an empty response stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as DonnaEvent;
      onEvent?.(event);
      if (event.type === "completed") reply = event.message;
      if (event.type === "error") throw new ApiError(502, event.message);
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
    return reply;
  }

  async getDonnaMessages(projectId: string): Promise<DonnaConversationMessage[]> {
    const response = await this.#request<{ messages: DonnaConversationMessage[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/donna`
    );
    return response.messages;
  }

  async #request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers }
    });
    const body = await response.json() as T & { error?: { message?: string } };
    if (!response.ok) throw new ApiError(response.status, body.error?.message ?? `Request failed with ${response.status}`);
    return body;
  }
}
