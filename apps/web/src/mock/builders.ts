// Small helpers for building typed mock data. Pure data: no rules.

import type {
  ItemId,
  KnownShell,
  PublicGameView,
  PublicPlayer,
  RoomSeatInfo,
  RoomState,
  RoomStatus,
} from "@lastshell/shared";

let counter = 0;
export function uid(): number {
  counter += 1;
  return counter;
}

export function mkPlayer(seat: number, over: Partial<PublicPlayer> = {}): PublicPlayer {
  return { seat, hp: 3, alive: true, slots: 4, items: [], sawed: false, cuffed: false, ...over };
}

export function mkView(players: PublicPlayer[], over: Partial<PublicGameView> = {}): PublicGameView {
  return {
    phase: "AWAITING",
    current: 0,
    loadNumber: 1,
    fired: 0,
    magazine: { total: 6, live: 3, blank: 3 },
    players,
    winner: null,
    ...over,
  };
}

export function mkSeat(seat: number, over: Partial<RoomSeatInfo> = {}): RoomSeatInfo {
  return { seat, connected: true, isAdmin: false, graceEndsAt: null, forfeited: false, ...over };
}

export function mkRoom(opts: {
  code?: string;
  you: number;
  /** Seat of the admin. */
  admin: number;
  status?: RoomStatus;
  /** Which seats are occupied (default: all three). */
  occupied?: number[];
  disconnected?: { seat: number; graceMs?: number }[];
  forfeited?: number[];
}): RoomState {
  const occupied = opts.occupied ?? [0, 1, 2];
  const seats = [0, 1, 2].map((seat) => {
    if (!occupied.includes(seat)) return null;
    const dc = opts.disconnected?.find((d) => d.seat === seat);
    return mkSeat(seat, {
      isAdmin: seat === opts.admin,
      connected: !dc,
      graceEndsAt: dc ? Date.now() + (dc.graceMs ?? 42_000) : null,
      forfeited: opts.forfeited?.includes(seat) ?? false,
    });
  });
  return {
    code: opts.code ?? "K7M2Q",
    status: opts.status ?? "LOBBY",
    adminSeat: opts.admin,
    you: opts.you,
    seats,
  };
}

export function known(position: number, shellNumber: number, observedLive: boolean, stale = false): KnownShell {
  return { position, shellNumber, observedLive, stale };
}

export type Inventory = ItemId[];
