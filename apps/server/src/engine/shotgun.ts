import { MAX_SHELLS, MIN_SHELLS, PLAYER_COUNT } from "@lastshell/shared";
import type { Rng } from "./rng";
import type { GameState, Observation } from "./types";

/** Same distribution as shotgun.gd load_new(): 4-8 shells, at least 1 live and 1 blank. */
export function generateShells(rng: Rng): boolean[] {
  const total = rng.intInclusive(MIN_SHELLS, MAX_SHELLS);
  let live = 1;
  let blank = 1;
  for (let i = 0; i < total - 2; i++) {
    if (rng.float() < 0.5) live++;
    else blank++;
  }
  const shells: boolean[] = [];
  for (let i = 0; i < live; i++) shells.push(true);
  for (let i = 0; i < blank; i++) shells.push(false);
  rng.shuffle(shells);
  return shells;
}

export function emptyObservations(count: number): (Observation | null)[][] {
  return Array.from({ length: count }, () => Array.from({ length: PLAYER_COUNT }, () => null));
}

export function loadNewMagazine(state: GameState, rng: Rng): void {
  state.shells = generateShells(rng);
  state.observations = emptyObservations(state.shells.length);
  state.fired = 0;
}

export function liveCount(state: GameState): number {
  return state.shells.filter((s) => s).length;
}

export function blankCount(state: GameState): number {
  return state.shells.length - liveCount(state);
}

/** Removes the chamber shell (fire or eject) and returns whether it was LIVE. */
export function popShell(state: GameState): boolean {
  if (state.shells.length === 0) return false;
  const live = state.shells.shift() as boolean;
  state.observations.shift();
  state.fired += 1;
  return live;
}

/**
 * Inverter: flips the chamber shell.
 * - The player who used it keeps accurate knowledge: a fresh observation of the chamber is updated
 *   to the new value. (A stale one stays stale: they cannot know the true value, so updating it
 *   would hand them hidden information.)
 * - Everyone else who had observed the chamber keeps the OLD value, marked stale.
 */
export function invertChamber(state: GameState, userSeat: number): void {
  if (state.shells.length === 0) return;
  state.shells[0] = !state.shells[0];
  state.observations[0].forEach((obs, seat) => {
    if (!obs) return;
    if (seat === userSeat && !obs.stale) obs.live = state.shells[0];
    else obs.stale = true;
  });
}

export function observeChamber(state: GameState, seat: number): void {
  if (state.shells.length === 0) return;
  state.observations[0][seat] = { live: state.shells[0], stale: false };
}

/** Phone: reveals a random non-chamber shell, preferring ones this seat hasn't seen. */
export function observeRandomFuture(
  state: GameState,
  seat: number,
  rng: Rng,
): { shellNumber: number; live: boolean } | null {
  if (state.shells.length < 2) return null;
  const every: number[] = [];
  const unknown: number[] = [];
  for (let i = 1; i < state.shells.length; i++) {
    every.push(i);
    if (state.observations[i][seat] === null) unknown.push(i);
  }
  const pool = unknown.length > 0 ? unknown : every;
  const idx = pool[rng.int(pool.length)];
  state.observations[idx][seat] = { live: state.shells[idx], stale: false };
  return { shellNumber: state.fired + idx + 1, live: state.shells[idx] };
}
