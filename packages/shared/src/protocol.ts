// Socket.IO contract between the browser and the server. Types only; the server validates every
// incoming message with Zod (apps/server/src/net/schemas.ts).

import type { ClientEvent, PrivateView, PublicGameView } from "./views";

/** Client -> server event names. */
export const C2S = {
  create: "room:create",
  join: "room:join",
  resume: "room:resume",
  leave: "room:leave",
  start: "game:start",
  action: "game:action",
  playAgain: "game:playAgain",
} as const;

/** Server -> client event names. */
export const S2C = {
  roomState: "room:state",
  snapshot: "game:snapshot",
  events: "game:events",
  idle: "game:idle",
  replaced: "room:replaced",
} as const;

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

export type RoomStatus = "LOBBY" | "IN_MATCH" | "GAME_OVER";

export type ErrorCode =
  // request / session problems
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  // room problems
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_STARTED"
  | "ROOM_NOT_FULL"
  | "SERVER_FULL"
  | "INVALID_TOKEN"
  | "NOT_ADMIN"
  | "WRONG_STATE"
  // action problems
  | "BUSY"
  | "STALE_VERSION"
  // rules-engine rejections
  | "WRONG_PHASE"
  | "NOT_YOUR_TURN"
  | "INVALID_TARGET"
  | "TARGET_ELIMINATED"
  | "EMPTY_MAGAZINE"
  | "INVALID_SLOT"
  | "ITEM_UNUSABLE";

export type Ack<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; code: ErrorCode; message: string; version?: number };

/** Returned when creating, joining or resuming. `token` is secret to that player. */
export interface JoinedInfo {
  code: string;
  seat: number;
  token: string;
}

export interface RoomSeatInfo {
  seat: number;
  connected: boolean;
  isAdmin: boolean;
  /** Epoch ms when a disconnected player forfeits; null when connected. */
  graceEndsAt: number | null;
  /** The player left or ran out of grace time. */
  forfeited: boolean;
}

export interface RoomState {
  code: string;
  status: RoomStatus;
  adminSeat: number | null;
  /** The receiving player's own seat. */
  you: number;
  seats: (RoomSeatInfo | null)[];
}

/** Full state for one seat, sent on (re)connect. */
export interface GameSnapshot {
  version: number;
  /** true while the table is still "busy" playing out the last action. */
  busy: boolean;
  you: number;
  view: PublicGameView;
  private: PrivateView;
}

export interface GameEventsPayload {
  /** Room version after these events. Clients echo it back in their next action. */
  version: number;
  /** How long the server keeps the table busy for these events. */
  busyMs: number;
  events: ClientEvent[];
}

export interface GameIdlePayload {
  version: number;
}

// ---- client -> server payloads (validated by Zod on the server)

export interface JoinRequest {
  code: string;
}

export interface ResumeRequest {
  code: string;
  token: string;
}

export type ActionBody =
  | { type: "shoot"; target: number }
  | {
      type: "useItem";
      slot: number;
      args?: { target?: number; stealSlot?: number; subTarget?: number };
    };

export interface ActionRequest {
  /** Unique per action; resending the same id never applies it twice. */
  actionId: string;
  /** The room version the client last saw. */
  version: number;
  action: ActionBody;
}
