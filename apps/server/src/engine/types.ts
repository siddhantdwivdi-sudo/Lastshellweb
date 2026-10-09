import type { ItemId, Reveal } from "@lastshell/shared";

export interface PlayerState {
  seat: number;
  hp: number;
  alive: boolean;
  slots: number;
  items: ItemId[];
  sawed: boolean;
  cuffed: boolean;
}

/** What one player saw about one shell. `stale` = an Inverter hit it after they looked. */
export interface Observation {
  live: boolean;
  stale: boolean;
}

/**
 * Full server-side state. This object must NEVER be sent to a client or spread into a message;
 * use the projection functions in ../views instead.
 */
export interface GameState {
  phase: "AWAITING" | "GAME_OVER";
  players: PlayerState[];
  /** HIDDEN. Index 0 is the chamber. true = LIVE. */
  shells: boolean[];
  /** HIDDEN. observations[shellIndex][seat] = what that seat saw, or null. */
  observations: (Observation | null)[][];
  /** Shells removed so far this load (for shell numbers). */
  fired: number;
  current: number;
  loadNumber: number;
  /** null while playing, seat when someone won, -1 for no survivors. */
  winner: number | null;
}

export interface ItemArgs {
  target?: number;
  stealSlot?: number;
  subTarget?: number;
}

export type Action =
  | { type: "shoot"; target: number }
  | { type: "useItem"; slot: number; args?: ItemArgs };

export type ErrorCode =
  | "WRONG_PHASE"
  | "NOT_YOUR_TURN"
  | "INVALID_TARGET"
  | "TARGET_ELIMINATED"
  | "EMPTY_MAGAZINE"
  | "INVALID_SLOT"
  | "ITEM_UNUSABLE";

export type EngineEventBody =
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
      eject: -1 | 0 | 1;
      /** Text safe for everyone. */
      publicText: string;
      /** Text for the user only (may contain hidden information). */
      privateText: string;
      /** Hidden information learned by `seat`. Must only be delivered to `seat`. */
      reveal?: Reveal;
    }
  | { type: "skipped"; seat: number }
  | { type: "eliminated"; seat: number }
  | { type: "gameOver"; winner: number };

/** An engine event with the complete server state right after it (server internal only). */
export type EngineEvent = EngineEventBody & { after: GameState };

export type ActionResult =
  | { ok: true; events: EngineEvent[] }
  | { ok: false; code: ErrorCode; message: string };
