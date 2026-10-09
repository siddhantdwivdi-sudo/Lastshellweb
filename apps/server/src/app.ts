import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import express from "express";
import { Server as IoServer } from "socket.io";
import { DEV_ORIGINS, type RoomConfig, type ServerConfig } from "./config";
import type { Rng } from "./engine";
import { isOriginAllowed } from "./net/origin";
import { attachSocketHandlers } from "./net/socket";
import { RoomManager } from "./rooms/manager";

export interface GameServerOptions extends Partial<Omit<ServerConfig, "rooms">> {
  rooms?: Partial<RoomConfig>;
  rng?: Rng;
  codeGenerator?: () => string;
}

export interface GameServer {
  httpServer: HttpServer;
  io: IoServer;
  manager: RoomManager;
  /** true when the built frontend is being served from this server. */
  servingWeb: boolean;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

/** Content-Security-Policy: only our own scripts/styles/fonts; sockets only to ourselves and listed origins. */
export function buildCsp(allowedOrigins: readonly string[]): string {
  const connect = new Set<string>(["'self'"]);
  for (const o of allowedOrigins) {
    if (o === "*") continue;
    try {
      const u = new URL(o);
      connect.add(u.origin);
      connect.add(`${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`);
    } catch {
      /* ignore malformed entries */
    }
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React sets inline style attributes
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${[...connect].join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const allowedOrigins = options.allowedOrigins ?? DEV_ORIGINS;
  const hops = options.trustProxyHops ?? 0;
  const webDist = options.webDist ?? null;
  const indexFile = webDist ? path.join(webDist, "index.html") : null;
  const servingWeb = indexFile !== null && existsSync(indexFile);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", hops); // so req.secure follows X-Forwarded-Proto behind a proxy

  const csp = buildCsp(allowedOrigins);
  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000");
    next();
  });

  // Liveness probe only: it must never expose room or player information.
  app.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
  });

  if (servingWeb && webDist && indexFile) {
    // Built files have content hashes in their names, so they can be cached "forever".
    app.use("/assets", express.static(path.join(webDist, "assets"), { index: false, maxAge: "1y", immutable: true }));
    app.use(express.static(webDist, { index: false, maxAge: 0, setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));
    // Any other page address (a refresh on /anything) gets the app, which decides what to show.
    // Missing files (anything with an extension) are real 404s, never an HTML page.
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/socket.io/") || path.extname(req.path) !== "") return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexFile);
    });
  }

  const httpServer = createServer(app);
  const io = new IoServer(httpServer, {
    // CORS headers matter for the cross-origin development setup (Vite on :5173, server on :3001).
    cors: { origin: allowedOrigins.includes("*") ? true : [...allowedOrigins], methods: ["GET", "POST"] },
    // Browsers don't apply CORS to WebSockets, so check the Origin ourselves for every connection.
    allowRequest: (req, callback) => {
      const header = (name: string) => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      callback(
        null,
        isOriginAllowed({
          origin: header("origin"),
          host: header("host"),
          forwardedHost: hops > 0 ? header("x-forwarded-host") : undefined,
          allowedOrigins,
        }),
      );
    },
    maxHttpBufferSize: 10_000, // our messages are tiny; refuse anything big
    serveClient: false,
    connectionStateRecovery: undefined,
  });
  const manager = new RoomManager({
    rng: options.rng,
    config: options.rooms,
    codeGenerator: options.codeGenerator,
  });
  attachSocketHandlers(io, manager, {
    trustProxyHops: hops,
    clientIpHeader: options.clientIpHeader ?? null,
    logConnections: options.logConnections ?? false,
  });

  return {
    httpServer,
    io,
    manager,
    servingWeb,
    listen(port = options.port ?? 3001) {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => resolve((httpServer.address() as AddressInfo).port));
      });
    },
    async close() {
      manager.shutdown();
      await io.close();
      if (httpServer.listening) await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}
