import { DISCONNECT_GRACE_MS, S2C } from "@lastshell/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeState, obs } from "./helpers";
import { makeMatch, newManager, newPeer, send, type Lobby } from "./room-helpers";

let lobby: Lobby;
const GRACE = DISCONNECT_GRACE_MS;

function setup(config = {}, state = makeState({ shells: Array(8).fill(false) })): Lobby {
  lobby = makeMatch(newManager({ busyScale: 0, ...config }));
  lobby.room.game = state;
  return lobby;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  lobby?.manager.shutdown();
  vi.useRealTimers();
});

describe("disconnect grace period", () => {
  it("keeps the seat for 60 seconds and shows the countdown to everyone", () => {
    setup();
    lobby.manager.onDisconnect(lobby.peers[2]);
    const seat = lobby.peers[0].last(S2C.roomState).seats[2];
    expect(seat.connected).toBe(false);
    expect(seat.graceEndsAt).toBe(Date.now() + GRACE);
    vi.advanceTimersByTime(GRACE - 1);
    expect(lobby.room.game!.players[2].alive).toBe(true);
  });

  it("forfeits the player when the grace period runs out", () => {
    setup();
    lobby.manager.onDisconnect(lobby.peers[2]);
    vi.advanceTimersByTime(GRACE);
    expect(lobby.room.game!.players[2].alive).toBe(false);
    const types = lobby.peers[0].all(S2C.events).flatMap((p) => p.events.map((e: any) => e.type));
    expect(types).toContain("eliminated");
    expect(lobby.peers[0].last(S2C.roomState).seats[2].forfeited).toBe(true);
    expect(lobby.room.status).toBe("IN_MATCH"); // the match goes on for the others
  });

  it("waits while the disconnected player holds the turn, then passes it on", () => {
    setup();
    lobby.manager.onDisconnect(lobby.peers[0]); // seat 0 is the current player
    vi.advanceTimersByTime(GRACE - 1);
    expect(lobby.room.game!.current).toBe(0);
    vi.advanceTimersByTime(1);
    expect(lobby.room.game!.current).toBe(1);
    expect(lobby.room.game!.players[0].alive).toBe(false);
  });

  it("a forfeit that comes due during an animation waits until the table is idle", () => {
    setup({ busyScale: 1, graceMs: 1000 });
    vi.advanceTimersByTime(3000); // opening deal
    lobby.manager.onDisconnect(lobby.peers[2]);
    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 1 })).toMatchObject({ ok: true }); // busy ~2.1s
    vi.advanceTimersByTime(1500); // grace (1s) is over, but the table is busy
    expect(lobby.room.game!.players[2].alive).toBe(true);
    vi.advanceTimersByTime(700);
    expect(lobby.room.game!.players[2].alive).toBe(false);
  });

  it("ends the game when a second player's grace period runs out", () => {
    setup();
    lobby.manager.onDisconnect(lobby.peers[1]);
    lobby.manager.onDisconnect(lobby.peers[2]);
    vi.advanceTimersByTime(GRACE);
    expect(lobby.room.status).toBe("GAME_OVER");
    expect(lobby.room.game!.winner).toBe(0);
  });

  it("does not start a grace period for a player who is already eliminated", () => {
    setup({}, makeState({ alive: [true, true, false], shells: Array(8).fill(false) }));
    lobby.manager.onDisconnect(lobby.peers[2]);
    expect(lobby.peers[0].last(S2C.roomState).seats[2].graceEndsAt).toBeNull();
  });
});

