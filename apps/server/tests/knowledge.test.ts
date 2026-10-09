import { describe, expect, it } from "vitest";
import { projectEvent, projectPrivate, projectPublic } from "../src/views";
import { act, makeState, obs, shoot, use } from "./helpers";

// Decision (option B): players keep what they actually saw. An Inverter makes that knowledge
// stale and the current value is never sent.

describe("inverter makes observations stale", () => {
  it("marks every observer's knowledge of the chamber stale without revealing the new value", () => {
    const s = makeState({ items: [["inverter"], [], []], shells: [true, false, true] });
    s.observations[0][1] = obs(true); // P2 looked at the live chamber earlier
    s.observations[0][2] = obs(true); // so did P3
    act(s, 0, use(0));
    expect(s.shells[0]).toBe(false);

    for (const seat of [1, 2]) {
      const priv = projectPrivate(s, seat);
      expect(priv.knownShells).toEqual([{ position: 0, shellNumber: 1, observedLive: true, stale: true }]);
    }
    // Nothing public changed except the item list.
    expect(JSON.stringify(projectPublic(s))).not.toContain("observed");
  });

  it("updates the inverting player's own fresh observation to the new value", () => {
    const s = makeState({ items: [["inverter"], [], []], shells: [true, false] });
    s.observations[0][0] = obs(true);
    s.observations[0][1] = obs(true);
    act(s, 0, use(0));
    expect(s.shells[0]).toBe(false);
    expect(projectPrivate(s, 0).knownShells).toEqual([
      { position: 0, shellNumber: 1, observedLive: false, stale: false },
    ]);
    // ...while the other observer keeps the OLD value, marked stale.
    expect(projectPrivate(s, 1).knownShells).toEqual([
      { position: 0, shellNumber: 1, observedLive: true, stale: true },
    ]);
  });

  it("does not hand the inverting player the true value when their own knowledge was already stale", () => {
    const s = makeState({ items: [["inverter"], [], []], shells: [false, true] });
    s.observations[0][0] = obs(true, true); // was LIVE, someone inverted since
    act(s, 0, use(0));
    expect(projectPrivate(s, 0).knownShells).toEqual([
      { position: 0, shellNumber: 1, observedLive: true, stale: true },
    ]);
  });

  it("does not give an inverting player who never looked any knowledge", () => {
    const s = makeState({ items: [["inverter"], [], []], shells: [true, false] });
    act(s, 0, use(0));
    expect(projectPrivate(s, 0).knownShells).toEqual([]);
  });

  it("leaves players who never looked with nothing", () => {
    const s = makeState({ items: [["inverter"], [], []], shells: [true, false] });
    s.observations[0][1] = obs(true);
    act(s, 0, use(0));
    expect(projectPrivate(s, 2).knownShells).toEqual([]);
    expect(projectPrivate(s, 0).knownShells).toEqual([]);
  });

  it("stays stale after a second inversion (no parity leak)", () => {
    const s = makeState({ items: [["inverter", "inverter"], [], []], shells: [true, false] });
    s.observations[0][1] = obs(true);
    act(s, 0, use(0));
    act(s, 0, use(0));
    expect(s.shells[0]).toBe(true);
    expect(projectPrivate(s, 1).knownShells[0].stale).toBe(true);
  });

  it("a fresh look makes the knowledge current again", () => {
    const s = makeState({ items: [["inverter"], ["magnifier"], []], shells: [true, false] });
    s.observations[0][1] = obs(true);
    act(s, 0, use(0));
    act(s, 0, shoot(2)); // blank? no: chamber is now blank after inversion, so the turn passes
    // chamber now holds the old second shell; P2's stale knowledge was for the fired shell
    expect(projectPrivate(s, 1).knownShells).toEqual([]);
    act(s, 1, use(0));
    expect(projectPrivate(s, 1).knownShells).toEqual([
      { position: 0, shellNumber: 2, observedLive: false, stale: false },
    ]);
  });

  it("stale knowledge disappears with the shell that was fired", () => {
    const s = makeState({ items: [["inverter"], [], []], shells: [true, false, true] });
    s.observations[0][1] = obs(true);
    act(s, 0, use(0));
    act(s, 0, shoot(2));
    expect(s.shells.length).toBe(2);
    expect(projectPrivate(s, 1).knownShells).toEqual([]);
  });
});

describe("shell numbering of kept knowledge", () => {
  it("keeps the same shell number while its position moves forward", () => {
    const s = makeState({ shells: [false, true, true, false], alive: [true, true, true] });
    s.observations[2][0] = obs(true); // P1 knows shell #3
    expect(projectPrivate(s, 0).knownShells).toEqual([
      { position: 2, shellNumber: 3, observedLive: true, stale: false },
    ]);
    act(s, 0, shoot(1)); // blank, P0 turn ends
    act(s, 1, shoot(2)); // live, hits P2
    expect(projectPrivate(s, 0).knownShells).toEqual([
      { position: 0, shellNumber: 3, observedLive: true, stale: false },
    ]);
  });
});

describe("events", () => {
  it("never include knowledge belonging to someone else", () => {
    const s = makeState({ items: [["magnifier"], [], []], shells: [true, false] });
    const ev = act(s, 0, use(0));
    const forUser = projectEvent(ev[0], 0);
    const forOther = projectEvent(ev[0], 1);
    expect(forUser.private.knownShells.length).toBe(1);
    expect(forOther.private.knownShells.length).toBe(0);
    expect(forUser.type === "itemUsed" && forUser.reveal?.live).toBe(true);
    expect(forOther.type === "itemUsed" && forOther.reveal).toBeUndefined();
    expect(forOther.type === "itemUsed" && forOther.text).toBe("PLAYER 1 inspects the chamber.");
  });
});
