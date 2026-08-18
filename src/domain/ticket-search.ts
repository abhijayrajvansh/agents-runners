import type { Ticket } from "./types.js";

export function ticketSearchScore(query: string, projectName: string, ticket: Ticket): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return -1;
  const fields = [
    ticket.id,
    ticket.title,
    ticket.description,
    ticket.status,
    ticket.type,
    ticket.priority,
    projectName,
    ...ticket.tags,
    ...ticket.acceptanceCriteria,
    ...ticket.dependencies,
    ticket.developmentInstructions,
    ticket.qaInstructions,
    ticket.assignedRunnerId ?? "",
    ...ticket.comments.flatMap(comment => [comment.author, comment.body])
  ].map(value => value.toLowerCase());
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const tokenScores = tokens.map(token => Math.max(...fields.map(field => fuzzyTextScore(token, field))));
  if (tokenScores.some(score => score < 0)) return -1;
  const id = ticket.id.toLowerCase();
  const exactIdBoost = id === normalizedQuery ? 2_000 : id.startsWith(normalizedQuery) ? 1_000 : 0;
  const titleBoost = ticket.title.toLowerCase().includes(normalizedQuery) ? 700 : 0;
  return exactIdBoost + titleBoost + tokenScores.reduce((total, score) => total + score, 0);
}

function fuzzyTextScore(query: string, value: string): number {
  if (!value) return -1;
  if (value === query) return 600;
  const position = value.indexOf(query);
  if (position >= 0) return 400 - Math.min(position, 100);
  let cursor = 0;
  let first = -1;
  let last = -1;
  for (let index = 0; index < value.length && cursor < query.length; index += 1) {
    if (value[index] !== query[cursor]) continue;
    if (first < 0) first = index;
    last = index;
    cursor += 1;
  }
  if (cursor !== query.length) return -1;
  return 180 - Math.min((last - first + 1) - query.length, 120);
}
