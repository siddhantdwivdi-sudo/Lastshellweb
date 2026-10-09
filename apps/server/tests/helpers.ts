import { PLAYER_COUNT, type ItemId } from "@lastshell/shared";
import { expect } from "vitest";
import { createPlayer } from "../src/engine/player";
import { emptyObservations } from "../src/engine/shotgun";
import type { Action, EngineEvent, GameState, ItemArgs, Observation, Rng } from "../src/engine";
import { applyAction } from "../src/engine";

export interface Setup {
  shells?: boolean[];
  current?: number;
  hp?: number[];
  items?: ItemId[][];
  slots?: number[];
  alive?: boolean[];
  sawed?: boolean[];
  cuffed?: boolean[];
  loadNumber?: number;
  fired?: number;
}

/** Builds an exact mid-game state so each rule can be tested in isolation. */
export function makeState(s: Setup = {}): GameState {
  const shells = s.shells ?? [true, false, true, false];
  const players = Array.from({ length: PLAYER_COUNT }, (_, i) => {
    const p = createPlayer(i);
    p.hp = s.hp?.[i] ?? 3;
    p.slots = s.slots?.[i] ?? 4;
    p.items = [...(s.items?.[i] ?? [])];
    p.alive = s.alive?.[i] ?? true;
    p.sawed = s.sawed?.[i] ?? false;
    p.cuffed = s.cuffed?.[i] ?? false;
    if (!p.alive) {
      p.hp = 0;
      p.items = [];
    }
    return p;
  });
  return {
    phase: "AWAITING",
    players,
    shells: [...shells],
    observations: emptyObservations(shells.length),
    fired: s.fired ?? 0,
    current: s.current ?? 0,
    loadNumber: s.loadNumber ?? 1,
    winner: null,
  };
}

/** Rng that returns scripted values; falls back to 0 so unscripted calls stay deterministic. */
export function scriptedRng(script: { floats?: number[]; ints?: number[] } = {}): Rng {
  const floats = [...(script.floats ?? [])];
  const ints = [...(script.ints ?? [])];
  return {
    float: () => floats.shift() ?? 0,
    int: (max: number) => Math.min(ints.shift() ?? 0, max - 1),
    intInclusive: (min: number, max: number) => Math.min(min + (ints.shift() ?? 0), max),
    shuffle: () => {},
  };
}

/** A scripted rng for tests that must never reach a reload. */
export const noRng: Rng = scriptedRng();

export function act(state: GameState, seat: number, action: Action, rng: Rng = noRng): EngineEvent[] {
  const res = applyAction(state, seat, action, rng);
  if (!res.ok) throw new Error(`expected success but got ${res.code}: ${res.message}`);
  return res.events;
}

export function actFail(state: GameState, seat: number, action: Action, rng: Rng = noRng) {
  const before = JSON.stringify(state);
  const res = applyAction(state, seat, action, rng);
  if (res.ok) throw new Error("expected failure but action succeeded");
  // A rejected action must not change anything at all.
  expect(JSON.stringify(state)).toBe(before);
  return res;
}

export function types(events: EngineEvent[]): string[] {
  return events.map((e) => e.type);
}

export function obs(live: boolean, stale = false): Observation {
  return { live, stale };
}

export function shoot(target: number): Action {
  return { type: "shoot", target };
}

export function use(slot: number, args: ItemArgs = {}): Action {
  return { type: "useItem", slot, args };
}
