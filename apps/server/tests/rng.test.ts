import { describe, expect, it } from "vitest";
import { createCryptoRng, createSeededRng } from "../src/engine";
import { generateShells } from "../src/engine/shotgun";

describe("seeded rng", () => {
  it("is deterministic for the same seed and differs between seeds", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const c = createSeededRng(43);
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    const seqC = Array.from({ length: 20 }, () => c.float());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it("keeps floats in [0,1) and ints in range", () => {
    const r = createSeededRng(7);
    for (let i = 0; i < 2000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(9);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(9);
      const m = r.intInclusive(4, 8);
      expect(m).toBeGreaterThanOrEqual(4);
      expect(m).toBeLessThanOrEqual(8);
    }
  });

  it("shuffle is a permutation", () => {
    const r = createSeededRng(1);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    r.shuffle(arr);
    expect([...arr].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("crypto rng", () => {
  it("stays in range", () => {
    const r = createCryptoRng();
    for (let i = 0; i < 500; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.intInclusive(4, 8);
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(8);
    }
  });
});

describe("shell generation", () => {
  it("always has 4-8 shells with at least one live and one blank, and covers every size", () => {
    const sizes = new Set<number>();
    for (let seed = 0; seed < 1000; seed++) {
      const shells = generateShells(createSeededRng(seed));
      expect(shells.length).toBeGreaterThanOrEqual(4);
      expect(shells.length).toBeLessThanOrEqual(8);
      expect(shells.some((s) => s)).toBe(true);
      expect(shells.some((s) => !s)).toBe(true);
      sizes.add(shells.length);
    }
    expect([...sizes].sort()).toEqual([4, 5, 6, 7, 8]);
  });
});
