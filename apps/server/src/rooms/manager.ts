// Owns all rooms and the "session": which connection belongs to which room. A seat is always
// derived from this binding (and the room's own record of who sits where), never from a message.

import type { ActionRequest, JoinedInfo } from "@lastshell/shared";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "../config";
import { createCryptoRng, type Rng } from "../engine";
import { generateRoomCode } from "./ids";
import { RateLimiter } from "./limiter";
import { Room } from "./room";
import { fail, type Peer, type Result } from "./types";

export interface ManagerOptions {
  rng?: Rng;
  config?: Partial<RoomConfig>;
  /** Override room-code generation (tests only). */
  codeGenerator?: () => string;
}

export class RoomManager {
  readonly config: RoomConfig;
  private readonly rng: Rng;
  private readonly codeGenerator: () => string;
  private readonly rooms = new Map<string, Room>();
  /** peer id -> room code */
  private readonly bindings = new Map<string, string>();

  private readonly createLimiter = new RateLimiter(5, 60_000); // new rooms per IP per minute
  private readonly failedJoinLimiter = new RateLimiter(10, 60_000); // wrong codes/tokens per IP
  private readonly messageLimiter = new RateLimiter(40, 5_000); // messages per connection

  constructor(options: ManagerOptions = {}) {
    this.config = { ...DEFAULT_ROOM_CONFIG, ...options.config };
    this.rng = options.rng ?? createCryptoRng();
    this.codeGenerator = options.codeGenerator ?? generateRoomCode;
  }

  // ---------------------------------------------------------------- queries

  roomCount(): number {
    return this.rooms.size;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  roomOf(peer: Peer): Room | undefined {
    const code = this.bindings.get(peer.id);
    return code ? this.rooms.get(code) : undefined;
  }

  /** False when this connection is flooding the server. */
  allowMessage(peer: Peer): boolean {
    return this.messageLimiter.hit(peer.id);
  }

  // ---------------------------------------------------------------- membership

  createRoom(peer: Peer): Result<JoinedInfo> {
    if (this.bindings.has(peer.id)) return fail("ALREADY_IN_ROOM", "Leave your current room first.");
    if (!this.createLimiter.hit(peer.ip)) return fail("RATE_LIMITED", "Too many rooms created. Try again later.");
    if (this.rooms.size >= this.config.maxRooms) return fail("SERVER_FULL", "The server is full. Try again later.");

    let code = "";
    for (let i = 0; i < 20; i++) {
      const candidate = this.codeGenerator();
      if (!this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (code === "") return fail("INTERNAL", "Could not create a room.");

    const room = new Room(code, this.rng, this.config, {
      onDestroy: (r) => this.rooms.delete(r.code),
      onUnbind: (peerId) => this.bindings.delete(peerId),
    });
    this.rooms.set(code, room);
    const res = room.addPlayer(peer);
    if (res.ok) this.bindings.set(peer.id, code);
    else room.destroy();
    return res;
  }

  joinRoom(peer: Peer, code: string): Result<JoinedInfo> {
    if (this.bindings.has(peer.id)) return fail("ALREADY_IN_ROOM", "Leave your current room first.");
    if (this.failedJoinLimiter.isBlocked(peer.ip)) return fail("RATE_LIMITED", "Too many attempts. Try again later.");
    const room = this.rooms.get(code);
    if (!room) {
      this.failedJoinLimiter.hit(peer.ip);
      return fail("ROOM_NOT_FOUND", "No room with that code.");
    }
    const res = room.addPlayer(peer);
    if (res.ok) this.bindings.set(peer.id, code);
    return res;
  }

  resumeRoom(peer: Peer, code: string, token: string): Result<JoinedInfo> {
    if (this.bindings.has(peer.id)) return fail("ALREADY_IN_ROOM", "Leave your current room first.");
    if (this.failedJoinLimiter.isBlocked(peer.ip)) return fail("RATE_LIMITED", "Too many attempts. Try again later.");
    const room = this.rooms.get(code);
    if (!room) {
      this.failedJoinLimiter.hit(peer.ip);
      return fail("ROOM_NOT_FOUND", "That room no longer exists.");
    }
    const res = room.resume(peer, token);
    if (res.ok) this.bindings.set(peer.id, code);
    else this.failedJoinLimiter.hit(peer.ip);
    return res;
  }

  leave(peer: Peer): Result {
    const room = this.roomOf(peer);
    if (!room) return fail("NOT_IN_ROOM", "You are not in a room.");
    this.bindings.delete(peer.id);
    room.removePeer(peer, "leave");
    return { ok: true };
  }

  /** Transport-level disconnect. Safe to call for peers that are not in any room. */
  onDisconnect(peer: Peer): void {
    const room = this.roomOf(peer);
    this.bindings.delete(peer.id);
    this.messageLimiter.reset(peer.id);
    room?.removePeer(peer, "disconnect");
  }

  // ---------------------------------------------------------------- gameplay

  startMatch(peer: Peer): Result {
    const room = this.roomOf(peer);
    return room ? room.start(peer) : fail("NOT_IN_ROOM", "You are not in a room.");
  }

  playAgain(peer: Peer): Result {
    const room = this.roomOf(peer);
    return room ? room.playAgain(peer) : fail("NOT_IN_ROOM", "You are not in a room.");
  }

  action(peer: Peer, request: ActionRequest) {
    const room = this.roomOf(peer);
    return room ? room.handleAction(peer, request) : fail("NOT_IN_ROOM", "You are not in a room.");
  }

  /** Stops every timer (server shutdown / tests). */
  shutdown(): void {
    for (const room of [...this.rooms.values()]) room.destroy();
    this.bindings.clear();
  }
}
