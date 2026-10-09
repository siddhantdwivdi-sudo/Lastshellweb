import { describe, expect, it } from "vitest";
import { aimAngle, formatCountdown, opponentsOf, positionOf } from "./layout";

describe("perspective", () => {
  it("always puts the local player at the bottom and the others left/right in seat order", () => {
    expect(opponentsOf(0)).toEqual({ left: 1, right: 2 });
    expect(opponentsOf(1)).toEqual({ left: 2, right: 0 });
    expect(opponentsOf(2)).toEqual({ left: 0, right: 1 });
    for (const you of [0, 1, 2]) {
      expect(positionOf(you, you)).toBe("bottom");
      const { left, right } = opponentsOf(you);
      expect(new Set([you, left, right]).size).toBe(3);
    }
  });

  it("aims the barrel at the target's position on screen", () => {
    expect(aimAngle(0, 0, "table")).toBeCloseTo(Math.PI / 2);
    expect(aimAngle(1, 0, "table")).toBeCloseTo(Math.PI);
    expect(aimAngle(2, 0, "table")).toBeCloseTo(0);
    expect(aimAngle(1, 0, "stack")).toBeCloseTo((-3 * Math.PI) / 4);
    expect(aimAngle(2, 0, "stack")).toBeCloseTo(-Math.PI / 4);
  });
});

describe("formatCountdown", () => {
  it("formats m:ss and never goes negative", () => {
    expect(formatCountdown(42_000)).toBe("0:42");
    expect(formatCountdown(60_000)).toBe("1:00");
    expect(formatCountdown(41_001)).toBe("0:42");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});
