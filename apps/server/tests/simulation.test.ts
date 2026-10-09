import { ITEM_IDS, type ItemId } from "@lastshell/shared";
import { describe, expect, it } from "vitest";
import { playRandomGame } from "./sim";

describe("random full-game simulations", () => {
  it("always terminate and keep every invariant, over 300 seeded games", () => {
    const total = { accepted: 0, rejected: 0, elim: 0, skips: 0, reloads: 0 };
    const used = new Set<ItemId>();
    for (let seed = 1; seed <= 300; seed++) {
      const stats = playRandomGame(seed);
      expect(stats.finished, `seed ${seed} did not finish`).toBe(true);
      total.accepted += stats.accepted;
      total.rejected += stats.rejected;
      total.elim += stats.eliminations;
      total.skips += stats.skips;
      total.reloads += stats.reloads;
      stats.usedItems.forEach((i) => used.add(i));
    }
    // The simulation must actually exercise the interesting paths.
    expect(used.size).toBe(ITEM_IDS.length);
    expect(total.elim).toBeGreaterThanOrEqual(600); // 2 per finished game
    expect(total.skips).toBeGreaterThan(0);
    expect(total.reloads).toBeGreaterThan(300); // plenty of reloads beyond the first
    expect(total.rejected).toBeGreaterThan(0);
  });

  it("is reproducible: same seed, same game", () => {
    const run = (seed: number) => {
      const log: string[] = [];
      playRandomGame(seed, (state) => log.push(JSON.stringify(state)));
      return log;
    };
    expect(run(77)).toEqual(run(77));
    expect(run(77)).not.toEqual(run(78));
  });
});
