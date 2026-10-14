// The shapes the UI renders. In this phase they are filled from mock data; in the networking phase
// the same shapes will be built from server messages (RoomState, GameSnapshot, GameEvents).
// Nothing in here (or in the components) knows any game rules.

import type { ActionBody, ItemId, PrivateView, PublicGameView, RoomState } from "@lastshell/shared";

export interface BannerModel {
  id: number;
  text: string;
  color: string;
}

export interface MessageModel {
  id: number;
  text: string;
  bad: boolean;
}

export interface AimModel {
  shooter: number;
  target: number;
  /** Changes on every shot, so the muzzle flash re-triggers. */
  shotId: number;
}

/**
 * What the table just did, copied straight from server events (never computed here).
 * `id` changes for every new cue, so an animation plays once per event and never replays on re-render.
 */
export interface ShotCue {
  id: number;
  shooter: number;
  target: number;
  /** The server said this shell was LIVE (false = blank, a dry click). */
  live: boolean;
  /** Damage the server applied to `target`. */
  damage: number;
  selfShot: boolean;
}

export interface ElimCue {
  id: number;
  seat: number;
}

export interface ItemCue {
  id: number;
  seat: number;
  item: ItemId;
  /** Negative = the user hurt themselves (e.g. expired medicine). */
  hpChange: number;
  /** A shell was ejected by this item: 1 = it was live, 0 = blank, -1 = nothing ejected. */
  eject?: number;
}

export interface SceneCues {
  shot: ShotCue | null;
  elim: ElimCue | null;
  item: ItemCue | null;
}

export const NO_CUES: SceneCues = { shot: null, elim: null, item: null };

export type FxKind = "flash-live" | "flash-blank" | "flash-item" | "flash-out";

export interface FxModel {
  id: number;
  kind: FxKind;
  color?: string;
  shake?: boolean;
}

export interface ReloadModel {
  loadNumber: number;
  live: number;
  blank: number;
}

export interface GameUiModel {
  /** The local player's seat. */
  you: number;
  view: PublicGameView;
  private: PrivateView;
  /** Admin, connection status and countdowns for each seat. */
  room: RoomState;
  /** The table is still playing out the previous action (server pacing). */
  busy: boolean;
  /** One of my own requests is waiting for the server's answer. */
  pending: boolean;
  /** true while (re)connecting: shows a blocking "reconnecting" state. */
  reconnecting: boolean;
  banner: BannerModel | null;
  message: MessageModel | null;
  aim: AimModel | null;
  fx: FxModel | null;
  reload: ReloadModel | null;
  /** Scene animation cues from the latest server events. */
  cues: SceneCues;
}

export type ItemArgs = Extract<ActionBody, { type: "useItem" }>["args"];

export interface GameActions {
  shoot(target: number): void;
  useItem(slot: number, args?: ItemArgs): void;
  /** Admin only (the UI disables it for everyone else). */
  playAgain(): void;
  leave(): void;
}

export type ConnectionState = "ready" | "connecting" | "error";
