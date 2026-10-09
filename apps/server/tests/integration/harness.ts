// Real clients (the frontend's GameClient) talking to the real server over real Socket.IO.
// The frontend code is imported only to TEST it against the server; the app itself never imports
// the server or the rules engine.

import { C2S, S2C } from "@lastshell/shared";
import { io, type Socket } from "socket.io-client";
import { GameClient, memoryStore, type KeyValueStore } from "../../../web/src/net/gameClient";
import { createGameServer, type GameServer, type GameServerOptions } from "../../src/app";
import { createSeededRng, type Rng } from "../../src/engine";

export { C2S, S2C };

export interface Rig {
  server: GameServer;
  url: string;
  port: number;
}

export async function startServer(options: GameServerOptions = {}, port = 0): Promise<Rig> {
  const server = createGameServer({
    allowedOrigins: ["*"],
    ...options,
    rooms: { busyScale: 0, ...options.rooms },
    rng: options.rng ?? createSeededRng(11),
  });
  const actualPort = await server.listen(port);
  return { server, url: `http://127.0.0.1:${actualPort}`, port: actualPort };
}

export interface TestClient {
  client: GameClient;
  socket: Socket;
  storage: KeyValueStore;
  /** Everything the server pushed to this client, as raw JSON text. */
  raw: string[];
  name: string;
}

export function newClient(url: string, name: string, storage: KeyValueStore = memoryStore()): TestClient {
  const socket = io(url, { autoConnect: false, forceNew: true, reconnectionDelay: 40, reconnectionDelayMax: 120, transports: ["websocket"] });
  const raw: string[] = [];
  socket.onAny((_event, payload) => {
    try {
      raw.push(JSON.stringify(payload ?? null));
    } catch {
      /* ignore */
    }
  });
  const client = new GameClient({ socket: socket as never, storage, ackTimeoutMs: 3000, resumeRetryMs: 100 });
  client.connect();
  return { client, socket, storage, raw, name };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(cond: () => boolean, what = "condition", ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

export async function connected(c: TestClient): Promise<void> {
  await waitFor(() => c.client.getState().connection === "ready", `${c.name} to connect`);
}

/** Three players in one room, still in the lobby. */
export async function lobbyOfThree(rig: Rig): Promise<{ players: TestClient[]; code: string }> {
  const players = ["A", "B", "C"].map((n) => newClient(rig.url, n));
  await Promise.all(players.map(connected));
  await players[0].client.createRoom();
  await waitFor(() => players[0].client.getState().room !== null, "room for A");
  const code = players[0].client.getState().session!.code;
  for (const p of players.slice(1)) {
    const err = await p.client.joinRoom(code);
    if (err) throw new Error(`${p.name} could not join: ${err}`);
  }
  await waitFor(() => players.every((p) => p.client.getState().room?.seats.filter(Boolean).length === 3), "full lobby");
  return { players, code };
}

export async function startedMatch(rig: Rig) {
  const lobby = await lobbyOfThree(rig);
  await lobby.players[0].client.startMatch();
  await waitFor(() => lobby.players.every((p) => p.client.getState().display !== null && !p.client.getState().busy), "match to start");
  return lobby;
}

export function closeAll(players: TestClient[]): void {
  for (const p of players) p.client.dispose();
}

export type { Rng };
