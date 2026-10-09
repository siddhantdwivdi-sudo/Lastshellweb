// Everything the screens need, in one shape. Two things implement it:
//  - useGameClient()  (net/)   the real thing, talking to the server over Socket.IO
//  - useMockApp()     (mock/)  development-only, canned data
// The screens never know which one they are talking to.

import type { RoomState } from "@lastshell/shared";
import type { ConnectionState, GameActions, GameUiModel } from "../ui/model";

export type AppScreen = "title" | "lobby" | "game" | "loading";

export interface NoticeModel {
  kind: "error" | "info";
  text: string;
}

export interface ToastModel extends NoticeModel {
  id: number;
}

export interface AppController {
  screen: AppScreen;
  /** Shown on the loading screen. */
  loadingText?: string;
  connection: ConnectionState;
  creating: boolean;
  joining: boolean;
  starting: boolean;
  /** A message on the title screen (room expired, create failed...). */
  notice: NoticeModel | null;
  dismissNotice(): void;
  /** Short-lived message at the bottom (admin changed, player disconnected...). */
  toast: ToastModel | null;
  dismissToast(): void;
  lobby: RoomState | null;
  /** In the lobby but the connection dropped. */
  lobbyOffline: boolean;
  game: GameUiModel | null;
  gameActions: GameActions;

  createRoom(): void;
  /** Resolves with an error message, or null on success. */
  joinRoom(code: string): Promise<string | null>;
  retryConnection(): void;
  startMatch(): void;
  leaveRoom(): void;
}
