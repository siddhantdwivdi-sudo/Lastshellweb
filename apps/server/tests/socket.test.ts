// End-to-end over real Socket.IO connections on an ephemeral port.

import { C2S, S2C, type Ack, type JoinedInfo } from "@lastshell/shared";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../src/app";
import { createSeededRng } from "../src/engine";
import { FORBIDDEN_KEYS, collectKeys } from "./room-helpers";

interface TestClient {
  socket: Socket;
  events: any[];
  snapshots: any[];
  roomStates: any[];
  raw: string[];
  info?: JoinedInfo;
}

let server: GameServer;
let url: string;
const clients: TestClient[] = [];

beforeEach(async () => {
  server = createGameServer({ rooms: { busyScale: 0 }, rng: createSeededRng(7), allowedOrigins: ["http://localhost:5173"] });
  const port = await server.listen(0);
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.disconnect();
  await server.close();
});

async function newClient(): Promise<TestClient> {
  const socket = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  const c: TestClient = { socket, events: [], snapshots: [], roomStates: [], raw: [] };
  socket.on(S2C.events, (p) => {
    c.events.push(p);
    c.raw.push(JSON.stringify(p));
  });
  socket.on(S2C.snapshot, (p) => {
    c.snapshots.push(p);
    c.raw.push(JSON.stringify(p));
  });
  socket.on(S2C.roomState, (p) => {
    c.roomStates.push(p);
    c.raw.push(JSON.stringify(p));
  });
  clients.push(c);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  return c;
}

function call<T extends object = object>(c: TestClient, event: string, payload?: unknown): Promise<Ack<T>> {
  return c.socket.timeout(3000).emitWithAck(event, payload) as Promise<Ack<T>>;
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function threePlayers(): Promise<{ players: TestClient[]; code: string }> {
  const [a, b, c] = [await newClient(), await newClient(), await newClient()];
  const created = await call<JoinedInfo>(a, C2S.create);
  if (!created.ok) throw new Error(created.message);
  a.info = created;
  for (const p of [b, c]) {
    const joined = await call<JoinedInfo>(p, C2S.join, { code: created.code.toLowerCase() });
    if (!joined.ok) throw new Error(joined.message);
    p.info = joined;
  }
  return { players: [a, b, c], code: created.code };
}

describe("over the wire", () => {
  it("exposes a harmless health check", async () => {
    const res = await fetch(`${url}/healthz`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("creates, joins (case-insensitively), starts and plays an action", async () => {
    const { players } = await threePlayers();
    expect(players.map((p) => p.info!.seat)).toEqual([0, 1, 2]);

    expect(await call(players[1], C2S.start)).toMatchObject({ ok: false, code: "NOT_ADMIN" });
    expect(await call(players[0], C2S.start)).toMatchObject({ ok: true });
    await waitFor(() => players.every((p) => p.events.length >= 1));

    const first = players[0].events[0];
    expect(first.events.map((e: any) => e.type)).toEqual(["matchStarted", "reload", "turnBegan"]);
    const version = first.version;

    const ack = await call(players[0], C2S.action, {
      actionId: "wire-action-0001",
      version,
      action: { type: "shoot", target: 1 },
    });
    expect(ack).toMatchObject({ ok: true, version: version + 1 });
    await waitFor(() => players.every((p) => p.events.length >= 2));
    expect(players[2].events[1].version).toBe(version + 1);

    // someone else acting out of turn is refused
    expect(
      await call(players[0], C2S.action, {
        actionId: "wire-action-0002",
        version: version + 1,
        action: { type: "shoot", target: 1 },
      }),
    ).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
  });

  it("rejects malformed requests and any attempt to choose a seat", async () => {
    const { players } = await threePlayers();
    await call(players[0], C2S.start);
    await waitFor(() => players[0].events.length >= 1);
    const version = players[0].events[0].version;

    const spoof = await call(players[1], C2S.action, {
      actionId: "spoof-action-1",
      version,
      seat: 0,
      action: { type: "shoot", target: 1 },
    });
    expect(spoof).toMatchObject({ ok: false, code: "BAD_REQUEST" });
    const nested = await call(players[1], C2S.action, {
      actionId: "spoof-action-2",
      version,
      action: { type: "shoot", target: 1, seat: 0 },
    });
    expect(nested).toMatchObject({ ok: false, code: "BAD_REQUEST" });

    for (const bad of [null, "x", 5, { code: 12345 }, { code: "ABCDE", extra: 1 }]) {
      expect(await call(players[2], C2S.join, bad)).toMatchObject({ ok: false });
    }
    expect(await call(players[2], C2S.action, { actionId: "x", version: "1", action: {} })).toMatchObject({
      ok: false,
      code: "BAD_REQUEST",
    });
    expect(await call(players[2], C2S.start, { seat: 0 })).toMatchObject({ ok: false, code: "BAD_REQUEST" });
  });

  it("never puts hidden information on the wire", async () => {
    const { players } = await threePlayers();
    await call(players[0], C2S.start);
    await waitFor(() => players.every((p) => p.events.length >= 1));
    for (const p of players) {
      for (const text of p.raw) {
        const keys = collectKeys(JSON.parse(text));
        for (const bad of FORBIDDEN_KEYS) expect(keys.has(bad), bad).toBe(false);
      }
    }
  });

  it("lets a dropped player come back with their token and get a snapshot", async () => {
    const { players, code } = await threePlayers();
    await call(players[0], C2S.start);
    await waitFor(() => players.every((p) => p.events.length >= 1));

    const token = players[1].info!.token;
    players[1].socket.disconnect();
    await waitFor(() => players[0].roomStates.at(-1)?.seats[1]?.connected === false);

    const back = await newClient();
    const res = await call<JoinedInfo>(back, C2S.resume, { code, token });
    expect(res).toMatchObject({ ok: true, seat: 1 });
    await waitFor(() => back.snapshots.length === 1);
    expect(back.snapshots[0].you).toBe(1);
    expect(back.snapshots[0].view.players).toHaveLength(3);

    const wrong = await newClient();
    expect(await call(wrong, C2S.resume, { code, token: "A".repeat(22) })).toMatchObject({
      ok: false,
      code: "INVALID_TOKEN",
    });
  });

  it("answers requests that arrive without an acknowledgement callback without crashing", async () => {
    const c = await newClient();
    c.socket.emit(C2S.create);
    c.socket.emit(C2S.join, { nope: true });
    c.socket.emit("not-an-event", { a: 1 });
    await waitFor(() => c.roomStates.length >= 1);
    const again = await newClient();
    expect(await call(again, C2S.create)).toMatchObject({ ok: true });
  });
});
