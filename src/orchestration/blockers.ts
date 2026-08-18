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

export type HumanBlockerPrompt = {
  question: string;
  guidance: string;
  example: string;
};

export function humanBlockerPrompt(title: string, reason: string): HumanBlockerPrompt {
  const normalized = reason.toLowerCase();
  const commit = /\b[0-9a-f]{7,40}\b/i.exec(reason)?.[0];

  if (/approved|completed|satisfies the ticket|verification passed/.test(normalized)) {
    return {
      question: "Should this completed work continue to the next stage?",
      guidance: "Confirm that the runner may continue, or describe what must change first.",
      example: commit
        ? `Continue with commit ${commit} and move this ticket to the next stage.`
        : "Continue with the completed work and move this ticket to the next stage."
    };
  }
  if (/merge conflict|conflict/.test(normalized)) {
    return {
      question: "How should the runner resolve this conflict?",
      guidance: "Say which version or behavior to keep, and mention any files that must not change.",
      example: "Keep the changes from the developer branch, preserve the current configuration, and continue."
    };
  }
  if (/missing|unavailable|not found|credential|token|api key|environment/.test(normalized)) {
    return {
      question: "What missing information should the runner use?",
      guidance: "Provide the missing development value or tell the runner how to proceed without it. Do not paste production secrets.",
      example: "Use the development environment value already available in .env.local and retry."
    };
  }
  return {
    question: `What should the runner do next for “${title}”?`,
    guidance: "Give one clear decision: continue, retry, or change direction. Include any missing detail the runner needs.",
    example: "Retry the current step using the existing implementation, then continue to review."
  };
}

function shorten(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 240) return text;
  return `${text.slice(0, 239).replace(/\s+\S*$/, "")}…`;
}
