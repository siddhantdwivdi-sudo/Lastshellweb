import { describe, expect, it } from "vitest";
import { projectEvent, projectLegal, projectPrivate } from "../src/views";
import { act, actFail, makeState, use } from "./helpers";

describe("legal-option hints", () => {
  it("only exist for the player whose turn it is", () => {
    const s = makeState({ items: [["saw"], ["saw"], ["saw"]] });
    expect(projectLegal(s, 0)).not.toBeNull();
    expect(projectLegal(s, 1)).toBeNull();
    expect(projectLegal(s, 2)).toBeNull();
    expect(projectPrivate(s, 1).legal).toBeNull();
  });

  it("are null for a finished game and for a dead current player", () => {
    const over = makeState({ alive: [true, true, false], hp: [3, 1, 3], shells: [true, false], items: [["saw"], [], []] });
    act(over, 0, { type: "shoot", target: 1 });
    expect(projectLegal(over, 0)).toBeNull();
  });

  it("flag unusable items with the engine's own reason", () => {
    const s = makeState({
      items: [["saw", "phone", "handcuffs", "adrenaline"], [], []],
      shells: [true],
      sawed: [true, false, false],
      cuffed: [false, true, true],
    });
    expect(projectLegal(s, 0)!.itemBlocked).toEqual([
      "The hand saw is already active.",
      "No future shells to reveal.",
      "No opponent can be handcuffed right now.",
      "No opponent has an item you can steal.",
    ]);
  });

  it("list who can be cuffed and which opponent items can be stolen", () => {
    const s = makeState({
      items: [["adrenaline"], ["saw", "adrenaline", "cigarettes"], []],
      sawed: [true, false, false],
      cuffed: [false, false, true],
    });
    const legal = projectLegal(s, 0)!;
    expect(legal.cuffTargets).toEqual([1]);
    expect(legal.steal[0]).toBeNull(); // yourself
    expect(legal.steal[1]).toEqual([false, false, true]); // saw (already sawed) / adrenaline / cigarettes
    expect(legal.steal[2]).toEqual([]);
  });

  it("never depend on the hidden shells beyond the public count", () => {
    const a = makeState({ items: [["magnifier", "phone", "beer", "inverter"], [], []], shells: [true, false, true, false] });
    const b = makeState({ items: [["magnifier", "phone", "beer", "inverter"], [], []], shells: [false, true, false, true] });
    expect(JSON.stringify(projectLegal(a, 0))).toBe(JSON.stringify(projectLegal(b, 0)));
  });

  it("are included in projected events for the right player only", () => {
    const s = makeState({ items: [["saw"], ["saw"], []] });
    const events = act(s, 0, use(0));
    const last = events[events.length - 1];
    expect(projectEvent(last, 0).private.legal).not.toBeNull();
    expect(projectEvent(last, 1).private.legal).toBeNull();
    expect(projectEvent(last, 2).private.legal).toBeNull();
  });

  it("are only hints: the server rejects what they say is illegal, and anything else", () => {
    const s = makeState({ items: [["saw", "handcuffs"], [], []], sawed: [true, false, false], cuffed: [false, true, true] });
    const legal = projectLegal(s, 0)!;
    expect(legal.itemBlocked[0]).not.toBeNull();
    expect(actFail(s, 0, use(0)).code).toBe("ITEM_UNUSABLE");
    expect(legal.cuffTargets).toEqual([]);
    expect(actFail(s, 0, use(1, { target: 1 })).code).toBe("ITEM_UNUSABLE");
    // and an "allowed" hint doesn't bypass seat checks
    expect(actFail(s, 1, use(0)).code).toBe("NOT_YOUR_TURN");
  });
});