describe("reconnecting", () => {
  it("returns the player to the same seat with a full snapshot and cancels the forfeit", () => {
    setup();
    const original = lobby.peers[1];
    const token = original.info!.token;
    lobby.manager.onDisconnect(original);
    vi.advanceTimersByTime(20_000);

    const fresh = newPeer("1.0.0.2");
    const res = lobby.manager.resumeRoom(fresh, lobby.code, token);
    expect(res).toMatchObject({ ok: true, seat: 1, code: lobby.code });
    const snap = fresh.last(S2C.snapshot);
    expect(snap.you).toBe(1);
    expect(snap.version).toBe(lobby.room.version);
    expect(snap.view.players).toHaveLength(3);
    expect(fresh.last(S2C.roomState).seats[1].connected).toBe(true);

    vi.advanceTimersByTime(GRACE * 2);
    expect(lobby.room.game!.players[1].alive).toBe(true);
    lobby.room.game!.current = 1;
    expect(send(lobby, fresh, { type: "shoot", target: 2 })).toMatchObject({ ok: true });
  });

  it("the snapshot contains only that player's own observations", () => {
    setup();
    const game = lobby.room.game!;
    game.observations[0][1] = obs(true); // seat 1 knows the chamber
    game.observations[3][2] = obs(false); // seat 2 knows shell 4
    const a = lobby.room.snapshotFor(1)!;
    const b = lobby.room.snapshotFor(2)!;
    expect(a.private.knownShells).toEqual([{ position: 0, shellNumber: 1, observedLive: true, stale: false }]);
    expect(b.private.knownShells).toEqual([{ position: 3, shellNumber: 4, observedLive: false, stale: false }]);
  });

  it("a newer connection with the same token replaces the old one", () => {
    setup();
    const old = lobby.peers[1];
    const fresh = newPeer("1.0.0.2");
    expect(lobby.manager.resumeRoom(fresh, lobby.code, old.info!.token)).toMatchObject({ ok: true, seat: 1 });
    expect(old.count(S2C.replaced)).toBe(1);
    expect(old.disconnected).toBe(true);
    lobby.room.game!.current = 1;
    expect(send(lobby, old, { type: "shoot", target: 2 })).toMatchObject({ ok: false, code: "NOT_IN_ROOM" });
    expect(send(lobby, fresh, { type: "shoot", target: 2 })).toMatchObject({ ok: true });
    // the old socket finally closing must not disturb the new session
    lobby.manager.onDisconnect(old);
    expect(lobby.room.slots[1]!.peer).toBe(fresh);
  });

  it("rejects wrong tokens, and a token only ever gives its own seat", () => {
    setup();
    lobby.manager.onDisconnect(lobby.peers[1]);
    expect(lobby.manager.resumeRoom(newPeer(), lobby.code, "A".repeat(22))).toMatchObject({
      ok: false,
      code: "INVALID_TOKEN",
    });
    // seat 2's token takes over seat 2 (never seat 1)
    const res = lobby.manager.resumeRoom(newPeer(), lobby.code, lobby.peers[2].info!.token);
    expect(res).toMatchObject({ ok: true, seat: 2 });
    expect(lobby.room.slots[1]!.peer).toBeNull();
  });

  it("rejects resuming a room that no longer exists", () => {
    setup();
    expect(lobby.manager.resumeRoom(newPeer(), "QQQQQ", "A".repeat(22))).toMatchObject({
      ok: false,
      code: "ROOM_NOT_FOUND",
    });
  });
});

describe("leaving mid-match", () => {
  it("forfeits immediately and invalidates the token", () => {
    setup();
    const leaver = lobby.peers[2];
    const token = leaver.info!.token;
    lobby.manager.leave(leaver);
    expect(lobby.room.game!.players[2].alive).toBe(false);
    expect(lobby.peers[0].last(S2C.roomState).seats[2]).toMatchObject({ connected: false, forfeited: true });
    expect(lobby.manager.resumeRoom(newPeer(), lobby.code, token)).toMatchObject({
      ok: false,
      code: "INVALID_TOKEN",
    });
  });

  it("the last remaining player wins", () => {
    setup();
    lobby.manager.leave(lobby.peers[1]);
    lobby.manager.leave(lobby.peers[2]);
    expect(lobby.room.status).toBe("GAME_OVER");
    expect(lobby.room.game!.winner).toBe(0);
  });
});

describe("admin during a match", () => {
  it("keeps the admin role during the grace period and passes it on when it expires", () => {
    setup();
    lobby.manager.onDisconnect(lobby.peers[0]);
    expect(lobby.room.adminSeat).toBe(0);
    vi.advanceTimersByTime(GRACE);
    expect(lobby.room.adminSeat).toBe(1);
    expect(lobby.peers[2].last(S2C.roomState).adminSeat).toBe(1);
  });

  it("passes the role on immediately when the admin leaves", () => {
    setup();
    lobby.manager.leave(lobby.peers[0]);
    expect(lobby.room.adminSeat).toBe(1);
  });

  it("passes the role on when the admin disconnects after the game is over", () => {
    setup({}, makeState({ alive: [true, true, false], hp: [3, 1, 3], shells: [true, false] }));
    send(lobby, lobby.peers[0], { type: "shoot", target: 1 });
    expect(lobby.room.status).toBe("GAME_OVER");
    lobby.manager.onDisconnect(lobby.peers[0]);
    expect(lobby.room.adminSeat).toBe(1);
  });
});

describe("empty room cleanup", () => {
  it("deletes an abandoned match after the TTL", () => {
    setup({ emptyRoomTtlMs: 300_000 });
    for (const p of lobby.peers) lobby.manager.onDisconnect(p);
    vi.advanceTimersByTime(299_999);
    expect(lobby.manager.roomCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(lobby.manager.roomCount()).toBe(0);
  });

  it("a returning player cancels the deletion", () => {
    setup({ emptyRoomTtlMs: 300_000 });
    const token = lobby.peers[0].info!.token;
    for (const p of lobby.peers) lobby.manager.onDisconnect(p);
    vi.advanceTimersByTime(5_000);
    expect(lobby.manager.resumeRoom(newPeer(), lobby.code, token)).toMatchObject({ ok: true });
    vi.advanceTimersByTime(600_000);
    expect(lobby.manager.roomCount()).toBe(1);
  });

  it("deletes the room after everyone has left a running match", () => {
    setup({ emptyRoomTtlMs: 1000 });
    for (const p of lobby.peers) lobby.manager.leave(p);
    vi.advanceTimersByTime(1000);
    expect(lobby.manager.roomCount()).toBe(0);
  });
});
