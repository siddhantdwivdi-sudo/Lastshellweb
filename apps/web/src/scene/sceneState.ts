// Pure helpers: from the UI model (which is built from server events) to what each figure does.
// Nothing here decides an outcome; it only reads what the server already reported.

import { opponentsOf, positionOf } from "../lib/layout";
import type { ItemCue, ShotCue } from "../ui/model";
import type { AimTarget } from "./cast";

export type Side = "left" | "right";

/** Where an opponent's seat is drawn, relative to the local player. */
export function sideOf(seat: number, you: number): Side {
  return positionOf(seat, you) === "left" ? "left" : "right";
}

/** The direction a figure turns its gun to cover the OTHER opponent (the one across the table from it). */
export function lookDirTowardNeighbor(side: Side): Side {
  return side === "left" ? "right" : "left";
}

/**
 * Where a figure's gun points right now. Everyone aims at the player by default; while the server is
 * playing a shot (`shotFired` until the turn changes) the shooter turns the weapon on their target.
 */
export function aimOf(aim: { shooter: number; target: number } | null, seat: number, you: number): AimTarget {
  if (!aim || aim.shooter !== seat) return "player";
  if (aim.target === seat) return "self";
  if (aim.target === you) return "player";
  return "neighbor";
}

/** The server confirmed a live shell hit this seat. */
export function wasShot(cue: ShotCue | null, seat: number): boolean {
  return !!cue && cue.live && cue.damage > 0 && cue.target === seat;
}

/** The server confirmed this seat hurt themselves with an item (e.g. expired medicine). */
export function hurtByItem(cue: ItemCue | null, seat: number): boolean {
  return !!cue && cue.hpChange < 0 && cue.seat === seat;
}

/** A shot by this seat (live = muzzle flash; blank = dry click). */
export function shotBy(cue: ShotCue | null, seat: number): ShotCue | null {
  return cue && cue.shooter === seat ? cue : null;
}

export function opponentSeats(you: number): [number, number] {
  const { left, right } = opponentsOf(you);
  return [left, right];
}
