type CommandHook = {
  type: string;
  command: string;
  timeout?: number;
  statusMessage?: string;
};

type HookGroup = {
  matcher?: string;
  hooks: CommandHook[];
};

// Codex keeps hooks in `.codex/hooks.json` and Claude Code keeps them among
// everything else in `.claude/settings.json`. The hooks block is shaped the
// same in both, so one merge serves both as long as it preserves the keys it
// does not own.
type HooksDocument = {
  hooks: Record<string, HookGroup[]>;
  [key: string]: unknown;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function replaceManagedBlock(source: string, name: string, contents: string): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const block = `${start}\n${contents.trim()}\n${end}`;
  const expression = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");

  if (expression.test(source)) return source.replace(expression, block);
  const prefix = source.trimEnd();
  return `${prefix}${prefix ? "\n\n" : ""}${block}\n`;
}

export function appendUniqueLines(source: string, lines: string[]): string {
  const existing = new Set(source.split(/\r?\n/));
  const missing = lines.filter(line => !existing.has(line));
  if (missing.length === 0) return source;
  const prefix = source.trimEnd();
  return `${prefix}${prefix ? "\n" : ""}${missing.join("\n")}\n`;
}

export function mergeSessionStartHook(
  input: unknown,
  cliPath: string,
  nodePath: string,
  agent: "codex" | "claude" = "codex"
): HooksDocument {
  const base: HooksDocument = isRecord(input)
    ? { ...structuredClone(input), hooks: isRecord(input.hooks) ? structuredClone(input.hooks) as Record<string, HookGroup[]> : {} }
    : { hooks: {} };
  const sessionStart = base.hooks.SessionStart ?? [];
  const retained = sessionStart.filter(group => !group.hooks.some(hook => (
    hook.command.includes("hook session-start") &&
    (hook.command.includes("agents-runners") || hook.command.includes("cli.mjs"))
  )));
  const command = `${shellQuote(nodePath)} ${shellQuote(cliPath)} hook session-start --agent ${agent}`;
  retained.push({
    matcher: "startup|resume",
    hooks: [{
      type: "command",
      command,
      timeout: 10,
      statusMessage: "Starting Agents Runners"
    }]
  });
  base.hooks.SessionStart = retained;
  return base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
