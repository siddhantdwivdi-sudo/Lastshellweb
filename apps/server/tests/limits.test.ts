import { afterEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rooms/limiter";
import { generateRoomCode, generateToken, hashToken, tokenMatches } from "../src/rooms/ids";
import { newManager, newPeer } from "./room-helpers";

const managers: { shutdown(): void }[] = [];
afterEach(() => {
  while (managers.length) managers.pop()!.shutdown();
});
function manager(config = {}) {
  const m = newManager(config);
  managers.push(m);
  return m;
}

describe("RateLimiter", () => {
  it("allows up to the limit per window and then resets", () => {
    const l = new RateLimiter(3, 1000);
    expect([1, 2, 3].map(() => l.hit("a", 0))).toEqual([true, true, true]);
    expect(l.hit("a", 10)).toBe(false);
    expect(l.hit("b", 10)).toBe(true); // other keys are independent
    expect(l.hit("a", 1001)).toBe(true); // new window
  });

  it("reports blocked keys without counting", () => {
    const l = new RateLimiter(2, 1000);
    l.hit("a", 0);
    expect(l.isBlocked("a", 1)).toBe(false);
    l.hit("a", 2);
    expect(l.isBlocked("a", 3)).toBe(true);
    expect(l.isBlocked("a", 2000)).toBe(false);
  });
});

describe("secure identifiers", () => {
  it("room codes and tokens are random, well formed and verifiable", () => {
    const codes = new Set(Array.from({ length: 200 }, generateRoomCode));
    expect(codes.size).toBeGreaterThan(190);
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(tokenMatches(token, hashToken(token))).toBe(true);
    expect(tokenMatches(token + "x", hashToken(token))).toBe(false);
    expect(tokenMatches("", hashToken(token))).toBe(false);
  });
});

describe("abuse limits", () => {
  it("limits room creation per IP", () => {
    const m = manager({ maxRooms: 100 });
    const results = Array.from({ length: 7 }, () => m.createRoom(newPeer("7.7.7.7")));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results[5]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    // a different IP is unaffected
    expect(m.createRoom(newPeer("8.8.8.8")).ok).toBe(true);
  });

  it("blocks an IP that keeps guessing room codes, even for a valid code", () => {
    const m = manager();
    const owner = m.createRoom(newPeer("1.1.1.1"));
    if (!owner.ok) throw new Error();
    const guesser = "6.6.6.6";
    for (let i = 0; i < 10; i++) {
      expect(m.joinRoom(newPeer(guesser), "ZZZZZ")).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
    }
    expect(m.joinRoom(newPeer(guesser), owner.code)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(m.joinRoom(newPeer("2.2.2.2"), owner.code).ok).toBe(true);
  });

  it("blocks token guessing as well", () => {
    const m = manager();
    const owner = m.createRoom(newPeer("1.1.1.1"));
    if (!owner.ok) throw new Error();
    const ip = "5.5.5.5";
    for (let i = 0; i < 10; i++) {
      expect(m.resumeRoom(newPeer(ip), owner.code, "B".repeat(22)).ok).toBe(false);
    }
    expect(m.resumeRoom(newPeer(ip), owner.code, owner.token)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("caps the number of rooms", () => {
    const m = manager({ maxRooms: 2 });
    expect(m.createRoom(newPeer("1.1.1.1")).ok).toBe(true);
    expect(m.createRoom(newPeer("1.1.1.2")).ok).toBe(true);
    expect(m.createRoom(newPeer("1.1.1.3"))).toMatchObject({ ok: false, code: "SERVER_FULL" });
  });

  it("throttles a connection that floods messages", () => {
    const m = manager();
    const p = newPeer();
    const allowed = Array.from({ length: 60 }, () => m.allowMessage(p)).filter(Boolean).length;
    expect(allowed).toBe(40);
  });
});
