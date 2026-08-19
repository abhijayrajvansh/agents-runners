import type { IncomingMessage } from "node:http";

export const PUBLIC_ACCESS_COOKIE = "agents_runners_access";

export function isPublicRequest(request: IncomingMessage): boolean {
  const forwardedHost = headerValue(request.headers["x-forwarded-host"]);
  const host = (forwardedHost ?? request.headers.host ?? "").split(":", 1)[0]?.toLowerCase();
  return host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]";
}

export function hasPublicAccess(request: IncomingMessage, token: string): boolean {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.searchParams.get("access") === token) return true;
  return parseCookies(request.headers.cookie)[PUBLIC_ACCESS_COOKIE] === token;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(";").map(part => {
    const [key = "", ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}
