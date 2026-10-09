// Working out the real client IP behind reverse proxies, without trusting what a client can forge.
//
// A proxy APPENDS the address it received the connection from to X-Forwarded-For; it does not
// remove what the client already put there. So the leftmost entries are attacker-controlled and
// must never be used for rate limiting. With N trusted proxies, only the Nth entry from the right
// can be trusted.

export interface IpSources {
  /** The TCP peer address (the proxy, when there is one). */
  remoteAddress: string;
  headers: Record<string, string | string[] | undefined>;
  trustProxyHops: number;
  /** A header set by a trusted CDN, for example "cf-connecting-ip". */
  clientIpHeader?: string | null;
}

export interface IpResult {
  ip: string;
  source: "remote" | "x-forwarded-for" | "client-ip-header";
}

const MAX_IP_LENGTH = 64;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v : undefined;
}

/** Loose sanity check: something address-shaped, never an arbitrary string. */
function looksLikeIp(s: string): boolean {
  return s.length > 0 && s.length <= MAX_IP_LENGTH && /^[0-9a-fA-F:.%]+$/.test(s);
}

export function resolveClientIp(src: IpSources): IpResult {
  if (src.trustProxyHops > 0) {
    if (src.clientIpHeader) {
      const raw = first(src.headers[src.clientIpHeader])?.trim();
      if (raw && looksLikeIp(raw)) return { ip: raw, source: "client-ip-header" };
    }
    // Several X-Forwarded-For headers are equivalent to one comma-joined header.
    const rawHeader = src.headers["x-forwarded-for"];
    const joined = Array.isArray(rawHeader) ? rawHeader.join(",") : rawHeader;
    if (joined) {
      const parts = joined.split(",").map((p) => p.trim()).filter(Boolean);
      const entry = parts[parts.length - src.trustProxyHops];
      if (entry && looksLikeIp(entry)) return { ip: entry, source: "x-forwarded-for" };
    }
  }
  return { ip: src.remoteAddress, source: "remote" };
}
