// End-to-end: the real frontend client logic against the real server over Socket.IO.
// Three clients play like three browser tabs would. Run with the rest: `npm test`.

import { afterEach, describe, expect, it } from "vitest";
import { createSeededRng, type Rng } from "../../src/engine";
import { makeState } from "../helpers";
import { FORBIDDEN_KEYS, collectKeys } from "../room-helpers";
import {
  C2S,
  closeAll,
  connected,
  lobbyOfThree,
  newClient,
  sleep,
  startServer,
  startedMatch,
  waitFor,
  type Rig,
  type TestClient,
} from "./harness";

let rig: Rig | undefined;
let clients: TestClient[] = [];
afterEach(async () => {
  closeAll(clients);
  clients = [];
  await rig?.server.close();
  rig = undefined;
});

const state = (c: TestClient) => c.client.getState();
const emitRaw = (c: TestClient, event: string, payload?: unknown): Promise<any> =>
  new Promise((resolve) => (payload === undefined ? c.socket.emit(event, resolve) : c.socket.emit(event, payload, resolve)));

function pick<T>(rng: Rng, list: T[]): T {
  return list[rng.int(list.length)];
}

/** Does one move for `c` using ONLY what the UI is told (public view + its own legal hints). */
function playOne(c: TestClient, rng: Rng): void {
  const st = state(c);
  const d = st.display!;
  const you = st.room!.you;
  const me = d.view.players[you];
  const legal = d.private.legal;
  const alive = d.view.players.filter((p) => p.alive).map((p) => p.seat);

  if (legal && me.items.length > 0 && rng.float() < 0.55) {
    const usable = me.items.map((item, slot) => ({ item, slot })).filter(({ slot }) => legal.itemBlocked[slot] === null);
    if (usable.length > 0) {
      const { item, slot } = pick(rng, usable);
      if (item === "handcuffs") {
        c.client.useItem(slot, { target: pick(rng, legal.cuffTargets) });
        return;
      }
      if (item === "adrenaline") {
        const victims = legal.steal.map((v, seat) => (v && v.some(Boolean) ? seat : -1)).filter((s) => s >= 0);
        const victim = pick(rng, victims);
        const stealSlot = pick(rng, legal.steal[victim]!.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0));
        const stolen = d.view.players[victim].items[stealSlot];
        if (stolen !== "handcuffs") {
          c.client.useItem(slot, { target: victim, stealSlot });
          return;
        }
        if (legal.cuffTargets.length > 0) {
          c.client.useItem(slot, { target: victim, stealSlot, subTarget: pick(rng, legal.cuffTargets) });
          return;
        }
      } else {
        c.client.useItem(slot);
        return;
      }
    }
  }
  c.client.shoot(pick(rng, alive));
}

async function playToEnd(players: TestClient[], rng: Rng, maxSteps = 4000): Promise<number> {
  for (let step = 0; step < maxSteps; step++) {
    if (players.every((p) => state(p).display?.view.phase === "GAME_OVER" && !state(p).busy)) return step;
    const actor = players.find((p) => p.client.canAct());
    if (!actor) {
      await sleep(2);
      continue;
    }
    playOne(actor, rng);
    await waitFor(() => !state(actor).pending, "action answer");
    // The hints must be consistent with the server: nothing the UI offers may be rejected.
    expect(state(actor).lastActionError, `step ${step}: server rejected an action the UI offered`).toBeNull();
  }
  throw new Error("match did not finish");
}

