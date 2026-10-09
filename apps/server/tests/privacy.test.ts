import { S2C, type ActionBody } from "@lastshell/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createSeededRng } from "../src/engine";
import { randomAction } from "./sim";
import { FORBIDDEN_KEYS, collectKeys, makeMatch, newManager, send, type Lobby } from "./room-helpers";

let lobby: Lobby | undefined;
afterEach(() => lobby?.manager.shutdown());

/** Plays a whole random match through the real room layer, like three clients would. */
function playThrough(seed: number): Lobby {
  lobby = makeMatch(newManager({ busyScale: 0 }, seed));
  const pick = createSeededRng(seed + 1000);
  for (let step = 0; step < 4000 && lobby.room.status === "IN_MATCH"; step++) {
    const game = lobby.room.game!;
    const action = randomAction(game, pick);
    send(lobby, lobby.peers[game.current], action as ActionBody);
    // also exercise the reconnect snapshot path along the way
    if (step % 17 === 0) {
      for (let seat = 0; seat < 3; seat++) {
        const snap = lobby.room.snapshotFor(seat)!;
        for (const bad of FORBIDDEN_KEYS) expect(collectKeys(snap).has(bad)).toBe(false);
      }
    }
  }
  expect(lobby.room.status).toBe("GAME_OVER");
  return lobby;
}

describe("nothing hidden reaches any player over the room layer", () => {
  it("never sends the shell order, observations or engine-only fields to anyone", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const l = playThrough(seed);
      for (const peer of l.peers) {
        for (const msg of peer.sent) {
          const keys = collectKeys(msg.payload);
          for (const bad of FORBIDDEN_KEYS) {
            expect(keys.has(bad), `seed ${seed}: "${bad}" in ${msg.event}`).toBe(false);
          }
        }
      }
      l.manager.shutdown();
    }
  });

  it("only the player who used a Magnifying Glass or Burner Phone ever receives the result", () => {
    let reveals = 0;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const l = playThrough(seed);
      for (const peer of l.peers) {
        for (const payload of peer.all(S2C.events)) {
          for (const ev of payload.events) {
            if (ev.type !== "itemUsed") continue;
            if (ev.reveal) {
              expect(ev.seat, `seed ${seed}`).toBe(peer.seat);
              reveals++;
            } else if ((ev.item === "magnifier" || ev.item === "phone") && ev.seat !== peer.seat) {
              expect(ev.text).not.toMatch(/LIVE|BLANK|Shell #/);
            }
          }
        }
      }
      l.manager.shutdown();
    }
    expect(reveals).toBeGreaterThan(0);
  });

  it("the public part of every event is identical for all three players", () => {
    const l = playThrough(21);
    const streams = l.peers.map((p) => p.all(S2C.events).flatMap((pl) => pl.events.map((e: any) => e.view)));
    expect(streams[0].length).toBeGreaterThan(20);
    expect(JSON.stringify(streams[1])).toBe(JSON.stringify(streams[0]));
    expect(JSON.stringify(streams[2])).toBe(JSON.stringify(streams[0]));
  });

  it("each player's private knowledge only ever contains that player's own observations", () => {
    const l = playThrough(31);
    // Every shell number a player is told about must come from one of THEIR OWN reveals.
    for (const peer of l.peers) {
      const revealed = new Set<string>();
      for (const payload of peer.all(S2C.events)) {
        for (const ev of payload.events) {
          if (ev.type === "reload") revealed.clear(); // new load, new shells
          if (ev.type === "itemUsed" && ev.reveal) revealed.add(String(ev.reveal.shellNumber));
          for (const k of ev.private.knownShells) {
            expect(revealed.has(String(k.shellNumber)), `seat ${peer.seat} knew #${k.shellNumber} without a reveal`).toBe(
              true,
            );
          }
        }
      }
    }
  });
});
