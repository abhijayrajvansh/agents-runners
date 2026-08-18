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

type HooksDocument = {
  description?: string;
  hooks: Record<string, HookGroup[]>;
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
  nodePath: string
): HooksDocument {
  const base = isHooksDocument(input) ? structuredClone(input) : { hooks: {} };
  const sessionStart = base.hooks.SessionStart ?? [];
  const retained = sessionStart.filter(group => !group.hooks.some(hook => (
    hook.command.includes("hook session-start") &&
    (hook.command.includes("codex-runners") || hook.command.includes("cli.mjs"))
  )));
  const command = `${shellQuote(nodePath)} ${shellQuote(cliPath)} hook session-start`;
  retained.push({
    matcher: "startup|resume",
    hooks: [{
      type: "command",
      command,
      timeout: 10,
      statusMessage: "Starting Codex Runners"
    }]
  });
  base.hooks.SessionStart = retained;
  return base;
}

function isHooksDocument(value: unknown): value is HooksDocument {
  return typeof value === "object" && value !== null && "hooks" in value &&
    typeof (value as { hooks?: unknown }).hooks === "object" && (value as { hooks?: unknown }).hooks !== null;
}