describe("lobby over the real server", () => {
  it("create, join, seats, admin, connection status", async () => {
    rig = await startServer();
    const { players, code } = await lobbyOfThree(rig);
    clients = players;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    for (const [i, p] of players.entries()) {
      const room = state(p).room!;
      expect(room.you).toBe(i);
      expect(room.status).toBe("LOBBY");
      expect(room.adminSeat).toBe(0);
      expect(room.seats.map((s) => s?.connected)).toEqual([true, true, true]);
      expect(room.seats.map((s) => s?.isAdmin)).toEqual([true, false, false]);
    }
  });

  it("refuses a fourth player, unknown codes and malformed codes with clear messages", async () => {
    rig = await startServer();
    const { players, code } = await lobbyOfThree(rig);
    const d = newClient(rig.url, "D");
    clients = [...players, d];
    await connected(d);
    expect(await d.client.joinRoom(code)).toBe("That room is full.");
    expect(await d.client.joinRoom("ZZZZZ")).toBe("No room with that code.");
    expect(state(d).session).toBeNull();
    expect(state(d).joining).toBe(false);
  });

  it("only the admin can start (client guard AND server check)", async () => {
    rig = await startServer();
    const { players } = await lobbyOfThree(rig);
    clients = players;
    await players[1].client.startMatch(); // guarded on the client
    expect(rig.server.manager.getRoom(state(players[0]).session!.code)!.status).toBe("LOBBY");
    expect(await emitRaw(players[1], C2S.start)).toMatchObject({ ok: false, code: "NOT_ADMIN" }); // forced past the client
    await players[0].client.startMatch();
    await waitFor(() => players.every((p) => state(p).display !== null), "game for everyone");
    expect(players.every((p) => state(p).room!.status === "IN_MATCH")).toBe(true);
  });

  it("admin leaving hands the role to the next player, who can then start", async () => {
    rig = await startServer();
    const { players, code } = await lobbyOfThree(rig);
    clients = players;
    await players[0].client.leaveRoom();
    expect(state(players[0]).session).toBeNull();
    await waitFor(() => state(players[1]).room?.adminSeat === 1, "admin transfer");
    expect(state(players[1]).toast?.text).toBe("You are now the room admin.");
    expect(state(players[2]).toast?.text).toBe("PLAYER 2 is now the room admin.");
    const d = newClient(rig.url, "D");
    clients.push(d);
    await connected(d);
    expect(await d.client.joinRoom(code)).toBeNull();
    expect(state(d).session!.seat).toBe(0); // takes the freed seat
    await waitFor(() => state(players[1]).room?.seats.filter(Boolean).length === 3, "refilled lobby");
    await players[1].client.startMatch();
    await waitFor(() => state(d).display !== null, "match for the new player");
  });
});

describe("a full match with three real clients", () => {
  it("plays to the end using only what the UI is told; no hidden data on the wire; PLAY AGAIN works", async () => {
    rig = await startServer({ rng: createSeededRng(5) });
    const { players, code } = await startedMatch(rig);
    clients = players;
    const rng = createSeededRng(77);

    const steps = await playToEnd(players, rng);
    expect(steps).toBeGreaterThan(5);

    // everyone agrees on the result and the public state
    const winner = state(players[0]).display!.view.winner;
    expect(winner).not.toBeNull();
    for (const p of players) {
      expect(state(p).display!.view.winner).toBe(winner);
      expect(JSON.stringify(state(p).display!.view)).toBe(JSON.stringify(state(players[0]).display!.view));
    }

    // nothing hidden was ever sent to anyone
    for (const p of players) {
      for (const text of p.raw) {
        const keys = collectKeys(JSON.parse(text));
        for (const bad of FORBIDDEN_KEYS) expect(keys.has(bad), `${p.name} received "${bad}"`).toBe(false);
      }
      // and the client never holds an engine-side field either
      const held = JSON.stringify(state(p));
      expect(held).not.toContain('"shells"');
      expect(held).not.toContain('"observations"');
    }

    // PLAY AGAIN: not for a non-admin (client guard and server), yes for the admin
    const sentBefore = rig.server.manager.getRoom(code)!.version;
    await players[1].client.playAgain();
    expect(rig.server.manager.getRoom(code)!.version).toBe(sentBefore);
    expect(await emitRaw(players[1], C2S.playAgain)).toMatchObject({ ok: false, code: "NOT_ADMIN" });
    await players[0].client.playAgain();
    await waitFor(
      () => players.every((p) => state(p).display?.view.phase === "AWAITING" && state(p).display?.view.loadNumber === 1 && !state(p).busy),
      "fresh match",
    );
    for (const p of players) expect(state(p).display!.view.players.every((pl) => pl.hp === 3 && pl.alive)).toBe(true);
  });

  it("completes several different seeded matches without a single rejected action", async () => {
    for (const seed of [1, 2, 3]) {
      rig = await startServer({ rng: createSeededRng(seed) });
      const { players } = await startedMatch(rig);
      clients = players;
      await playToEnd(players, createSeededRng(seed * 31));
      closeAll(players);
      clients = [];
      await rig.server.close();
      rig = undefined;
    }
  });

  it("PLAY AGAIN with a player missing returns everyone left to the lobby", async () => {
    rig = await startServer({ rng: createSeededRng(9) });
    const { players, code } = await startedMatch(rig);
    clients = players;
    await playToEnd(players, createSeededRng(3));
    await players[2].client.leaveRoom();
    await waitFor(() => state(players[0]).room?.seats[2]?.connected === false, "C gone");
    await players[0].client.playAgain();
    await waitFor(() => state(players[0]).room?.status === "LOBBY" && state(players[1]).room?.status === "LOBBY", "lobby again");
    expect(state(players[0]).display).toBeNull();
    expect(state(players[0]).room!.seats[2]).toBeNull();
    // a new player fills the seat and the admin starts a new match
    const d = newClient(rig.url, "D");
    clients.push(d);
    await connected(d);
    expect(await d.client.joinRoom(code)).toBeNull();
    await waitFor(() => state(players[0]).room?.seats.filter(Boolean).length === 3, "refilled");
    await players[0].client.startMatch();
    await waitFor(() => state(d).display !== null && !state(d).busy, "new match");
  });
});

