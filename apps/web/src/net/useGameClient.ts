import { useMemo, useSyncExternalStore } from "react";
import { io } from "socket.io-client";
import type { AppController, AppScreen } from "../app/controller";
import type { GameActions } from "../ui/model";
import { GameClient, type KeyValueStore } from "./gameClient";
import { buildGameModel } from "./presenter";

/**
 * Where the game server is.
 *  - VITE_SERVER_URL if set (for example a deployed server)
 *  - in development: port 3001 of whatever host served this page (so a phone on the LAN works)
 *  - otherwise: the same origin that served the page
 */
export function serverUrl(): string | undefined {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:3001`;
  return undefined;
}

/** Per-tab storage: three tabs of one browser can be three different players. */
function browserStorage(): KeyValueStore {
  try {
    const probe = "__lastshell_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}

let singleton: GameClient | null = null;

function getClient(): GameClient {
  if (!singleton) {
    const socket = io(serverUrl(), {
      autoConnect: false,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    singleton = new GameClient({ socket, storage: browserStorage() });
    singleton.connect();
  }
  return singleton;
}

// Hot reload would otherwise leave an old socket connected.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    singleton?.dispose();
    singleton = null;
  });
}

export function useGameClient(): AppController {
  const client = getClient();
  const state = useSyncExternalStore(client.subscribe, client.getState);

  const actions = useMemo<GameActions>(
    () => ({
      shoot: client.shoot,
      useItem: client.useItem,
      playAgain: () => void client.playAgain(),
      leave: () => void client.leaveRoom(),
    }),
    [client],
  );

  const game = useMemo(
    () =>
      state.display && state.room
        ? buildGameModel({
            seat: state.room.you,
            room: state.room,
            display: state.display,
            busy: state.busy,
            pending: state.pending,
            reconnecting: !state.socketConnected || state.resuming,
          })
        : null,
    [state.display, state.room, state.busy, state.pending, state.socketConnected, state.resuming],
  );

  let screen: AppScreen;
  let loadingText: string | undefined;
  if (!state.room) {
    if (state.session) {
      screen = "loading";
      loadingText = "Returning to your room…";
    } else screen = "title";
  } else if (state.room.status === "LOBBY") screen = "lobby";
  else if (game) screen = "game";
  else {
    screen = "loading";
    loadingText = "Starting the match…";
  }

  return {
    screen,
    loadingText,
    connection: state.connection,
    creating: state.creating,
    joining: state.joining,
    starting: state.starting,
    notice: state.notice,
    dismissNotice: client.dismissNotice,
    toast: state.toast,
    dismissToast: () => client.dismissToast(),
    lobby: state.room,
    lobbyOffline: !state.socketConnected || state.resuming,
    game,
    gameActions: actions,
    createRoom: () => void client.createRoom(),
    joinRoom: (code) => client.joinRoom(code),
    retryConnection: () => client.retryConnection(),
    startMatch: () => void client.startMatch(),
    leaveRoom: () => void client.leaveRoom(),
  };
}
