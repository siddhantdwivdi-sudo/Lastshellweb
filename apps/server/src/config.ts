import { DISCONNECT_GRACE_MS } from "@lastshell/shared";

export interface ServerConfig {
  /** Port to listen on (process.env.PORT; hosts like Render/Railway/Fly set it). */
  port: number;
  /** NODE_ENV === "production". */
  production: boolean;
  /**
   * Browser origins allowed to open a Socket.IO connection, in addition to the server's own origin
   * (a page served by this same server is always allowed). Empty = same-origin only.
   */
  allowedOrigins: string[];
  /**
   * How many reverse proxies sit in front of this server (0 = none). Used to read the real client IP
   * from X-Forwarded-For: the entry added by the Nth proxy from the END is trusted, never entries to
   * its left (those can be forged by the client).
   */
  trustProxyHops: number;
  /** Optional header that a trusted CDN sets to the real client IP (for example "cf-connecting-ip"). */
  clientIpHeader: string | null;
  /** Folder with the built frontend. null = let index.ts pick the default location. */
  webDist: string | null;
  /** Log "connection from <ip>" lines (off by default; useful once to verify proxy settings). */
  logConnections: boolean;
  /** Overrides for the room layer. */
  rooms: Partial<RoomConfig>;
}

export interface RoomConfig {
  graceMs: number;
  emptyRoomTtlMs: number;
  /** Multiplies the animation-based busy time (1 = same pacing as the Godot prototype). */
  busyScale: number;
  maxRooms: number;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  graceMs: DISCONNECT_GRACE_MS,
  emptyRoomTtlMs: 10 * 60_000,
  busyScale: 1,
  maxRooms: 500,
};

/** Local development defaults (the Vite dev server). Never used in production. */
export const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function parseHops(raw: string | undefined): number {
  if (!raw) return 0;
  const v = raw.trim().toLowerCase();
  if (v === "true") return 1;
  if (/^\d+$/.test(v)) return Math.min(Number(v), 5);
  return 0;
}

function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, "").toLowerCase();
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT ?? 3001);

  const configured = (env.CLIENT_ORIGIN ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  const origins = new Set(configured);
  // Optional single public URL, and the URL some hosts provide automatically (Render).
  for (const extra of [env.PUBLIC_ORIGIN, env.RENDER_EXTERNAL_URL]) {
    if (extra) origins.add(normalizeOrigin(extra));
  }
  // Development: allow the Vite dev server unless something was configured explicitly.
  if (!production && origins.size === 0) DEV_ORIGINS.forEach((o) => origins.add(o));

  const rawScale = env.BUSY_SCALE === undefined ? NaN : Number(env.BUSY_SCALE);
  const busyScale = Number.isFinite(rawScale) && rawScale >= 0 && rawScale <= 1 ? rawScale : undefined;

  const header = env.CLIENT_IP_HEADER?.trim().toLowerCase();

  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3001,
    production,
    allowedOrigins: [...origins],
    trustProxyHops: parseHops(env.TRUST_PROXY),
    clientIpHeader: header ? header : null,
    webDist: env.WEB_DIST?.trim() || null,
    logConnections: env.LOG_CONNECTIONS === "1",
    // Pacing can only be shortened for tests; real deployments always use the real timings.
    rooms: !production && busyScale !== undefined ? { busyScale } : {},
  };
}