describe("rejected, duplicate and badly-timed actions", () => {
  it("the client sends nothing when it is not my turn; forced requests are refused by the server", async () => {
    rig = await startServer();
    const { players, code } = await startedMatch(rig);
    clients = players;
    const room = rig.server.manager.getRoom(code)!;
    const version = room.version;

    let sent = 0;
    players[1].socket.io.on("packet", () => {});
    const origEmit = players[1].socket.emit.bind(players[1].socket);
    players[1].socket.emit = ((...args: any[]) => {
      if (args[0] === C2S.action) sent++;
      return origEmit(...(args as [string]));
    }) as never;
    players[1].client.shoot(0);
    players[1].client.useItem(0);
    expect(sent).toBe(0);

    const forced = await emitRaw(players[1], C2S.action, { actionId: "forced-action-1", version, action: { type: "shoot", target: 0 } });
    expect(forced).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    expect(room.version).toBe(version);
  });

  it("stale versions and repeated action ids are handled by the server", async () => {
    rig = await startServer();
    const { players, code } = await startedMatch(rig);
    clients = players;
    const room = rig.server.manager.getRoom(code)!;
    const v = room.version;
    expect(await emitRaw(players[0], C2S.action, { actionId: "stale-action-01", version: v - 1, action: { type: "shoot", target: 1 } })).toMatchObject({
      ok: false,
      code: "STALE_VERSION",
    });
    const a = await emitRaw(players[0], C2S.action, { actionId: "same-action-id", version: v, action: { type: "shoot", target: 1 } });
    expect(a).toMatchObject({ ok: true });
    const again = await emitRaw(players[0], C2S.action, { actionId: "same-action-id", version: v, action: { type: "shoot", target: 1 } });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(room.version).toBe(v + 1);
  });

  it("an illegal item pick is refused by the server even if the UI were bypassed", async () => {
    rig = await startServer();
    const { players, code } = await startedMatch(rig);
    clients = players;
    const room = rig.server.manager.getRoom(code)!;
    room.game!.players[0].items = ["handcuffs"];
    room.game!.players[1].cuffed = true;
    room.game!.players[2].cuffed = true;
    const res = await emitRaw(players[0], C2S.action, { actionId: "illegal-item-1", version: room.version, action: { type: "useItem", slot: 0, args: { target: 1 } } });
    expect(res).toMatchObject({ ok: false, code: "ITEM_UNUSABLE" });
  });

  it("the table is BUSY while an action plays out, and the client waits for it", async () => {
    rig = await startServer({ rooms: { busyScale: 0.15 } });
    const lobby = await lobbyOfThree(rig);
    clients = lobby.players;
    await lobby.players[0].client.startMatch();
    await waitFor(() => lobby.players.every((p) => state(p).display !== null), "start");
    expect(state(lobby.players[0]).busy).toBe(true); // opening reload sequence
    expect(lobby.players[0].client.canAct()).toBe(false);
    await waitFor(() => lobby.players.every((p) => !state(p).busy), "table idle");

    const room = rig.server.manager.getRoom(lobby.code)!;
    room.game = makeState({ shells: Array(8).fill(false) });
    lobby.players[0].client.shoot(1);
    await waitFor(() => state(lobby.players[1]).busy, "busy after the shot");
    expect(lobby.players[1].client.canAct()).toBe(false);
    // forced early request from the next player
    const early = await emitRaw(lobby.players[1], C2S.action, { actionId: "early-action-1", version: room.version, action: { type: "shoot", target: 2 } });
    expect(early).toMatchObject({ ok: false, code: "BUSY" });
    await waitFor(() => lobby.players.every((p) => !state(p).busy), "idle again");
    await waitFor(() => lobby.players[1].client.canAct(), "my turn");
  });
});

