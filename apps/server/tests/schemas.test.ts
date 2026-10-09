import { describe, expect, it } from "vitest";
import {
  actionSchema,
  emptySchema,
  joinSchema,
  resumeSchema,
  roomCodeSchema,
} from "../src/net/schemas";

const validAction = { actionId: "abcdefgh-1234", version: 3, action: { type: "shoot", target: 1 } };

describe("room codes", () => {
  it("normalises case and whitespace", () => {
    expect(roomCodeSchema.parse(" abcde ")).toBe("ABCDE");
  });

  it.each(["", "ABCD", "ABCDEF", "ABCD0", "ABCDI", "ABCDO", "AB CD", "ÄBCDE", "ABCD1"])("rejects %j", (code) => {
    expect(roomCodeSchema.safeParse(code).success).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const bad of [null, undefined, 12345, {}, ["ABCDE"]]) {
      expect(roomCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("join / resume", () => {
  it("accepts well-formed requests and rejects extra fields", () => {
    expect(joinSchema.safeParse({ code: "abcde" }).success).toBe(true);
    expect(joinSchema.safeParse({ code: "ABCDE", seat: 0 }).success).toBe(false);
    expect(joinSchema.safeParse({}).success).toBe(false);
  });

  it("validates tokens", () => {
    const token = "A".repeat(22);
    expect(resumeSchema.safeParse({ code: "ABCDE", token }).success).toBe(true);
    expect(resumeSchema.safeParse({ code: "ABCDE", token: "short" }).success).toBe(false);
    expect(resumeSchema.safeParse({ code: "ABCDE", token: "A".repeat(200) }).success).toBe(false);
    expect(resumeSchema.safeParse({ code: "ABCDE", token: "bad token!!!!!!!!!!!!" }).success).toBe(false);
    expect(resumeSchema.safeParse({ code: "ABCDE", token, seat: 1 }).success).toBe(false);
  });
});

describe("actions", () => {
  it("accepts valid shoot and useItem actions", () => {
    expect(actionSchema.safeParse(validAction).success).toBe(true);
    expect(
      actionSchema.safeParse({
        ...validAction,
        action: { type: "useItem", slot: 7, args: { target: 2, stealSlot: 0, subTarget: 1 } },
      }).success,
    ).toBe(true);
    expect(actionSchema.safeParse({ ...validAction, action: { type: "useItem", slot: 0 } }).success).toBe(true);
  });

  it("never accepts a client-supplied seat, at any level", () => {
    expect(actionSchema.safeParse({ ...validAction, seat: 2 }).success).toBe(false);
    expect(actionSchema.safeParse({ ...validAction, action: { type: "shoot", target: 1, seat: 2 } }).success).toBe(false);
    expect(
      actionSchema.safeParse({ ...validAction, action: { type: "useItem", slot: 0, args: { seat: 1 } } }).success,
    ).toBe(false);
  });

  it.each([
    ["target too high", { type: "shoot", target: 3 }],
    ["negative target", { type: "shoot", target: -1 }],
    ["fractional target", { type: "shoot", target: 1.5 }],
    ["string target", { type: "shoot", target: "1" }],
    ["NaN target", { type: "shoot", target: Number.NaN }],
    ["slot too high", { type: "useItem", slot: 8 }],
    ["negative slot", { type: "useItem", slot: -1 }],
    ["unknown type", { type: "restart" }],
    ["missing type", { target: 1 }],
    ["args not an object", { type: "useItem", slot: 0, args: 5 }],
    ["args target too high", { type: "useItem", slot: 0, args: { target: 3 } }],
  ])("rejects: %s", (_name, action) => {
    expect(actionSchema.safeParse({ ...validAction, action }).success).toBe(false);
  });

  it.each([
    ["short action id", { actionId: "abc" }],
    ["long action id", { actionId: "a".repeat(65) }],
    ["action id with spaces", { actionId: "abcdefgh ijk" }],
    ["negative version", { version: -1 }],
    ["fractional version", { version: 1.2 }],
    ["string version", { version: "1" }],
    ["missing action", { action: undefined }],
  ])("rejects: %s", (_name, patch) => {
    expect(actionSchema.safeParse({ ...validAction, ...patch }).success).toBe(false);
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, "shoot", 5, []]) {
      expect(actionSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("empty events", () => {
  it("accept nothing, but nothing else", () => {
    expect(emptySchema.safeParse(undefined).success).toBe(true);
    expect(emptySchema.safeParse({}).success).toBe(true);
    expect(emptySchema.safeParse({ seat: 1 }).success).toBe(false);
    expect(emptySchema.safeParse("x").success).toBe(false);
  });
});
