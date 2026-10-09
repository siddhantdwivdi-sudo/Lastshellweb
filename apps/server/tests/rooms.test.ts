import { ROOM_CODE_ALPHABET, S2C } from "@lastshell/shared";
import { afterEach, describe, expect, it } from "vitest";
import { collectKeys, makeLobby, makeMatch, newManager, newPeer } from "./room-helpers";

const managers: { shutdown(): void }[] = [];
afterEach(() => {
  while (managers.length) managers.pop()!.shutdown();
});
function manager(config = {}) {
  const m = newManager(config);
  managers.push(m);
  return m;
}

describe("room creation", () => {
  it("creates a room with a 5-character code, seat 0, a secret token and admin rights", () => {
    const m = manager();
    const p = newPeer();
    const res = m.createRoom(p);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(res.seat).toBe(0);
    expect(res.token.length).toBeGreaterThanOrEqual(20);
    const state = p.last(S2C.roomState);
    expect(state.adminSeat).toBe(0);
    expect(state.status).toBe("LOBBY");
    expect(state.you).toBe(0);
  });

  it("generates unique, well-formed codes from the safe alphabet", () => {
    const m = manager({ maxRooms: 1000 });
    const codes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const res = m.createRoom(newPeer(`9.9.${Math.floor(i / 200)}.${i % 200}`));
      if (!res.ok) throw new Error(res.message);
      expect([...res.code].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
      codes.add(res.code);
    }
    expect(codes.size).toBe(300);
  });

  it("issues a different token to every player and never broadcasts tokens", () => {
    const lobby = makeLobby(manager());
    const tokens = lobby.peers.map((p) => p.info!.token);
    expect(new Set(tokens).size).toBe(3);
    for (const p of lobby.peers) {
      for (const msg of p.sent) {
        expect(collectKeys(msg.payload).has("token")).toBe(false);
        expect(JSON.stringify(msg.payload)).not.toContain(tokens[0]);
      }
    }
  });

  it("refuses to create or join while already in a room", () => {
    const lobby = makeLobby(manager());
    expect(lobby.manager.createRoom(lobby.peers[0])).toMatchObject({ ok: false, code: "ALREADY_IN_ROOM" });
    expect(lobby.manager.joinRoom(lobby.peers[1], lobby.code)).toMatchObject({ ok: false, code: "ALREADY_IN_ROOM" });
  });
});

describe("joining and capacity", () => {
  it("seats players 0, 1, 2 in order and rejects a fourth", () => {
    const lobby = makeLobby(manager());
    expect(lobby.peers.map((p) => p.seat)).toEqual([0, 1, 2]);
    const fourth = newPeer();
    expect(lobby.manager.joinRoom(fourth, lobby.code)).toMatchObject({ ok: false, code: "ROOM_FULL" });
    expect(lobby.room.connectedCount()).toBe(3);
  });

  it("rejects unknown codes", () => {
    const m = manager();
    expect(m.joinRoom(newPeer(), "ZZZZZ")).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
  });

  it("tells every player about the lobby when someone joins", () => {
    const m = manager();
    const a = newPeer();
    const created = m.createRoom(a);
    if (!created.ok) throw new Error();
    const b = newPeer();
    m.joinRoom(b, created.code);
    const state = a.last(S2C.roomState);
    expect(state.seats.map((s: any) => s && s.seat)).toEqual([0, 1, null]);
    expect(b.last(S2C.roomState).you).toBe(1);
  });

  it("refuses new players once the match has started", () => {
    const lobby = makeMatch(manager());
    expect(lobby.manager.joinRoom(newPeer(), lobby.code)).toMatchObject({ ok: false, code: "ROOM_STARTED" });
  });
});

describe("leaving the lobby", () => {
  it("frees the seat, and the next player gets the lowest free seat", () => {
    const lobby = makeLobby(manager());
    lobby.manager.leave(lobby.peers[1]);
    expect(lobby.room.slots[1]).toBeNull();
    const late = newPeer();
    const res = lobby.manager.joinRoom(late, lobby.code);
    expect(res).toMatchObject({ ok: true, seat: 1 });
  });

  it("transfers admin to the lowest connected seat when the admin leaves", () => {
    const lobby = makeLobby(manager());
    lobby.manager.leave(lobby.peers[0]);
    expect(lobby.room.adminSeat).toBe(1);
    expect(lobby.peers[1].last(S2C.roomState).adminSeat).toBe(1);
    expect(lobby.peers[2].last(S2C.roomState).seats[1].isAdmin).toBe(true);
    // the new admin can start once the room is full again
    const late = newPeer();
    lobby.manager.joinRoom(late, lobby.code);
    expect(lobby.manager.startMatch(lobby.peers[1])).toMatchObject({ ok: true });
  });

  it("transfers admin when the admin's connection drops in the lobby", () => {
    const lobby = makeLobby(manager());
    lobby.manager.onDisconnect(lobby.peers[0]);
    expect(lobby.room.adminSeat).toBe(1);
    expect(lobby.room.slots[0]).toBeNull();
  });

  it("deletes the room when the last player leaves", () => {
    const lobby = makeLobby(manager());
    for (const p of lobby.peers) lobby.manager.leave(p);
    expect(lobby.manager.roomCount()).toBe(0);
    expect(lobby.manager.joinRoom(newPeer(), lobby.code)).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
  });
});

describe("starting a match", () => {
  it("only the admin may start", () => {
    const lobby = makeLobby(manager());
    expect(lobby.manager.startMatch(lobby.peers[1])).toMatchObject({ ok: false, code: "NOT_ADMIN" });
    expect(lobby.room.status).toBe("LOBBY");
  });

  it("needs exactly three connected players", () => {
    const m = manager();
    const a = newPeer();
    const created = m.createRoom(a);
    if (!created.ok) throw new Error();
    m.joinRoom(newPeer(), created.code);
    expect(m.startMatch(a)).toMatchObject({ ok: false, code: "ROOM_NOT_FULL" });
  });

  it("starts, sends every seat the opening events, and cannot be started twice", () => {
    const lobby = makeLobby(manager());
    expect(lobby.manager.startMatch(lobby.peers[0])).toMatchObject({ ok: true });
    expect(lobby.room.status).toBe("IN_MATCH");
    for (const p of lobby.peers) {
      const payload = p.all(S2C.events)[0];
      expect(payload.version).toBe(1);
      expect(payload.events.map((e: any) => e.type)).toEqual(["matchStarted", "reload", "turnBegan"]);
      expect(payload.events[2].seat).toBe(0);
      expect(payload.events[2].view.players).toHaveLength(3);
    }
    expect(lobby.manager.startMatch(lobby.peers[0])).toMatchObject({ ok: false, code: "WRONG_STATE" });
  });

  it("rejects room commands from connections that are not in a room", () => {
    const m = manager();
    const stranger = newPeer();
    expect(m.startMatch(stranger)).toMatchObject({ ok: false, code: "NOT_IN_ROOM" });
    expect(m.playAgain(stranger)).toMatchObject({ ok: false, code: "NOT_IN_ROOM" });
    expect(m.leave(stranger)).toMatchObject({ ok: false, code: "NOT_IN_ROOM" });
    expect(
      m.action(stranger, { actionId: "abcdefgh", version: 0, action: { type: "shoot", target: 0 } }),
    ).toMatchObject({ ok: false, code: "NOT_IN_ROOM" });
  });
});