describe("private information", () => {
  it("Magnifying Glass and Burner Phone results reach only the player who used them", async () => {
    rig = await startServer();
    const { players, code } = await startedMatch(rig);
    clients = players;
    const room = rig.server.manager.getRoom(code)!;
    room.game!.players[0].items = ["magnifier", "phone"];
    room.game!.shells = [true, false, true, false, false, true];
    room.game!.observations = room.game!.shells.map(() => [null, null, null]);
    room.game!.fired = 0;

    players[0].client.useItem(0); // magnifier
    await waitFor(() => state(players[0]).display?.message?.text.includes("LIVE") === true && !state(players[0]).busy, "magnifier result");
    expect(state(players[0]).display!.private.knownShells).toEqual([{ position: 0, shellNumber: 1, observedLive: true, stale: false }]);
    for (const other of [players[1], players[2]]) {
      await waitFor(() => other.raw.some((r) => r.includes("inspects the chamber.")), "public text");
      expect(state(other).display!.message?.text).toBe("PLAYER 1 inspects the chamber.");
      expect(state(other).display!.private.knownShells).toEqual([]);
    }

    players[0].client.useItem(0); // phone (now slot 0)
    await waitFor(() => /Shell #\d/.test(state(players[0]).display?.message?.text ?? ""), "phone result");
    expect(state(players[0]).display!.private.knownShells.length).toBe(2);
    for (const other of [players[1], players[2]]) {
      await waitFor(() => other.raw.some((r) => r.includes("uses a burner phone.")), "public phone text");
      expect(state(other).display!.private.knownShells).toEqual([]);
      for (const r of other.raw) {
        expect(r).not.toContain('"reveal"');
        expect(r).not.toMatch(/Shell #\d/);
      }
    }
    // the player who looked is the only one whose raw traffic contains a reveal
    expect(players[0].raw.some((r) => r.includes('"reveal"'))).toBe(true);
  });
});

describe("connection problems", () => {
  it("a dropped connection resumes the same seat; the others see the countdown and the return", async () => {
    rig = await startServer();
    const { players } = await startedMatch(rig);
    clients = players;
    const b = players[1];
    const token = state(b).session!.token;

    (b.socket.io as any).engine.close(); // like pulling the network cable
    await waitFor(() => state(players[0]).room?.seats[1]?.connected === false, "A sees B drop");
    expect(typeof state(players[0]).room!.seats[1]!.graceEndsAt).toBe("number");
    expect(state(players[0]).toast?.text).toMatch(/PLAYER 2 disconnected/);

    await waitFor(() => state(b).socketConnected && !state(b).resuming && state(players[0]).room?.seats[1]?.connected === true, "B back");
    expect(state(b).session!.token).toBe(token);
    expect(state(b).room!.you).toBe(1);
    expect(state(b).display).not.toBeNull();
    expect(state(players[0]).toast?.text).toBe("PLAYER 2 is back.");
  });

  it("a player who does not come back in time forfeits, and the match goes on", async () => {
    rig = await startServer({ rooms: { graceMs: 250 } });
    const { players } = await startedMatch(rig);
    clients = players;
    players[2].client.dispose(); // gone for good
    await waitFor(() => state(players[0]).room?.seats[2]?.forfeited === true, "forfeit", 3000);
    await waitFor(() => state(players[0]).display?.view.players[2].alive === false && !state(players[0]).busy, "C eliminated");
    expect(state(players[0]).toast?.text).toBe("PLAYER 3 left the match.");
    expect(state(players[0]).room!.status).toBe("IN_MATCH");
    // A and B can still play on
    await playToEnd([players[0], players[1]], createSeededRng(4));
    expect(state(players[0]).display!.view.winner).not.toBeNull();
    expect(state(players[0]).display!.view.winner).not.toBe(2);
  });

  it("leaving mid-match forfeits at once and the token stops working", async () => {
    rig = await startServer();
    const { players, code } = await startedMatch(rig);
    clients = players;
    const token = state(players[2]).session!.token;
    await players[2].client.leaveRoom();
    await waitFor(() => state(players[0]).display?.view.players[2].alive === false, "C eliminated");
    const d = newClient(rig.url, "D");
    clients.push(d);
    await connected(d);
    expect(await emitRaw(d, C2S.resume, { code, token })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
  });

  it("a saved session for a room that doesn't exist sends the player back to the title with a message", async () => {
    rig = await startServer();
    const store = {
      v: JSON.stringify({ code: "ZZZZZ", seat: 1, token: "A".repeat(22) }),
      getItem() {
        return this.v;
      },
      setItem(_k: string, v: string) {
        this.v = v;
      },
      removeItem() {
        this.v = null as never;
      },
    };
    const c = newClient(rig.url, "X", store as never);
    clients = [c];
    await waitFor(() => state(c).notice !== null, "notice");
    expect(state(c).notice!.text).toMatch(/no longer exists/);
    expect(state(c).session).toBeNull();
    expect(store.getItem()).toBeNull();
  });

  it("a wrong or expired token is rejected with a clear message", async () => {
    rig = await startServer();
    const { players, code } = await lobbyOfThree(rig);
    clients = players;
    const store = { v: JSON.stringify({ code, seat: 1, token: "B".repeat(22) }), getItem() { return this.v; }, setItem(_k: string, v: string) { this.v = v; }, removeItem() { this.v = null as never; } };
    const c = newClient(rig.url, "X", store as never);
    clients.push(c);
    await waitFor(() => state(c).notice !== null, "notice");
    expect(state(c).notice!.text).toMatch(/seat expired/);
    expect(state(c).session).toBeNull();
  });

  it("a server restart drops the room: clients reconnect, find it gone, and say so", async () => {
    rig = await startServer();
    const port = rig.port;
    const a = newClient(rig.url, "A");
    clients = [a];
    await connected(a);
    await a.client.createRoom();
    await waitFor(() => state(a).room !== null, "room");
    await rig.server.close();
    await waitFor(() => !state(a).socketConnected, "A to notice the outage");
    rig = await startServer({}, port); // same address, brand-new empty server
    await waitFor(() => state(a).notice !== null, "A to find the room gone", 6000);
    expect(state(a).notice!.text).toMatch(/no longer exists/);
    expect(state(a).session).toBeNull();
    expect(state(a).room).toBeNull();
    // and A can start over
    await a.client.createRoom();
    await waitFor(() => state(a).room?.status === "LOBBY", "new room");
  });

  it("the same seat opened in a second window kicks the first window out", async () => {
    rig = await startServer();
    const { players, code } = await lobbyOfThree(rig);
    clients = players;
    const dupe = newClient(rig.url, "B2");
    clients.push(dupe);
    await connected(dupe);
    expect(await emitRaw(dupe, C2S.resume, { code, token: state(players[1]).session!.token })).toMatchObject({ ok: true, seat: 1 });
    await waitFor(() => state(players[1]).notice !== null, "old window told");
    expect(state(players[1]).notice!.text).toMatch(/another window/);
    expect(state(players[1]).session).toBeNull();
  });
});
