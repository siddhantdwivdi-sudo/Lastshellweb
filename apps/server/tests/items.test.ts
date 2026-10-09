import { describe, expect, it } from "vitest";
import { createSeededRng, type ItemArgs } from "../src/engine";
import { act, actFail, makeState, obs, scriptedRng, shoot, types, use } from "./helpers";

function itemEvent(events: ReturnType<typeof act>) {
  const ev = events.find((e) => e.type === "itemUsed");
  if (!ev || ev.type !== "itemUsed") throw new Error("no itemUsed event");
  return ev;
}

describe("item validation", () => {
  it("bad slots and unknown inventory", () => {
    const s = makeState({ items: [["saw"], [], []] });
    expect(actFail(s, 0, use(1)).code).toBe("INVALID_SLOT");
    expect(actFail(s, 0, use(-1)).code).toBe("INVALID_SLOT");
    expect(actFail(s, 0, use(0.5)).code).toBe("INVALID_SLOT");
  });

  it("non-integer args are treated as no choice", () => {
    const s = makeState({ items: [["handcuffs"], [], []] });
    const bad = { target: "1" } as unknown as ItemArgs;
    expect(actFail(s, 0, use(0, bad)).message).toBe("Pick an opponent who isn't already handcuffed.");
  });

  it("a rejected item is not consumed", () => {
    const s = makeState({ items: [["saw", "saw"], [], []], sawed: [true, false, false] });
    expect(actFail(s, 0, use(0)).message).toBe("The hand saw is already active.");
    expect(s.players[0].items.length).toBe(2);
  });
});

describe("magnifying glass", () => {
  it("records the observation, reveals only to the user, keeps the turn", () => {
    const s = makeState({ items: [["magnifier"], [], []], shells: [true, false, false] });
    const ev = act(s, 0, use(0));
    expect(types(ev)).toEqual(["itemUsed", "turnBegan"]);
    const used = itemEvent(ev);
    expect(used.reveal).toEqual({ kind: "chamber", shellNumber: 1, live: true });
    expect(used.publicText).toBe("PLAYER 1 inspects the chamber.");
    expect(used.privateText).toBe("PLAYER 1 inspects the chamber: LIVE");
    expect(s.observations[0][0]).toEqual(obs(true));
    expect(s.observations[0][1]).toBeNull();
    expect(s.players[0].items).toEqual([]);
    expect(s.current).toBe(0);
  });

  it("uses the load-relative shell number after shells were fired", () => {
    const s = makeState({ items: [["magnifier"], [], []], shells: [false, true], fired: 3 });
    expect(itemEvent(act(s, 0, use(0))).reveal?.shellNumber).toBe(4);
  });
});

describe("beer", () => {
  it("ejects a live shell, publicly, and keeps the turn", () => {
    const s = makeState({ items: [["beer"], [], []], shells: [true, false, false] });
    const used = itemEvent(act(s, 0, use(0)));
    expect(used.eject).toBe(1);
    expect(used.publicText).toBe("PLAYER 1 ejects a LIVE shell.");
    expect(s.shells).toEqual([false, false]);
    expect(s.fired).toBe(1);
    expect(s.current).toBe(0);
  });

  it("ejects a blank shell and discards the observation of it", () => {
    const s = makeState({ items: [["beer"], [], []], shells: [false, true, false] });
    s.observations[0][1] = obs(false);
    expect(itemEvent(act(s, 0, use(0))).eject).toBe(0);
    expect(s.observations.length).toBe(2);
    expect(s.observations.every((row) => row.every((o) => o === null))).toBe(true);
  });

  it("ejecting the final shell reloads and keeps the turn without an announcement", () => {
    const s = makeState({ items: [["beer"], [], []], shells: [true] });
    const ev = act(s, 0, use(0), createSeededRng(4));
    expect(types(ev)).toEqual(["itemUsed", "reload", "turnBegan"]);
    expect(s.loadNumber).toBe(2);
    expect(s.current).toBe(0);
    const turn = ev[2];
    expect(turn.type === "turnBegan" && !turn.announce).toBe(true);
  });
});

describe("hand saw", () => {
  it("arms the saw", () => {
    const s = makeState({ items: [["saw"], [], []] });
    act(s, 0, use(0));
    expect(s.players[0].sawed).toBe(true);
    expect(s.current).toBe(0);
  });
});

describe("cigarettes", () => {
  it("heals 1 HP", () => {
    const s = makeState({ items: [["cigarettes"], [], []], hp: [2, 3, 3] });
    const used = itemEvent(act(s, 0, use(0)));
    expect(s.players[0].hp).toBe(3);
    expect(used.hpChange).toBe(1);
    expect(used.publicText).toBe("PLAYER 1 smokes a cigarette. +1 HP");
  });

  it("is consumed with no effect at full HP", () => {
    const s = makeState({ items: [["cigarettes"], [], []] });
    const used = itemEvent(act(s, 0, use(0)));
    expect(s.players[0].hp).toBe(3);
    expect(used.hpChange).toBe(0);
    expect(used.publicText).toBe("PLAYER 1 smokes at full health. No effect.");
    expect(s.players[0].items).toEqual([]);
  });
});

