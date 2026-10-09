import { PLAYER_COUNT } from "@lastshell/shared";

/** "table": desktop / landscape (opponents beside the stage). "stack": portrait phones. */
export type LayoutKind = "table" | "stack";

/** CSS uses the same query, so layout and the shotgun's aim always agree. */
export const TABLE_QUERY = "(min-width: 700px) and (orientation: landscape)";

/** The local player is always shown at the bottom; opponents follow in seat order. */
export function opponentsOf(you: number): { left: number; right: number } {
  return { left: (you + 1) % PLAYER_COUNT, right: (you + 2) % PLAYER_COUNT };
}

export type Position = "bottom" | "left" | "right";

export function positionOf(seat: number, you: number): Position {
  if (seat === you) return "bottom";
  return seat === opponentsOf(you).left ? "left" : "right";
}

/** Barrel angle in radians (0 = right, PI/2 = down, -PI/2 = up), as in the Godot view. */
export function aimAngle(target: number, you: number, layout: LayoutKind): number {
  const pos = positionOf(target, you);
  if (pos === "bottom") return Math.PI / 2;
  if (layout === "table") return pos === "left" ? Math.PI : 0;
  return pos === "left" ? (-3 * Math.PI) / 4 : -Math.PI / 4;
}

export const IDLE_AIM = -0.12;

/** "m:ss" countdown, never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function seatName(seat: number): string {
  return `PLAYER ${seat + 1}`;
}
