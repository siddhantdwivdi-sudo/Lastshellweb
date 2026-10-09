// Test helpers (not used by the app): a scripted fake socket and builders for server payloads.

import type {
  ClientEvent,
  GameEventsPayload,
  GameSnapshot,
  PrivateView,
  PublicGameView,
  PublicPlayer,
  RoomState,
} from "@lastshell/shared";
import type { SocketLike } from "./gameClient";

type Handler = (...args: any[]) => void;
type AckFn = (res: unknown) => void;

export class FakeSocket implements SocketLike {
  connected = false;
  private handlers = new Map<string, Handler[]>();
  /** Every emit the client made: event, payload, ack callback. */
  sent: { event: string; payload: unknown; ack: AckFn | null }[] = [];
  /** Optional auto-reply per event; return undefined to leave the request unanswered. */
  replies = new Map<string, (payload: unknown) => unknown>();

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: any[]): this {
    const ack = typeof args[args.length - 1] === "function" ? (args.pop() as AckFn) : null;
    const payload = args[0];
    this.sent.push({ event, payload, ack });
    const reply = this.replies.get(event);
    if (reply && ack) {
      const r = reply(payload);
      if (r !== undefined) ack(r);
    }
    return this;
  }

  connect(): this {
    if (!this.connected) {
      this.connected = true;
      this.fire("connect");
    }
    return this;
  }

  disconnect(): this {
    if (this.connected) {
      this.connected = false;
      this.fire("disconnect", "io client disconnect");
    }
    return this;
  }

  /** Server pushes something to the client. */
  push(event: string, payload?: unknown): void {
    this.fire(event, payload);
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }

  count(event: string): number {
    return this.sent.filter((s) => s.event === event).length;
  }

  last(event: string) {
    return [...this.sent].reverse().find((s) => s.event === event);
  }
}

export function player(seat: number, over: Partial<PublicPlayer> = {}): PublicPlayer {
  return { seat, hp: 3, alive: true, slots: 4, items: [], sawed: false, cuffed: false, ...over };
}

export function view(over: Partial<PublicGameView> = {}): PublicGameView {
  return {
    phase: "AWAITING",
    current: 0,
    loadNumber: 1,
    fired: 0,
    magazine: { total: 6, live: 3, blank: 3 },
    players: [player(0), player(1), player(2)],
    winner: null,
    ...over,
  };
}

export function priv(over: Partial<PrivateView> = {}): PrivateView {
  return { knownShells: [], legal: null, ...over };
}

export function room(over: Partial<RoomState> = {}): RoomState {
  return {
    code: "ABCDE",
    status: "IN_MATCH",
    adminSeat: 0,
    you: 0,
    seats: [0, 1, 2].map((seat) => ({ seat, connected: true, isAdmin: seat === (over.adminSeat ?? 0), graceEndsAt: null, forfeited: false })),
    ...over,
  };
}

type EventBody = { [K in ClientEvent["type"]]: Omit<Extract<ClientEvent, { type: K }>, "view" | "private"> }[ClientEvent["type"]];

export function ev(body: EventBody, v: PublicGameView = view(), p: PrivateView = priv()): ClientEvent {
  return { ...body, view: v, private: p } as ClientEvent;
}

export function batch(version: number, busyMs: number, events: ClientEvent[]): GameEventsPayload {
  return { version, busyMs, events };
}

export function snapshot(over: Partial<GameSnapshot> = {}): GameSnapshot {
  return { version: 1, busy: false, you: 0, view: view(), private: priv(), ...over };
}