describe("handcuffs", () => {
  it("cuffs an opponent, who then skips exactly one turn", () => {
    const s = makeState({ items: [["handcuffs"], [], []], shells: Array(8).fill(false) });
    act(s, 0, use(0, { target: 1 }));
    expect(s.players[1].cuffed).toBe(true);
    expect(s.current).toBe(0);
    const ev = act(s, 0, shoot(2));
    expect(types(ev)).toEqual(["shotFired", "shotResolved", "skipped", "turnBegan"]);
    expect(s.players[1].cuffed).toBe(false);
    expect(s.current).toBe(2);
    act(s, 2, shoot(0));
    act(s, 0, shoot(1));
    expect(s.current).toBe(1); // no longer skipped
  });

  it("with two players left, the cuffed opponent is skipped and the turn returns to you", () => {
    const s = makeState({
      items: [["handcuffs"], [], []],
      alive: [true, true, false],
      shells: Array(8).fill(false),
    });
    act(s, 0, use(0, { target: 1 }));
    const ev = act(s, 0, shoot(1));
    expect(types(ev)).toEqual(["shotFired", "shotResolved", "skipped", "turnBegan"]);
    expect(s.current).toBe(0);
    const turn = ev[3];
    expect(turn.type === "turnBegan" && turn.announce).toBe(true);
  });

  it("rejects bad targets", () => {
    const s = makeState({
      items: [["handcuffs"], [], []],
      alive: [true, true, false],
      cuffed: [false, true, false],
    });
    expect(actFail(s, 0, use(0, { target: 1 })).message).toBe("No opponent can be handcuffed right now.");
    const t = makeState({ items: [["handcuffs"], [], []], cuffed: [false, true, false] });
    expect(actFail(t, 0, use(0, { target: 1 })).message).toBe("Pick an opponent who isn't already handcuffed.");
    expect(actFail(t, 0, use(0, { target: 0 })).message).toBe("Pick an opponent who isn't already handcuffed.");
    expect(actFail(t, 0, use(0, {})).code).toBe("ITEM_UNUSABLE");
  });

  it("quirk: a cuff placed before an item ejects the last shell is wasted by the reload", () => {
    const s = makeState({ items: [["handcuffs", "beer"], [], []], shells: [true] });
    act(s, 0, use(0, { target: 1 }));
    act(s, 0, use(0), createSeededRng(8)); // beer ejects the last shell -> reload
    expect(s.players[1].cuffed).toBe(false);
    expect(s.current).toBe(0);
  });

  it("quirk: shooting the last shell still consumes the cuff before the reload", () => {
    const s = makeState({ items: [["handcuffs"], [], []], shells: [false] });
    act(s, 0, use(0, { target: 1 }));
    const ev = act(s, 0, shoot(2), createSeededRng(8));
    expect(types(ev)).toEqual(["shotFired", "shotResolved", "skipped", "reload", "turnBegan"]);
    expect(s.current).toBe(2);
  });
});

describe("burner phone", () => {
  it("needs at least two shells", () => {
    const s = makeState({ items: [["phone"], [], []], shells: [true] });
    expect(actFail(s, 0, use(0)).message).toBe("No future shells to reveal.");
  });

  it("reveals a future shell privately with its load shell number", () => {
    const s = makeState({ items: [["phone"], [], []], shells: [true, false, true, false] });
    const used = itemEvent(act(s, 0, use(0), scriptedRng({ ints: [1] })));
    expect(used.reveal).toEqual({ kind: "future", shellNumber: 3, live: true });
    expect(used.publicText).toBe("PLAYER 1 uses a burner phone.");
    expect(used.privateText).toBe("Shell #3: LIVE");
    expect(s.observations[2][0]).toEqual(obs(true));
  });

  it("never reveals the chamber", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = makeState({ items: [["phone"], [], []], shells: [true, false, true, false, true] });
      const used = itemEvent(act(s, 0, use(0), createSeededRng(seed)));
      expect(used.reveal!.shellNumber).toBeGreaterThanOrEqual(2);
      expect(s.observations[0][0]).toBeNull();
    }
  });

  it("prefers shells the user has not seen yet", () => {
    const s = makeState({ items: [["phone"], [], []], shells: [true, false, true, false] });
    s.observations[1][0] = obs(false);
    s.observations[2][0] = obs(true);
    const used = itemEvent(act(s, 0, use(0), scriptedRng({ ints: [0] })));
    expect(used.reveal?.shellNumber).toBe(4);
  });

  it("falls back to any future shell when all are already known", () => {
    const s = makeState({ items: [["phone"], [], []], shells: [true, false, true] });
    s.observations[1][0] = obs(false);
    s.observations[2][0] = obs(true);
    const used = itemEvent(act(s, 0, use(0), scriptedRng({ ints: [1] })));
    expect(used.reveal?.shellNumber).toBe(3);
  });
});

