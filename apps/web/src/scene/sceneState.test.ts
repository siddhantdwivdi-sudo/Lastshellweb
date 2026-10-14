import { describe, expect, it } from "vitest";
import { ART_BY_SIDE, castFor, castModeFromSearch, muzzleAnchor, pickPoseImage, type CastArt } from "./cast";
import { aimOf, hurtByItem, lookDirTowardNeighbor, opponentSeats, shotBy, sideOf, wasShot } from "./sceneState";

describe("who aims at what", () => {
  it("everyone points at the player until the server plays a shot", () => {
    for (const seat of [0, 1, 2]) expect(aimOf(null, seat, 0)).toBe("player");
  });

  it("only the shooter turns their gun, toward the server-reported target", () => {
    const aim = { shooter: 1, target: 2 };
    expect(aimOf(aim, 1, 0)).toBe("neighbor"); // opponent shoots the other opponent
    expect(aimOf(aim, 2, 0)).toBe("player"); // the one being shot at keeps pointing at me
    expect(aimOf({ shooter: 1, target: 0 }, 1, 0)).toBe("player"); // shooting me: toward me
    expect(aimOf({ shooter: 1, target: 1 }, 1, 0)).toBe("self");
  });
});

describe("seating", () => {
  it("opponents are drawn left/right in seat order from my viewpoint", () => {
    expect(opponentSeats(0)).toEqual([1, 2]);
    expect(opponentSeats(1)).toEqual([2, 0]);
    expect(sideOf(1, 0)).toBe("left");
    expect(sideOf(2, 0)).toBe("right");
    expect(lookDirTowardNeighbor("left")).toBe("right");
    expect(lookDirTowardNeighbor("right")).toBe("left");
  });
});

describe("hit and shot cues come only from confirmed server events", () => {
  const shot = { id: 1, shooter: 1, target: 0, live: true, damage: 1, selfShot: false };
  it("a live shell with damage is a hit on its target only", () => {
    expect(wasShot(shot, 0)).toBe(true);
    expect(wasShot(shot, 2)).toBe(false);
    expect(wasShot(null, 0)).toBe(false);
  });
  it("a blank is never a hit", () => {
    expect(wasShot({ ...shot, live: false, damage: 0 }, 0)).toBe(false);
  });
  it("shotBy tells whose gun went off; item self-harm is its own cue", () => {
    expect(shotBy(shot, 1)).toBe(shot);
    expect(shotBy(shot, 2)).toBeNull();
    expect(hurtByItem({ id: 2, seat: 0, item: "medicine", hpChange: -1 }, 0)).toBe(true);
    expect(hurtByItem({ id: 2, seat: 0, item: "cigarettes", hpChange: 1 }, 0)).toBe(false);
    expect(hurtByItem({ id: 2, seat: 1, item: "medicine", hpChange: -1 }, 0)).toBe(false);
  });
});

describe("character artwork selection", () => {
  const art: CastArt = {
    idle: "idle.webp",
    aimNeighbor: "aim.webp",
    blink: "blink.webp",
    dead: "dead.webp",
    width: 800,
    height: 1200,
    muzzle: { player: { x: 50, y: 70 }, neighbor: { x: 90, y: 66 }, self: { x: 50, y: 40 } },
  };
  const st = (over: object = {}) => ({ alive: true, aim: "player" as const, blinking: false, ...over });

  it("picks the pose image and falls back to idle for poses the artist did not supply", () => {
    expect(pickPoseImage(art, st())).toBe("idle.webp");
    expect(pickPoseImage(art, st({ blinking: true }))).toBe("blink.webp");
    expect(pickPoseImage(art, st({ aim: "neighbor" }))).toBe("aim.webp");
    expect(pickPoseImage(art, st({ aim: "self" }))).toBe("idle.webp"); // no aimSelf supplied
    expect(pickPoseImage(art, st({ alive: false }))).toBe("dead.webp");
    expect(pickPoseImage({ ...art, dead: undefined }, st({ alive: false }))).toBe("idle.webp");
  });

  it("mirrors the neighbour muzzle for a figure looking left", () => {
    expect(muzzleAnchor(art.muzzle, "neighbor", "right")).toEqual({ x: 90, y: 66 });
    expect(muzzleAnchor(art.muzzle, "neighbor", "left")).toEqual({ x: 10, y: 66 });
    expect(muzzleAnchor(art.muzzle, "player", "left")).toEqual({ x: 50, y: 70 });
    expect(muzzleAnchor(art.muzzle, "self", "right")).toEqual({ x: 50, y: 40 });
  });
});

describe("character identity follows screen position", () => {
  it("left is always the bearded man and right the bald man, whatever the seats", () => {
    for (const seat of [0, 1, 2]) {
      expect(castFor(seat, "left").art).toBe(ART_BY_SIDE.left);
      expect(castFor(seat, "right").art).toBe(ART_BY_SIDE.right);
    }
    expect(ART_BY_SIDE.left.idle).not.toBe(ART_BY_SIDE.right.idle);
  });

  it("images are 2:3 like the silhouettes, so the layout does not change", () => {
    for (const side of ["left", "right"] as const) expect(ART_BY_SIDE[side].width / ART_BY_SIDE[side].height).toBeCloseTo(400 / 600);
  });

  it("silhouettes stay switchable with ?cast=silhouette", () => {
    expect(castModeFromSearch("")).toBe("images");
    expect(castModeFromSearch("?cast=silhouette")).toBe("silhouette");
    expect(castFor(1, "left", "silhouette").art).toBeNull();
    expect(castFor(1, "left", "silhouette").variant).toBe(1);
  });

  it("each man has a dedicated image for every required state, with idle as the fallback", () => {
    for (const side of ["left", "right"] as const) {
      const art = ART_BY_SIDE[side];
      const st = (over: object = {}) => ({ alive: true, aim: "player" as const, blinking: false, ...over });
      const imgs = [
        pickPoseImage(art, st()),
        pickPoseImage(art, st({ aim: "neighbor" })),
        pickPoseImage(art, st({ aim: "self" })),
        pickPoseImage(art, st({ alive: false })),
      ];
      expect(new Set(imgs).size).toBe(4); // idle, aim-neighbour, aim-self, dead are four different files
      expect(imgs[0]).toBe(art.idle);
      expect(pickPoseImage(art, st({ blinking: true }))).toBe(art.idle); // no separate blink image
    }
  });

  it("muzzle anchors: the right-hand man's neighbour anchor is stored mirrored so the flash lands on his real muzzle", () => {
    const r = muzzleAnchor(ART_BY_SIDE.right.muzzle, "neighbor", "left"); // gun points left, near the left edge
    expect(r.x).toBeCloseTo(2.4);
    expect(r.y).toBeCloseTo(47.5);
    expect(muzzleAnchor(ART_BY_SIDE.left.muzzle, "neighbor", "right")).toEqual({ x: 97.6, y: 49.4 }); // gun points right, near the right edge
    for (const side of ["left", "right"] as const)
      for (const a of [ART_BY_SIDE[side].muzzle.player, ART_BY_SIDE[side].muzzle.neighbor, ART_BY_SIDE[side].muzzle.self]) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThanOrEqual(100);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeLessThanOrEqual(100);
      }
  });

});
