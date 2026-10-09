import { describe, expect, it } from "vitest";
import { act, actFail, makeState, shoot, types } from "./helpers";

describe("shooting an opponent", () => {
  it("live: 1 damage, turn passes to the next seat", () => {
    const s = makeState({ shells: [true, false, false, false] });
    const ev = act(s, 0, shoot(1));
    expect(s.players[1].hp).toBe(2);
    expect(s.current).toBe(1);
    expect(types(ev)).toEqual(["shotFired", "shotResolved", "turnBegan"]);
    const res = ev[1];
    expect(res.type === "shotResolved" && res.message).toBe("PLAYER 1 shoots PLAYER 2: LIVE! -1 HP");
  });

  it("blank: no damage but the turn still ends", () => {
    const s = makeState({ shells: [false, true, true] });
    act(s, 0, shoot(2));
    expect(s.players[2].hp).toBe(3);
    expect(s.current).toBe(1);
    expect(s.shells.length).toBe(2);
    expect(s.fired).toBe(1);
  });
});

describe("shooting yourself", () => {
  it("blank keeps your turn", () => {
    const s = makeState({ shells: [false, true, true] });
    const ev = act(s, 0, shoot(0));
    expect(s.current).toBe(0);
    expect(s.players[0].hp).toBe(3);
    const res = ev[1];
    expect(res.type === "shotResolved" && res.message).toBe("PLAYER 1 shoots THEMSELVES: BLANK. Shoot again!");
    const turn = ev[2];
    expect(turn.type === "turnBegan" && turn.announce).toBe(false);
  });

  it("live hurts you and ends the turn", () => {
    const s = makeState({ shells: [true, false, false] });
    act(s, 0, shoot(0));
    expect(s.players[0].hp).toBe(2);
    expect(s.current).toBe(1);
  });
});

describe("hand saw", () => {
  it("doubles a live shot and is consumed", () => {
    const s = makeState({ shells: [true, false, false], sawed: [true, false, false] });
    act(s, 0, shoot(1));
    expect(s.players[1].hp).toBe(1);
    expect(s.players[0].sawed).toBe(false);
  });

  it("is kept after a blank", () => {
    const s = makeState({ shells: [false, true, false], sawed: [true, false, false] });
    act(s, 0, shoot(1));
    expect(s.players[0].sawed).toBe(true);
  });

  it("is consumed by a live self-shot, which deals 2", () => {
    const s = makeState({ shells: [true, false, false], sawed: [true, false, false] });
    act(s, 0, shoot(0));
    expect(s.players[0].hp).toBe(1);
    expect(s.players[0].sawed).toBe(false);
  });

  it("HP never drops below zero", () => {
    const s = makeState({ shells: [true, false, false], hp: [3, 1, 3], sawed: [true, false, false] });
    act(s, 0, shoot(1));
    expect(s.players[1].hp).toBe(0);
  });
});

describe("turn order", () => {
  it("goes 0 -> 1 -> 2 -> 0", () => {
    const s = makeState({ shells: Array(8).fill(false) });
    act(s, 0, shoot(1));
    expect(s.current).toBe(1);
    act(s, 1, shoot(2));
    expect(s.current).toBe(2);
    act(s, 2, shoot(0));
    expect(s.current).toBe(0);
  });

  it("skips eliminated seats", () => {
    const s = makeState({ shells: Array(8).fill(false), alive: [true, false, true] });
    act(s, 0, shoot(2));
    expect(s.current).toBe(2);
    act(s, 2, shoot(0));
    expect(s.current).toBe(0);
  });
});

describe("rejected shots", () => {
  it("wrong seat, bad targets, dead target", () => {
    const s = makeState({ alive: [true, true, false] });
    expect(actFail(s, 1, shoot(0)).code).toBe("NOT_YOUR_TURN");
    expect(actFail(s, 0, shoot(-1)).code).toBe("INVALID_TARGET");
    expect(actFail(s, 0, shoot(3)).code).toBe("INVALID_TARGET");
    expect(actFail(s, 0, shoot(1.5)).code).toBe("INVALID_TARGET");
    expect(actFail(s, 0, shoot(Number.NaN)).code).toBe("INVALID_TARGET");
    const dead = actFail(s, 0, shoot(2));
    expect(dead.code).toBe("TARGET_ELIMINATED");
    expect(dead.message).toBe("PLAYER 3 is already eliminated.");
  });

  it("an out-of-range seat is not a turn", () => {
    const s = makeState();
    expect(actFail(s, -1, shoot(0)).code).toBe("NOT_YOUR_TURN");
    expect(actFail(s, 7, shoot(0)).code).toBe("NOT_YOUR_TURN");
  });
});

describe("elimination and victory", () => {
  it("clears the dead player's items and effects and continues with the rest", () => {
    const s = makeState({
      shells: [true, false],
      hp: [3, 1, 3],
      items: [[], ["saw", "beer"], []],
      sawed: [false, true, false],
    });
    const ev = act(s, 0, shoot(1));
    expect(types(ev)).toEqual(["shotFired", "shotResolved", "eliminated", "turnBegan"]);
    const p1 = s.players[1];
    expect(p1.alive).toBe(false);
    expect(p1.hp).toBe(0);
    expect(p1.items).toEqual([]);
    expect(p1.sawed).toBe(false);
    expect(s.phase).toBe("AWAITING");
    expect(s.current).toBe(2); // 0 ended the turn, 1 is dead, so 2
  });

  it("self-elimination passes the turn on", () => {
    const s = makeState({ shells: [true, false], hp: [1, 3, 3] });
    const ev = act(s, 0, shoot(0));
    expect(types(ev)).toContain("eliminated");
    expect(s.players[0].alive).toBe(false);
    expect(s.current).toBe(1);
  });

  it("last survivor wins and the game is locked", () => {
    const s = makeState({ shells: [true, false], hp: [3, 1, 3], alive: [true, true, false] });
    const ev = act(s, 0, shoot(1));
    expect(types(ev)).toEqual(["shotFired", "shotResolved", "eliminated", "gameOver"]);
    expect(s.phase).toBe("GAME_OVER");
    expect(s.winner).toBe(0);
    expect(actFail(s, 0, shoot(0)).code).toBe("WRONG_PHASE");
    expect(actFail(s, 0, { type: "useItem", slot: 0 }).code).toBe("WRONG_PHASE");
  });
});
