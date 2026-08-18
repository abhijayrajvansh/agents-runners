const assignmentPattern = /\b(OPENAI_API_KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PASSWD)(\s*[:=]\s*)([^\s"']+)/gi;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export class Redactor {
  readonly secrets: string[];

  constructor(secrets: string[]) {
    this.secrets = [...new Set(secrets.filter(secret => secret.length >= 4))]
      .sort((left, right) => right.length - left.length);
  }

  redact<T>(value: T): T {
    return redactValue(value, this.secrets) as T;
  }
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map(entry => redactValue(entry, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactValue(entry, secrets)]));
  }
  return value;
}

function redactString(value: string, secrets: string[]): string {
  let output = value;
  for (const secret of secrets) output = output.split(secret).join("[REDACTED]");
  output = output.replace(assignmentPattern, (_match, key: string, delimiter: string) => `${key}${delimiter}[REDACTED]`);
  return output.replace(bearerPattern, "Bearer [REDACTED]");
}
