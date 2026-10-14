// Who sits across the table, and what artwork represents them.
//
// Character identity follows SCREEN POSITION, not seat number: the left figure is always the bearded
// man and the right figure is always the bald man, whichever seats those happen to be for this viewer.
// `art` is where real character images plug in (see docs/ART.md). While it is null, or if an image
// fails to load, or when silhouettes are requested (`?cast=silhouette`), the scene draws the interim
// SVG silhouettes from Silhouette.tsx, which are placeholders, not final art.

import leftIdle from "../assets/cast/left-idle.webp";
import leftAimNeighbor from "../assets/cast/left-aim-neighbor.webp";
import leftAimSelf from "../assets/cast/left-aim-self.webp";
import leftDead from "../assets/cast/left-dead.webp";
import rightIdle from "../assets/cast/right-idle.webp";
import rightAimNeighbor from "../assets/cast/right-aim-neighbor.webp";
import rightAimSelf from "../assets/cast/right-aim-self.webp";
import rightDead from "../assets/cast/right-dead.webp";
import type { Side } from "./sceneState";

/** A point inside a figure's box, in percent (0,0 = top-left, 100,100 = bottom-right). */
export interface Anchor {
  x: number;
  y: number;
}

export interface MuzzleAnchors {
  /** Barrel pointing at the player (default pose). */
  player: Anchor;
  /** Barrel pointing at the neighbouring opponent. Given for a figure looking to its RIGHT; mirrored for the other side. */
  neighbor: Anchor;
  /** Barrel turned on themselves. */
  self: Anchor;
}

export interface CastArt {
  /** Pose images (same canvas size, same framing, so they can be cross-faded). Missing poses fall back to `idle`. */
  idle: string;
  aimNeighbor?: string;
  aimSelf?: string;
  /** Eyes closed, shown for a moment now and then. */
  blink?: string;
  /** Eliminated pose. */
  dead?: string;
  /** Natural pixel size of the images (used for the aspect ratio only). */
  width: number;
  height: number;
  muzzle: MuzzleAnchors;
}

export interface CastMember {
  /** Which interim silhouette to draw while there is no artwork. */
  variant: 0 | 1 | 2;
  art: CastArt | null;
}

/** Interim silhouettes, by seat (unchanged). Used whenever there is no usable artwork. */
export const CAST: readonly CastMember[] = [
  { variant: 0, art: null },
  { variant: 1, art: null },
  { variant: 2, art: null },
];

// Muzzle anchors were measured on the 800x1200 images (the barrel opening), in percent.
//
// PREVIEW ARTWORK: the aim/dead poses are upscaled from the 188x290 concept-sheet tiles, so they are
// softer than the idles and are placeholders until full-resolution poses replace them at the same paths.
// Known preview limits: the aim-at-neighbour shotgun runs off the image edge (the anchor sits on that
// edge), the aim-self weapon is a pistol (as drawn on the sheet), and the right-hand man's
// aim-at-neighbour image is the sheet's pose mirrored so that he points left.
//
// The neighbour anchor is for a figure looking RIGHT and is mirrored for one looking LEFT (the
// right-hand man), so his x is stored as 100 - x.
const LEFT_MUZZLE: Anchor = { x: 46.3, y: 62.0 };
const RIGHT_MUZZLE: Anchor = { x: 43.4, y: 65.8 };

/** Artwork by screen side: left = the bearded veteran, right = the bald enforcer. Missing poses fall back to idle. */
export const ART_BY_SIDE: Readonly<Record<Side, CastArt>> = {
  left: {
    idle: leftIdle,
    aimNeighbor: leftAimNeighbor,
    aimSelf: leftAimSelf,
    dead: leftDead,
    width: 800,
    height: 1200,
    muzzle: { player: LEFT_MUZZLE, neighbor: { x: 97.6, y: 49.4 }, self: { x: 46.0, y: 41.5 } },
  },
  right: {
    idle: rightIdle,
    aimNeighbor: rightAimNeighbor,
    aimSelf: rightAimSelf,
    dead: rightDead,
    width: 800,
    height: 1200,
    muzzle: { player: RIGHT_MUZZLE, neighbor: { x: 100 - 2.4, y: 47.5 }, self: { x: 47.4, y: 34.9 } },
  },
};

export type CastMode = "images" | "silhouette";

/** `?cast=silhouette` switches the scene back to the interim silhouettes for comparison; anything else shows the images. */
export function castModeFromSearch(search: string): CastMode {
  return new URLSearchParams(search).get("cast") === "silhouette" ? "silhouette" : "images";
}

export function castFor(seat: number, side: Side, mode: CastMode = "images"): CastMember {
  const base = CAST[seat % CAST.length];
  return { variant: base.variant, art: mode === "images" ? ART_BY_SIDE[side] : null };
}

export type AimTarget = "player" | "neighbor" | "self";

/** Which image to show for a pose. Pure so it can be tested; missing poses fall back to idle. */
export function pickPoseImage(art: CastArt, state: { alive: boolean; aim: AimTarget; blinking: boolean }): string {
  if (!state.alive) return art.dead ?? art.idle;
  if (state.aim === "self") return art.aimSelf ?? art.idle;
  if (state.aim === "neighbor") return art.aimNeighbor ?? art.idle;
  if (state.blinking && art.blink) return art.blink;
  return art.idle;
}

/** Muzzle position for a figure; the neighbour anchor is mirrored when the figure looks to its left. */
export function muzzleAnchor(m: MuzzleAnchors, aim: AimTarget, lookDir: "left" | "right"): Anchor {
  if (aim === "self") return m.self;
  if (aim === "player") return m.player;
  return lookDir === "right" ? m.neighbor : { x: 100 - m.neighbor.x, y: m.neighbor.y };
}
