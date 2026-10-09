import type { ItemId } from "@lastshell/shared";
import { describe, expect, it } from "vitest";
import { createMatch, createSeededRng } from "../src/engine";
import { checkEventsMatchState, checkInvariants } from "./invariants";
import { act, actFail, makeState, shoot, types } from "./helpers";

describe("match start", () => {
  it("creates 3 players, seat 0 starts, first load dealt", () => {
    const { state, events } = createMatch(createSeededRng(5));
    expect(state.phase).toBe("AWAITING");
    expect(state.current).toBe(0);
    expect(state.loadNumber).toBe(1);
    expect(state.winner).toBeNull();
    for (const p of state.players) {
      expect(p.hp).toBe(3);
      expect(p.slots).toBe(4); // no extra slot on the first load
      expect(p.items.length).toBe(2);
      expect(p.alive).toBe(true);
    }
    expect(types(events)).toEqual(["matchStarted", "reload", "turnBegan"]);
    const turn = events[2];
    expect(turn.type === "turnBegan" && turn.announce && turn.seat === 0).toBe(true);
    checkInvariants(state);
    checkEventsMatchState(events, state);
  });

  it("restart gives a completely fresh match even after a finished game", () => {
    const old = makeState({ hp: [3, 1, 3], alive: [true, true, false], shells: [true, false] });
    act(old, 0, shoot(1));
    expect(old.phase).toBe("GAME_OVER");
    const { state } = createMatch(createSeededRng(9));
    expect(state.phase).toBe("AWAITING");
    expect(state.loadNumber).toBe(1);
    expect(state.current).toBe(0);
    expect(state.players.every((p) => p.alive && p.hp === 3)).toBe(true);
  });
});

describe("reload", () => {
  it("fires after the last shell: new load, +1 slot, +2 items, effects cleared, HP kept", () => {
    const state = makeState({
      shells: [false],
      hp: [3, 2, 1],
      sawed: [false, false, true],
      cuffed: [false, false, true], // P2 is not next, so the cuff survives until the reload
    });
    const events = act(state, 0, shoot(1), createSeededRng(11));
    expect(types(events)).toEqual(["shotFired", "shotResolved", "reload", "turnBegan"]);
    expect(state.loadNumber).toBe(2);
    expect(state.current).toBe(1);
    expect(state.players.map((p) => p.hp)).toEqual([3, 2, 1]);
    for (const p of state.players) {
      expect(p.slots).toBe(5);
      expect(p.items.length).toBe(2);
      expect(p.sawed).toBe(false);
      expect(p.cuffed).toBe(false);
    }
    const turn = events[3];
    expect(turn.type === "turnBegan" && turn.announce).toBe(true);
    expect(state.fired).toBe(0);
    checkInvariants(state);
  });

  it("does not give slots or items to dead players", () => {
    const state = makeState({ shells: [false], alive: [true, true, false] });
    act(state, 0, shoot(1), createSeededRng(3));
    expect(state.players[2].items).toEqual([]);
    expect(state.players[2].slots).toBe(4);
  });

  it("caps slots at 8 and stops dealing when the inventory is full", () => {
    const full: ItemId[][] = [["saw", "saw", "saw", "saw"], [], []];
    const state = makeState({ shells: [false], items: full, slots: [4, 8, 4] });
    act(state, 0, shoot(1), createSeededRng(3));
    expect(state.players[0].slots).toBe(5);
    expect(state.players[0].items.length).toBe(5); // only one free slot after unlocking
    expect(state.players[1].slots).toBe(8);
    expect(state.players[1].items.length).toBe(2);
  });

  it("a blank at yourself on the last shell keeps the turn and reloads", () => {
    const state = makeState({ shells: [false] });
    const events = act(state, 0, shoot(0), createSeededRng(2));
    expect(state.current).toBe(0);
    expect(state.loadNumber).toBe(2);
    const turn = events[events.length - 1];
    expect(turn.type === "turnBegan" && !turn.announce).toBe(true);
  });

  it("is rejected when it is not your turn and leaves state untouched", () => {
    const state = makeState();
    expect(actFail(state, 1, shoot(0)).code).toBe("NOT_YOUR_TURN");
  });
});
