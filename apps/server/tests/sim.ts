import { ITEM_IDS, PLAYER_COUNT, type ItemId } from "@lastshell/shared";
import { expect } from "vitest";
import {
  applyAction,
  createMatch,
  createSeededRng,
  type Action,
  type EngineEvent,
  type GameState,
  type Rng,
} from "../src/engine";
import { checkEventsMatchState, checkInvariants } from "./invariants";

export interface SimStats {
  accepted: number;
  rejected: number;
  usedItems: Set<ItemId>;
  eliminations: number;
  skips: number;
  reloads: number;
  finished: boolean;
}

/** Random (often illegal) action chosen from the current state, using its own seeded rng. */
export function randomAction(state: GameState, pick: Rng): Action {
  const me = state.players[state.current];
  if (me.items.length > 0 && pick.float() < 0.4) {
    // sometimes aim at a nonexistent slot or with garbage targets to exercise rejections
    const slot = pick.float() < 0.1 ? pick.intInclusive(-1, 9) : pick.int(me.items.length);
    return {
      type: "useItem",
      slot,
      args: {
        target: pick.intInclusive(-1, PLAYER_COUNT),
        stealSlot: pick.intInclusive(-1, 5),
        subTarget: pick.intInclusive(-1, PLAYER_COUNT),
      },
    };
  }
  const alive = state.players.filter((p) => p.alive).map((p) => p.seat);
  const target = pick.float() < 0.05 ? pick.intInclusive(-1, PLAYER_COUNT) : alive[pick.int(alive.length)];
  return { type: "shoot", target };
}

/** Plays one full random game, checking invariants after every single action. */
export function playRandomGame(
  seed: number,
  onStep?: (state: GameState, events: EngineEvent[], seat: number) => void,
  maxActions = 4000,
): SimStats {
  const rng = createSeededRng(seed);
  const pick = createSeededRng(seed ^ 0x9e3779b9);
  const stats: SimStats = {
    accepted: 0,
    rejected: 0,
    usedItems: new Set(),
    eliminations: 0,
    skips: 0,
    reloads: 0,
    finished: false,
  };
  const { state, events: startEvents } = createMatch(rng);
  checkInvariants(state, `seed ${seed} start`);
  checkEventsMatchState(startEvents, state);

  for (let step = 0; step < maxActions && state.phase === "AWAITING"; step++) {
    const seat = state.current;
    const action = randomAction(state, pick);
    const before = JSON.stringify(state);
    // Adrenaline reports the stolen item in its event, so track what was spent from the slot.
    const spent = action.type === "useItem" ? state.players[seat].items[action.slot] : undefined;
    const res = applyAction(state, seat, action, rng);
    if (!res.ok) {
      stats.rejected++;
      expect(JSON.stringify(state), `seed ${seed} step ${step}: rejection changed state`).toBe(before);
      continue;
    }
    stats.accepted++;
    if (spent) stats.usedItems.add(spent);
    for (const ev of res.events) {
      if (ev.type === "eliminated") stats.eliminations++;
      if (ev.type === "skipped") stats.skips++;
      if (ev.type === "reload") stats.reloads++;
    }
    checkInvariants(state, `seed ${seed} step ${step}`);
    checkEventsMatchState(res.events, state);
    onStep?.(state, res.events, seat);
  }
  stats.finished = state.phase === "GAME_OVER";
  return stats;
}
