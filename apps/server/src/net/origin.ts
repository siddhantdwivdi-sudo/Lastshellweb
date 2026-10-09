// Browsers do NOT apply CORS to WebSocket connections, so the server has to check the Origin header
// itself: otherwise any website could open a socket to this server from a visitor's browser.
// (Players are identified by a secret token in messages, not cookies, which limits the damage,
// but there is no reason to accept foreign pages at all.)

export interface OriginCheckInput {
  origin: string | undefined;
  /** The Host header of the request. */
  host: string | undefined;
  /** X-Forwarded-Host (only consulted when a trusted proxy is configured). */
  forwardedHost?: string | undefined;
  allowedOrigins: readonly string[];
}

function normalize(o: string): string {
  return o.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * - No Origin header: not a browser page (curl, tests, native clients) -> allowed.
 * - "*" in the allow-list: everything allowed (local testing only).
 * - Listed origin, or an origin whose host is the host the request was addressed to
 *   (a page served by this very server) -> allowed.
 * - Anything else -> refused.
 */
export function isOriginAllowed(input: OriginCheckInput): boolean {
  const { origin, host, forwardedHost, allowedOrigins } = input;
  if (allowedOrigins.includes("*")) return true;
  if (origin === undefined || origin === "") return true;
  if (origin === "null") return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const normalized = normalize(`${parsed.protocol}//${parsed.host}`);
  if (allowedOrigins.some((o) => normalize(o) === normalized)) return true;

  const hosts = [host, forwardedHost?.split(",")[0]]
    .filter((h): h is string => typeof h === "string" && h !== "")
    .map((h) => h.trim().toLowerCase());
  return hosts.includes(parsed.host.toLowerCase());
}
