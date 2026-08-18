import type { ProjectConfig, Ticket, TicketStatus } from "../../../src/domain/types.js";
import type { RunnerRecord } from "../../../src/orchestration/runner-pool.js";
import type { DonnaConversationMessage } from "../../../src/runtime/project-runtime.js";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class RunnersApi {
  async searchTickets(query: string): Promise<Array<{ projectId: string; projectName: string; ticket: Ticket }>> {
    const response = await this.#request<{ results: Array<{ projectId: string; projectName: string; ticket: Ticket }> }>(
      `/api/search/tickets?q=${encodeURIComponent(query)}`
    );
    return response.results;
  }

  async getProject(projectId: string): Promise<ProjectConfig> {
    return this.#request(`/api/projects/${encodeURIComponent(projectId)}`);
  }

  async listRunners(projectId: string): Promise<RunnerRecord[]> {
    const response = await this.#request<{ runners: RunnerRecord[] }>(`/api/projects/${encodeURIComponent(projectId)}/runners`);
    return response.runners;
  }

  async moveTicket(projectId: string, ticketId: string, status: TicketStatus, expectedRevision: number) {
    return this.updateTicket(projectId, ticketId, { status }, expectedRevision);
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

  async messageDonna(projectId: string, message: string): Promise<string> {
    const response = await this.#request<{ message: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/donna`,
      { method: "POST", body: JSON.stringify({ message, source: "browser" }) }
    );
    return response.message;
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
