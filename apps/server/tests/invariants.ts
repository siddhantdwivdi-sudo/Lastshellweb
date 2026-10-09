import { ITEM_IDS, MAX_HP, MAX_SLOTS, PLAYER_COUNT, START_SLOTS } from "@lastshell/shared";
import { expect } from "vitest";
import type { EngineEvent, GameState } from "../src/engine";

/** Properties that must hold for any state the engine hands back. */
export function checkInvariants(state: GameState, label = ""): void {
  const ctx = (msg: string) => `${label} ${msg}`.trim();
  expect(state.players.length, ctx("player count")).toBe(PLAYER_COUNT);

  for (const p of state.players) {
    expect(p.hp, ctx(`hp bounds P${p.seat}`)).toBeGreaterThanOrEqual(0);
    expect(p.hp, ctx(`hp bounds P${p.seat}`)).toBeLessThanOrEqual(MAX_HP);
    expect(p.alive, ctx(`alive<=>hp>0 P${p.seat}`)).toBe(p.hp > 0);
    expect(p.slots, ctx("slots")).toBeGreaterThanOrEqual(START_SLOTS);
    expect(p.slots, ctx("slots")).toBeLessThanOrEqual(MAX_SLOTS);
    expect(p.items.length, ctx(`items<=slots P${p.seat}`)).toBeLessThanOrEqual(p.slots);
    for (const it of p.items) expect(ITEM_IDS as readonly string[]).toContain(it);
    if (!p.alive) {
      expect(p.items, ctx("dead has no items")).toEqual([]);
      expect(p.sawed, ctx("dead not sawed")).toBe(false);
      expect(p.cuffed, ctx("dead not cuffed")).toBe(false);
    }
  }

  expect(state.observations.length, ctx("observations match shells")).toBe(state.shells.length);
  state.observations.forEach((row, i) => {
    expect(row.length).toBe(PLAYER_COUNT);
    row.forEach((o) => {
      // Only the chamber can be inverted, so only the chamber can hold stale knowledge.
      if (o?.stale) expect(i, ctx("stale only on chamber")).toBe(0);
      // Fresh knowledge must always be accurate.
      if (o && !o.stale) expect(o.live, ctx("fresh knowledge accurate")).toBe(state.shells[i]);
    });
  });
  expect(state.shells.length).toBeLessThanOrEqual(8);

  const alive = state.players.filter((p) => p.alive);
  if (state.phase === "AWAITING") {
    expect(state.winner, ctx("no winner while playing")).toBeNull();
    expect(alive.length, ctx("at least two alive")).toBeGreaterThanOrEqual(2);
    expect(state.shells.length, ctx("magazine never empty while awaiting")).toBeGreaterThanOrEqual(1);
    expect(state.players[state.current].alive, ctx("current alive")).toBe(true);
    expect(state.players[state.current].cuffed, ctx("current not cuffed")).toBe(false);
  } else {
    expect(alive.length, ctx("game over means <=1 alive")).toBeLessThanOrEqual(1);
    expect(state.winner).toBe(alive.length === 1 ? alive[0].seat : -1);
  }
}

/** The last event's snapshot must equal the live state (events are a faithful record). */
export function checkEventsMatchState(events: EngineEvent[], state: GameState): void {
  expect(events.length).toBeGreaterThan(0);
  const last = events[events.length - 1];
  expect(["turnBegan", "gameOver"]).toContain(last.type);
  expect(JSON.stringify(last.after)).toBe(JSON.stringify(state));
}
