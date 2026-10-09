import { describe, expect, it } from "vitest";
import { forfeitPlayer } from "../src/engine";
import { checkEventsMatchState, checkInvariants } from "./invariants";
import { makeState, noRng, types } from "./helpers";

describe("forfeitPlayer", () => {
  it("eliminates a waiting player and keeps the current turn", () => {
    const s = makeState({ items: [[], ["saw"], []], current: 0 });
    const ev = forfeitPlayer(s, 1, noRng);
    expect(types(ev)).toEqual(["eliminated", "turnBegan"]);
    expect(s.players[1].alive).toBe(false);
    expect(s.players[1].items).toEqual([]);
    expect(s.current).toBe(0);
    checkInvariants(s);
    checkEventsMatchState(ev, s);
  });

  it("passes the turn on when the current player forfeits", () => {
    const s = makeState({ current: 0 });
    const ev = forfeitPlayer(s, 0, noRng);
    expect(types(ev)).toEqual(["eliminated", "turnBegan"]);
    expect(s.current).toBe(1);
    const turn = ev[1];
    expect(turn.type === "turnBegan" && turn.announce).toBe(true);
  });

  it("skips a cuffed next player as usual", () => {
    const s = makeState({ current: 0, cuffed: [false, true, false] });
    const ev = forfeitPlayer(s, 0, noRng);
    expect(types(ev)).toEqual(["eliminated", "skipped", "turnBegan"]);
    expect(s.current).toBe(2);
  });

  it("ends the game when only one player remains", () => {
    const s = makeState({ alive: [true, true, false] });
    const ev = forfeitPlayer(s, 1, noRng);
    expect(types(ev)).toEqual(["eliminated", "gameOver"]);
    expect(s.phase).toBe("GAME_OVER");
    expect(s.winner).toBe(0);
  });

  it("does nothing for dead players, finished games or bad seats", () => {
    const s = makeState({ alive: [true, true, false] });
    expect(forfeitPlayer(s, 2, noRng)).toEqual([]);
    expect(forfeitPlayer(s, 9, noRng)).toEqual([]);
    forfeitPlayer(s, 1, noRng);
    expect(forfeitPlayer(s, 0, noRng)).toEqual([]);
  });
});
