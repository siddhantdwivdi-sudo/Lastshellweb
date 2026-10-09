// The shapes the UI renders. In this phase they are filled from mock data; in the networking phase
// the same shapes will be built from server messages (RoomState, GameSnapshot, GameEvents).
// Nothing in here (or in the components) knows any game rules.

import type { ActionBody, PrivateView, PublicGameView, RoomState } from "@lastshell/shared";

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
