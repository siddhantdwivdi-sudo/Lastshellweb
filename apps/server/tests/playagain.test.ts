import { S2C } from "@lastshell/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeState } from "./helpers";
import { makeMatch, newManager, newPeer, send, type Lobby } from "./room-helpers";

let lobby: Lobby;

/** A finished match: seat 0 has just shot seat 1, the last opponent. */
function finishedMatch(busyScale = 0): Lobby {
  lobby = makeMatch(newManager({ busyScale }));
  if (busyScale > 0) vi.advanceTimersByTime(3000);
  lobby.room.game = makeState({ alive: [true, true, false], hp: [3, 1, 3], shells: [true, false] });
  const res = send(lobby, lobby.peers[0], { type: "shoot", target: 1 });
  expect(res.ok).toBe(true);
  expect(lobby.room.status).toBe("GAME_OVER");
  return lobby;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  lobby?.manager.shutdown();
  vi.useRealTimers();
});

describe("PLAY AGAIN", () => {
  it("is admin-only", () => {
    finishedMatch();
    expect(lobby.manager.playAgain(lobby.peers[1])).toMatchObject({ ok: false, code: "NOT_ADMIN" });
    expect(lobby.manager.playAgain(lobby.peers[2])).toMatchObject({ ok: false, code: "NOT_ADMIN" });
    expect(lobby.room.status).toBe("GAME_OVER");
  });

  it("is refused while a match is still running", () => {
    lobby = makeMatch(newManager());
    expect(lobby.manager.playAgain(lobby.peers[0])).toMatchObject({ ok: false, code: "WRONG_STATE" });
  });

  it("is refused while the final animation is still playing", () => {
    finishedMatch(1);
    expect(lobby.room.busy).toBe(true);
    expect(lobby.manager.playAgain(lobby.peers[0])).toMatchObject({ ok: false, code: "BUSY" });
    vi.advanceTimersByTime(4200); // 900 + 1200 + 1500 + 600
    expect(lobby.manager.playAgain(lobby.peers[0])).toMatchObject({ ok: true });
  });

  it("does not announce the end of the match before its animation is over", () => {
    finishedMatch(1);
    expect(lobby.peers[1].last(S2C.roomState).status).not.toBe("GAME_OVER");
    vi.advanceTimersByTime(4200); // 900 + 1200 + 1500 + 600
    expect(lobby.peers[1].last(S2C.roomState).status).toBe("GAME_OVER");
  });

  it("starts a fresh match with the same seats when all three are connected", () => {
    finishedMatch();
    const versionBefore = lobby.room.version;
    expect(lobby.manager.playAgain(lobby.peers[0])).toMatchObject({ ok: true });
    expect(lobby.room.status).toBe("IN_MATCH");
    const game = lobby.room.game!;
    expect(game.loadNumber).toBe(1);
    expect(game.current).toBe(0);
    expect(game.players.every((p) => p.alive && p.hp === 3)).toBe(true);
    expect(lobby.room.version).toBeGreaterThan(versionBefore);
    const types = lobby.peers[2].last(S2C.events).events.map((e: any) => e.type);
    expect(types).toEqual(["matchStarted", "reload", "turnBegan"]);
    expect(lobby.peers.map((p) => p.seat)).toEqual([0, 1, 2]);
    // the new match accepts actions
    expect(send(lobby, lobby.peers[0], { type: "shoot", target: 1 })).toMatchObject({ ok: true });
  });

  it("returns to the lobby when someone is disconnected, freeing only their seat", () => {
    finishedMatch();
    lobby.manager.onDisconnect(lobby.peers[2]);
    expect(lobby.manager.playAgain(lobby.peers[0])).toMatchObject({ ok: true });
    expect(lobby.room.status).toBe("LOBBY");
    expect(lobby.room.game).toBeNull();
    expect(lobby.room.slots[2]).toBeNull();
    expect(lobby.room.slots[0]).not.toBeNull();
    expect(lobby.room.slots[1]).not.toBeNull();
    expect(lobby.room.adminSeat).toBe(0);
    expect(lobby.peers[1].last(S2C.roomState).status).toBe("LOBBY");

    // a new player fills the empty seat and the admin can start again
    const late = newPeer();
    expect(lobby.manager.joinRoom(late, lobby.code)).toMatchObject({ ok: true, seat: 2 });
    expect(lobby.manager.startMatch(lobby.peers[0])).toMatchObject({ ok: true });
    expect(lobby.room.status).toBe("IN_MATCH");
  });

  it("a player who left voluntarily also loses their seat in the new lobby", () => {
    finishedMatch();
    lobby.manager.leave(lobby.peers[1]);
    lobby.manager.playAgain(lobby.peers[0]);
    expect(lobby.room.status).toBe("LOBBY");
    expect(lobby.room.slots[1]).toBeNull();
    expect(lobby.manager.startMatch(lobby.peers[0])).toMatchObject({ ok: false, code: "ROOM_NOT_FULL" });
  });

  it("a disconnected admin hands over before anyone can restart", () => {
    finishedMatch();
    lobby.manager.onDisconnect(lobby.peers[0]);
    expect(lobby.manager.playAgain(lobby.peers[1])).toMatchObject({ ok: true });
    expect(lobby.room.status).toBe("LOBBY");
    expect(lobby.room.adminSeat).toBe(1);
  });
});
