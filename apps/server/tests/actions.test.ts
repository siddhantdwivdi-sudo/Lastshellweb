import { EVENT_DURATION_MS, S2C } from "@lastshell/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeState } from "./helpers";
import { makeMatch, newManager, send, type Lobby } from "./room-helpers";

let lobby: Lobby;

function setup(busyScale = 0, state = makeState({ shells: Array(8).fill(false) })): Lobby {
  lobby = makeMatch(newManager({ busyScale }));
  lobby.room.game = state;
  return lobby;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  lobby?.manager.shutdown();
  vi.useRealTimers();
});

describe("who may act", () => {
  it("rejects a player whose turn it is not, without changing or broadcasting anything", () => {
    setup();
    const before = JSON.stringify(lobby.room.game);
    const sentBefore = lobby.peers.map((p) => p.sent.length);
    const res = send(lobby, lobby.peers[1], { type: "shoot", target: 0 });
    expect(res).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    expect(JSON.stringify(lobby.room.game)).toBe(before);
    expect(lobby.peers.map((p) => p.sent.length)).toEqual(sentBefore);
    expect(lobby.room.version).toBe(1);
  });

  it("uses the seat of the authenticated connection (a player cannot act as another seat)", () => {
    setup();
    // Seat 2's connection tries seat 0's move: it is judged as seat 2.
    expect(send(lobby, lobby.peers[2], { type: "shoot", target: 1 })).toMatchObject({
      ok: false,
      code: "NOT_YOUR_TURN",
    });
    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 1 })).toMatchObject({ ok: true });
  });

  it("rejects actions outside a running match", () => {
    setup();
    lobby.room.game = makeState({ alive: [true, true, false], hp: [3, 1, 3], shells: [true, false] });
    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 1 })).toMatchObject({ ok: true });
    expect(lobby.room.status).toBe("GAME_OVER");
    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 1 })).toMatchObject({
      ok: false,
      code: "WRONG_STATE",
    });
  });
});

describe("applying an action", () => {
  it("applies it once, bumps the version and sends every seat its own projection", () => {
    setup();
    const res = send(lobby, lobby.peers[0], { type: "shoot", target: 1 });
    expect(res).toMatchObject({ ok: true, version: 2 });
    expect(lobby.room.version).toBe(2);
    expect(lobby.room.game!.current).toBe(1);
    for (const p of lobby.peers) {
      const last = p.all(S2C.events).pop();
      expect(last.version).toBe(2);
      expect(last.events.map((e: any) => e.type)).toEqual(["shotFired", "shotResolved", "turnBegan"]);
    }
  });

  it("tells clients when the table is idle again", () => {
    setup();
    send(lobby, lobby.peers[0], { type: "shoot", target: 1 });
    expect(lobby.peers[2].last(S2C.idle)).toEqual({ version: 2 });
  });

  it("surfaces engine rejections as errors and leaves the game untouched", () => {
    setup(0, makeState({ alive: [true, true, false], shells: Array(8).fill(false) }));
    const before = JSON.stringify(lobby.room.game);
    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 2 })).toMatchObject({
      ok: false,
      code: "TARGET_ELIMINATED",
    });
    expect(send(lobby, lobby.peers[0], { type: "useItem", slot: 3 })).toMatchObject({
      ok: false,
      code: "INVALID_SLOT",
    });
    expect(JSON.stringify(lobby.room.game)).toBe(before);
    expect(lobby.room.version).toBe(1);
  });
});

describe("pacing (BUSY)", () => {
  it("blocks new actions until the animation time has passed", () => {
    setup(1);
    vi.advanceTimersByTime(3000); // opening reload sequence
    expect(lobby.room.busy).toBe(false);

    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 1 })).toMatchObject({ ok: true });
    expect(lobby.room.busy).toBe(true);

    // seat 1 has seen version 2 (the events) and tries to act too early
    const early = send(lobby, lobby.peers[1], { type: "shoot", target: 2 });
    expect(early).toMatchObject({ ok: false, code: "BUSY" });
    expect(lobby.room.game!.players[2].hp).toBe(3);

    vi.advanceTimersByTime(EVENT_DURATION_MS.shotFired + EVENT_DURATION_MS.shotResolved);
    expect(lobby.room.busy).toBe(false);
    expect(lobby.peers[1].last(S2C.idle)).toEqual({ version: 2 });
    expect(send(lobby, lobby.peers[1], { type: "shoot", target: 2 })).toMatchObject({ ok: true });
  });

  it("the opening deal also keeps the table busy", () => {
    setup(1);
    expect(lobby.room.busy).toBe(true);
    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 1 })).toMatchObject({
      ok: false,
      code: "BUSY",
    });
  });

  it("a double click cannot apply twice (the second is stale, state changes once)", () => {
    setup(1);
    vi.advanceTimersByTime(3000);
    const version = lobby.room.version;
    const a = send(lobby, lobby.peers[0], { type: "shoot", target: 1 }, { version });
    const b = send(lobby, lobby.peers[0], { type: "shoot", target: 2 }, { version });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, code: "STALE_VERSION" });
    expect(lobby.room.game!.shells.length).toBe(7); // exactly one shell used
  });

  it("two players racing in the same tick: only the first is applied", () => {
    setup(1);
    vi.advanceTimersByTime(3000);
    const version = lobby.room.version;
    const first = send(lobby, lobby.peers[0], { type: "shoot", target: 1 }, { version });
    const second = send(lobby, lobby.peers[1], { type: "shoot", target: 2 }, { version });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(lobby.room.game!.shells.length).toBe(7);
  });
});

describe("duplicate and stale actions", () => {
  it("rejects an outdated version and reports the current one", () => {
    setup();
    const res = send(lobby, lobby.peers[0], { type: "shoot", target: 1 }, { version: 0 });
    expect(res).toMatchObject({ ok: false, code: "STALE_VERSION", version: 1 });
    expect(lobby.room.version).toBe(1);
  });

  it("rejects a version from the future", () => {
    setup();
    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 1 }, { version: 99 })).toMatchObject({
      ok: false,
      code: "STALE_VERSION",
    });
  });

  it("resending the same action id is answered from memory and never applied again", () => {
    setup(0, makeState({ shells: Array(8).fill(true) }));
    const id = "same-action-id";
    const first = send(lobby, lobby.peers[0], { type: "shoot", target: 1 }, { actionId: id });
    expect(first).toMatchObject({ ok: true, version: 2 });
    const retry = send(lobby, lobby.peers[0], { type: "shoot", target: 1 }, { actionId: id, version: 1 });
    expect(retry).toMatchObject({ ok: true, version: 2, duplicate: true });
    // even a replay carrying the new version is not applied again
    const replay = send(lobby, lobby.peers[0], { type: "shoot", target: 1 }, { actionId: id, version: 2 });
    expect(replay).toMatchObject({ ok: true, duplicate: true });
    expect(lobby.room.game!.players[1].hp).toBe(2);
    expect(lobby.room.version).toBe(2);
    expect(lobby.peers[1].all(S2C.events)).toHaveLength(2); // opening + one action
  });

  it("an action id is scoped to the player who used it", () => {
    setup(0, makeState({ shells: Array(8).fill(false) }));
    send(lobby, lobby.peers[0], { type: "shoot", target: 1 }, { actionId: "shared-id-0001" });
    const other = send(lobby, lobby.peers[1], { type: "shoot", target: 2 }, { actionId: "shared-id-0001" });
    expect(other).toMatchObject({ ok: true });
    expect("duplicate" in other).toBe(false);
    expect(lobby.room.version).toBe(3);
  });
});
