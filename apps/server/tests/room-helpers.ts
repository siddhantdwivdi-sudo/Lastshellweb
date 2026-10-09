import { S2C, type ActionBody, type JoinedInfo } from "@lastshell/shared";
import type { RoomConfig } from "../src/config";
import { createSeededRng } from "../src/engine";
import { RoomManager } from "../src/rooms/manager";
import type { Room } from "../src/rooms/room";
import type { Peer } from "../src/rooms/types";

/** A fake connection that records everything the server sends it (as if over the wire). */
export class FakePeer implements Peer {
  sent: { event: string; payload: any }[] = [];
  disconnected = false;
  info: JoinedInfo | null = null;

  constructor(
    readonly id: string,
    readonly ip = `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
  ) {}

  send(event: string, payload: unknown): void {
    this.sent.push({ event, payload: structuredClone(payload) });
  }

  disconnect(): void {
    this.disconnected = true;
  }

  all(event: string): any[] {
    return this.sent.filter((m) => m.event === event).map((m) => m.payload);
  }

  last(event: string): any {
    const list = this.all(event);
    return list[list.length - 1];
  }

  count(event: string): number {
    return this.all(event).length;
  }

  get seat(): number {
    if (!this.info) throw new Error("peer has not joined");
    return this.info.seat;
  }
}

let counter = 0;
export function newPeer(ip?: string): FakePeer {
  counter += 1;
  return new FakePeer(`peer-${counter}`, ip);
}

export function newManager(config: Partial<RoomConfig> = {}, seed = 1): RoomManager {
  return new RoomManager({ rng: createSeededRng(seed), config: { busyScale: 0, ...config } });
}

export interface Lobby {
  manager: RoomManager;
  room: Room;
  code: string;
  peers: FakePeer[];
}

/** A room with three connected players, still in the lobby. Each peer has its own IP. */
export function makeLobby(manager = newManager()): Lobby {
  const peers = [newPeer("1.0.0.1"), newPeer("1.0.0.2"), newPeer("1.0.0.3")];
  const created = manager.createRoom(peers[0]);
  if (!created.ok) throw new Error(created.message);
  peers[0].info = created;
  for (const p of peers.slice(1)) {
    const joined = manager.joinRoom(p, created.code);
    if (!joined.ok) throw new Error(joined.message);
    p.info = joined;
  }
  return { manager, room: manager.getRoom(created.code)!, code: created.code, peers };
}

/** A lobby whose admin has pressed START. */
export function makeMatch(manager = newManager()): Lobby {
  const lobby = makeLobby(manager);
  const res = manager.startMatch(lobby.peers[0]);
  if (!res.ok) throw new Error(res.message);
  return lobby;
}

let actionCounter = 0;
export function nextActionId(): string {
  actionCounter += 1;
  return `act-${actionCounter.toString().padStart(8, "0")}`;
}

/** Sends an action carrying the room's current version, like a well-behaved client. */
export function send(lobby: Lobby, peer: FakePeer, action: ActionBody, overrides: { version?: number; actionId?: string } = {}) {
  return lobby.manager.action(peer, {
    actionId: overrides.actionId ?? nextActionId(),
    version: overrides.version ?? lobby.room.version,
    action,
  });
}

export const EVENT_NAMES = S2C;

/** Every key that must never appear in anything sent to a browser. */
export const FORBIDDEN_KEYS = ["shells", "observations", "after", "publicText", "privateText", "tokenHash", "token"];

export function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}
