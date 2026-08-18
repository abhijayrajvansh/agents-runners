export function readableBlockerReason(value: string | undefined, fallback = "A runner needs guidance before work can continue."): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  for (const candidate of [raw, fenced].filter((item): item is string => Boolean(item))) {
    try {
      const parsed = JSON.parse(candidate) as { summary?: unknown; message?: unknown };
      const summary = typeof parsed.summary === "string" ? parsed.summary : typeof parsed.message === "string" ? parsed.message : undefined;
      if (summary) return shorten(summary);
    } catch {
      // Older runner findings may be plain text rather than structured JSON.
    }
  }
  return shorten(raw);
}

function shorten(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 240) return text;
  return `${text.slice(0, 239).replace(/\s+\S*$/, "")}…`;
}
