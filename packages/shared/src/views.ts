// What clients are allowed to see. These types deliberately contain NO field that can hold the
// hidden shell order or another player's observations.

import type { ItemId } from "./items";

export type GamePhase = "AWAITING" | "GAME_OVER";

export interface PublicPlayer {
  seat: number;
  hp: number;
  alive: boolean;
  slots: number;
  items: ItemId[];
  sawed: boolean;
  cuffed: boolean;
}

export interface PublicGameView {
  phase: GamePhase;
  current: number;
  loadNumber: number;
  /** Shells already used this load (needed for shell numbering). */
  fired: number;
  /** Public counts of what is still inside the shotgun. Never the order. */
  magazine: { total: number; live: number; blank: number };
  players: PublicPlayer[];
  /** null while playing, the winning seat once over, -1 for "no survivors". */
  winner: number | null;
}

/** One thing the receiving player personally observed. */
export interface KnownShell {
  /** 0 = chamber, 1 = next, ... (position in the magazine now). */
  position: number;
  /** Shell number within this load (fired + position + 1). */
  shellNumber: number;
  /** The value the player saw when they learned it. */
  observedLive: boolean;
  /**
   * true when an Inverter has been used on this shell since the player saw it. The old value is
   * kept for display, but the UI must treat it as unreliable. The current value is never sent.
   */
  stale: boolean;
}

/**
 * What the local player may try right now. It only exists to grey out buttons: it is derived from
 * public information and the player's OWN items, never from the hidden shell order. The server
 * still validates every action, whatever the client does with this.
 */
export interface LegalOptions {
  /** For each of my item slots: null if it can be used now, otherwise the reason it can't. */
  itemBlocked: (string | null)[];
  /** Opponent seats that can be handcuffed right now. */
  cuffTargets: number[];
  /** steal[seat][slot]: can that opponent item be stolen with Adrenaline right now? null = not a valid victim. */
  steal: (boolean[] | null)[];
}

export interface PrivateView {
  knownShells: KnownShell[];
  /** Only present while it is my turn and I can act; null otherwise. */
  legal: LegalOptions | null;
}

export interface Reveal {
  kind: "chamber" | "future";
  shellNumber: number;
  live: boolean;
}

/** Approximate time each event keeps the table busy (ms). Mirrors the Godot animation awaits. */
export const EVENT_DURATION_MS = {
  matchStarted: 0,
  reload: 2050,
  turnBegan: 0,
  shotFired: 900,
  shotResolved: 1200,
  itemUsed: 1300,
  skipped: 1300,
  eliminated: 1500,
  gameOver: 600,
} as const;

export type ClientEventBody =
  | { type: "matchStarted" }
  | { type: "reload"; loadNumber: number; live: number; blank: number }
  | { type: "turnBegan"; seat: number; announce: boolean }
  | { type: "shotFired"; shooter: number; target: number }
  | {
      type: "shotResolved";
      shooter: number;
      target: number;
      live: boolean;
      damage: number;
      selfShot: boolean;
      message: string;
    }
  | {
      type: "itemUsed";
      seat: number;
      item: ItemId;
      hpChange: number;
      /** -1 nothing ejected, 0 blank ejected, 1 live ejected. */
      eject: -1 | 0 | 1;
      text: string;
      /** Only present for the player who used the item. */
      reveal?: Reveal;
    }
  | { type: "skipped"; seat: number }
  | { type: "eliminated"; seat: number }
  | { type: "gameOver"; winner: number };

/** An event as delivered to ONE specific seat, with the state right after it. */
export type ClientEvent = ClientEventBody & {
  view: PublicGameView;
  private: PrivateView;
};
