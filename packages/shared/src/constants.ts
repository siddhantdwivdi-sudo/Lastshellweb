// Rule constants ported from the Godot prototype (player.gd, shotgun.gd, game_manager.gd).

export const PLAYER_COUNT = 3;
export const MAX_HP = 3;
export const START_SLOTS = 4;
export const MAX_SLOTS = 8;
export const ITEMS_PER_LOAD = 2;
export const MIN_SHELLS = 4;
export const MAX_SHELLS = 8;

/** How long a disconnected player may stay away before forfeiting (room layer, Phase 2). */
export const DISCONNECT_GRACE_MS = 60_000;

/** Fixed seat colours (ui_manager.gd PLAYER_COLORS). */
export const PLAYER_COLORS = ["#FFA838", "#66D1EB", "#D185F2"] as const;

export function playerName(seat: number): string {
  return `PLAYER ${seat + 1}`;
}
