// Connects Socket.IO to the RoomManager. This layer only: rate-limits, validates with Zod,
// calls the manager and replies through the ack callback. It contains no game logic.

import { C2S, type Ack } from "@lastshell/shared";
import type { Server, Socket } from "socket.io";
import type { ZodType } from "zod";
import type { RoomManager } from "../rooms/manager";
import { fail, type Peer } from "../rooms/types";
import { resolveClientIp } from "./clientIp";
import { actionSchema, emptySchema, joinSchema, resumeSchema } from "./schemas";

const MAX_SOCKETS_PER_IP = 20;

export interface SocketOptions {
  /** Reverse proxies in front of the server (0 = none). See net/clientIp.ts. */
  trustProxyHops?: number;
  clientIpHeader?: string | null;
  /** Log "connection from <ip>" (off by default; handy once to verify the proxy settings). */
  logConnections?: boolean;
}

function clientIp(socket: Socket, opts: SocketOptions) {
  return resolveClientIp({
    remoteAddress: socket.handshake.address,
    headers: socket.handshake.headers,
    trustProxyHops: opts.trustProxyHops ?? 0,
    clientIpHeader: opts.clientIpHeader,
  });
}

export function attachSocketHandlers(io: Server, manager: RoomManager, opts: SocketOptions = {}): void {
  const perIp = new Map<string, number>();

  io.on("connection", (socket) => {
    const { ip, source } = clientIp(socket, opts);
    if (opts.logConnections) console.log(`connection from ${ip} (via ${source})`);
    const count = (perIp.get(ip) ?? 0) + 1;
    perIp.set(ip, count);
    if (count > MAX_SOCKETS_PER_IP) {
      socket.disconnect(true);
      perIp.set(ip, count - 1);
      return;
    }

    const peer: Peer = {
      id: socket.id,
      ip,
      send: (event, payload) => socket.emit(event, payload),
      disconnect: () => socket.disconnect(true),
    };

    function on<T>(
      name: string,
      schema: ZodType<T>,
      handler: (payload: T) => Ack<object>,
    ): void {
      socket.on(name, (...args: unknown[]) => {
        const last = args[args.length - 1];
        const ack = typeof last === "function" ? (args.pop() as (r: unknown) => void) : () => {};
        const respond = (r: Ack<object>) => {
          try {
            ack(r);
          } catch {
            /* client went away */
          }
        };
        if (!manager.allowMessage(peer)) {
          respond(fail("RATE_LIMITED", "Slow down."));
          return;
        }
        const parsed = schema.safeParse(args[0]);
        if (!parsed.success) {
          respond(fail("BAD_REQUEST", "Invalid request."));
          return;
        }
        try {
          respond(handler(parsed.data));
        } catch (err) {
          // Never log the request itself (it may hold a player token) or the whole error object.
          console.error(`handler ${name} failed: ${err instanceof Error ? err.name : "unknown error"}`);
          respond(fail("INTERNAL", "Something went wrong."));
        }
      });
    }

    on(C2S.create, emptySchema, () => manager.createRoom(peer));
    on(C2S.join, joinSchema, (p) => manager.joinRoom(peer, p.code));
    on(C2S.resume, resumeSchema, (p) => manager.resumeRoom(peer, p.code, p.token));
    on(C2S.leave, emptySchema, () => manager.leave(peer));
    on(C2S.start, emptySchema, () => manager.startMatch(peer));
    on(C2S.playAgain, emptySchema, () => manager.playAgain(peer));
    on(C2S.action, actionSchema, (p) => manager.action(peer, p));

    socket.on("disconnect", () => {
      perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
      manager.onDisconnect(peer);
    });
  });
}