describe("expired medicine", () => {
  it("heals 2 on a good roll (capped at max HP)", () => {
    const s = makeState({ items: [["medicine"], [], []], hp: [1, 3, 3] });
    const used = itemEvent(act(s, 0, use(0), scriptedRng({ floats: [0.2] })));
    expect(s.players[0].hp).toBe(3);
    expect(used.hpChange).toBe(2);
    expect(used.publicText).toBe("PLAYER 1 takes the medicine. It works! +2 HP");

    const t = makeState({ items: [["medicine"], [], []], hp: [2, 3, 3] });
    expect(itemEvent(act(t, 0, use(0), scriptedRng({ floats: [0.2] }))).hpChange).toBe(1);
  });

  it("does nothing at full HP on a good roll", () => {
    const s = makeState({ items: [["medicine"], [], []] });
    const used = itemEvent(act(s, 0, use(0), scriptedRng({ floats: [0.2] })));
    expect(used.publicText).toBe("PLAYER 1 takes the medicine at full health. Nothing happens.");
  });

  it("costs 1 HP on a bad roll", () => {
    const s = makeState({ items: [["medicine"], [], []] });
    const used = itemEvent(act(s, 0, use(0), scriptedRng({ floats: [0.5] })));
    expect(s.players[0].hp).toBe(2);
    expect(used.hpChange).toBe(-1);
    expect(used.publicText).toBe("PLAYER 1 takes the medicine. It's expired! -1 HP");
  });

  it("can kill its user, which eliminates them and passes the turn", () => {
    const s = makeState({ items: [["medicine"], [], []], hp: [1, 3, 3] });
    const ev = act(s, 0, use(0), scriptedRng({ floats: [0.9] }));
    expect(types(ev)).toEqual(["itemUsed", "eliminated", "turnBegan"]);
    expect(s.players[0].alive).toBe(false);
    expect(s.current).toBe(1);
  });
});

describe("inverter", () => {
  it("flips the chamber shell, both directions", () => {
    const s = makeState({ items: [["inverter", "inverter"], [], []], shells: [true, false] });
    act(s, 0, use(0));
    expect(s.shells[0]).toBe(false);
    act(s, 0, use(0));
    expect(s.shells[0]).toBe(true);
    expect(s.current).toBe(0);
  });

  it("changes the outcome of the next shot", () => {
    const s = makeState({ items: [["inverter"], [], []], shells: [true, false, false] });
    act(s, 0, use(0));
    act(s, 0, shoot(1));
    expect(s.players[1].hp).toBe(3);
  });
});

describe("adrenaline", () => {
  it("steals an item and uses it immediately", () => {
    const s = makeState({ items: [["adrenaline"], ["cigarettes", "saw"], []], hp: [2, 3, 3] });
    const used = itemEvent(act(s, 0, use(0, { target: 1, stealSlot: 0 })));
    expect(used.item).toBe("cigarettes");
    expect(used.publicText).toBe("PLAYER 1 steals CIGARETTES from PLAYER 2. PLAYER 1 smokes a cigarette. +1 HP");
    expect(s.players[0].hp).toBe(3);
    expect(s.players[0].items).toEqual([]);
    expect(s.players[1].items).toEqual(["saw"]);
    expect(s.current).toBe(0);
  });

  it("can steal handcuffs when a second target is chosen", () => {
    const s = makeState({ items: [["adrenaline"], ["handcuffs"], []] });
    expect(actFail(s, 0, use(0, { target: 1, stealSlot: 0 })).message).toBe("Pick an opponent to handcuff.");
    act(s, 0, use(0, { target: 1, stealSlot: 0, subTarget: 2 }));
    expect(s.players[2].cuffed).toBe(true);
    expect(s.players[1].items).toEqual([]);
  });

  it("cannot steal another adrenaline or an item that is unusable right now", () => {
    const a = makeState({ items: [["adrenaline"], ["adrenaline"], []] });
    expect(actFail(a, 0, use(0, { target: 1, stealSlot: 0 })).message).toBe(
      "No opponent has an item you can steal.",
    );
    const b = makeState({ items: [["adrenaline"], ["saw", "cigarettes"], []], sawed: [true, false, false] });
    expect(actFail(b, 0, use(0, { target: 1, stealSlot: 0 })).message).toBe("You can't steal that item right now.");
    expect(actFail(b, 0, use(0, { target: 1, stealSlot: 5 })).message).toBe("Pick an item to steal.");
    expect(actFail(b, 0, use(0, { target: 2, stealSlot: 0 })).message).toBe(
      "Pick an opponent who has a stealable item.",
    );
    expect(actFail(b, 0, use(0, { target: 0, stealSlot: 0 })).code).toBe("ITEM_UNUSABLE");
  });

  it("can steal a magnifier; only the thief learns the shell", () => {
    const s = makeState({ items: [["adrenaline"], ["magnifier"], []], shells: [false, true] });
    const used = itemEvent(act(s, 0, use(0, { target: 1, stealSlot: 0 })));
    expect(used.item).toBe("magnifier");
    expect(used.reveal).toEqual({ kind: "chamber", shellNumber: 1, live: false });
    expect(used.publicText).not.toMatch(/LIVE|BLANK/);
    expect(s.observations[0][0]).toEqual(obs(false));
  });
});
