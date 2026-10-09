// Port of game_manager.gd. The engine resolves an action instantly and returns the events the
// Godot UI would have animated. Pacing (BUSY time) is the room layer's job, not the engine's.

import { ITEMS_PER_LOAD, MAX_SLOTS, PLAYER_COUNT, playerName } from "@lastshell/shared";
import { applyItem, canUse, randomItem } from "./items";
import { addItem, createPlayer, damage, eliminate } from "./player";
import type { Rng } from "./rng";
import { blankCount, liveCount, loadNewMagazine, popShell } from "./shotgun";
import type {
  Action,
  ActionResult,
  EngineEvent,
  EngineEventBody,
  GameState,
  ItemArgs,
} from "./types";

interface Ctx {
  state: GameState;
  rng: Rng;
  events: EngineEvent[];
}

function emit(ctx: Ctx, body: EngineEventBody): void {
  ctx.events.push({ ...body, after: structuredClone(ctx.state) } as EngineEvent);
}

// ================================================================== match flow

/** New match (also used for restart): fresh players, seat 0 starts, first reload. */
export function createMatch(rng: Rng): { state: GameState; events: EngineEvent[] } {
  const state: GameState = {
    phase: "AWAITING",
    players: Array.from({ length: PLAYER_COUNT }, (_, i) => createPlayer(i)),
    shells: [],
    observations: [],
    fired: 0,
    current: 0,
    loadNumber: 0,
    winner: null,
  };
  const ctx: Ctx = { state, rng, events: [] };
  emit(ctx, { type: "matchStarted" });
  reload(ctx);
  beginTurn(ctx, true);
  return { state, events: ctx.events };
}

/** New magazine + new items + temporary effects cleared. HP and eliminations stay. */
function reload(ctx: Ctx): void {
  const { state, rng } = ctx;
  state.loadNumber += 1;
  loadNewMagazine(state, rng);
  for (const p of state.players) {
    p.sawed = false;
    p.cuffed = false;
    if (!p.alive) continue;
    if (state.loadNumber > 1) p.slots = Math.min(p.slots + 1, MAX_SLOTS);
    for (let i = 0; i < ITEMS_PER_LOAD; i++) {
      if (!addItem(p, randomItem(rng))) break; // inventory full
    }
  }
  emit(ctx, {
    type: "reload",
    loadNumber: state.loadNumber,
    live: liveCount(state),
    blank: blankCount(state),
  });
}

function beginTurn(ctx: Ctx, announce: boolean): void {
  emit(ctx, { type: "turnBegan", seat: ctx.state.current, announce });
}

function aliveSeats(state: GameState): number[] {
  return state.players.filter((p) => p.alive).map((p) => p.seat);
}

function nextAliveAfter(state: GameState, from: number): number {
  for (let i = 1; i <= PLAYER_COUNT; i++) {
    const idx = (from + i) % PLAYER_COUNT;
    if (state.players[idx].alive) return idx;
  }
  return -1;
}

/** Moves `current` to the next living player, consuming handcuffs on the way (bounded loop). */
function advanceTurn(ctx: Ctx): void {
  const { state } = ctx;
  for (let guard = 0; guard < PLAYER_COUNT + 1; guard++) {
    const nxt = nextAliveAfter(state, state.current);
    if (nxt === -1) return;
    state.current = nxt;
    if (!state.players[nxt].cuffed) return;
    state.players[nxt].cuffed = false;
    emit(ctx, { type: "skipped", seat: nxt });
  }
}

/** Called after EVERY action: deaths, winner, turn change, reload. */
function resolve(ctx: Ctx, endTurn: boolean): void {
  const { state } = ctx;
  for (const p of state.players) {
    if (p.alive && p.hp <= 0) {
      eliminate(p);
      emit(ctx, { type: "eliminated", seat: p.seat });
    }
  }
  const alive = aliveSeats(state);
  if (alive.length <= 1) {
    state.phase = "GAME_OVER";
    state.winner = alive.length === 1 ? alive[0] : -1;
    emit(ctx, { type: "gameOver", winner: state.winner });
    return;
  }
  const turnChanged = endTurn || !state.players[state.current].alive;
  if (turnChanged) advanceTurn(ctx);
  if (state.shells.length === 0) reload(ctx);
  beginTurn(ctx, turnChanged);
}

// ================================================================== actions

function fail(code: Extract<ActionResult, { ok: false }>["code"], message: string): ActionResult {
  return { ok: false, code, message };
}

/**
 * Validates and applies one action. On failure the state is left completely untouched.
 * `seat` must come from the authenticated connection, never from the client message.
 */
export function applyAction(state: GameState, seat: number, action: Action, rng: Rng): ActionResult {
  if (state.phase !== "AWAITING") return fail("WRONG_PHASE", "The match is over.");
  if (!Number.isInteger(seat) || seat !== state.current) {
    return fail("NOT_YOUR_TURN", "It's not your turn.");
  }
  const ctx: Ctx = { state, rng, events: [] };
  const user = state.players[seat];

  if (action.type === "shoot") {
    const targetId = action.target;
    if (!Number.isInteger(targetId) || targetId < 0 || targetId >= PLAYER_COUNT) {
      return fail("INVALID_TARGET", "That target doesn't exist.");
    }
    const target = state.players[targetId];
    if (!target.alive) {
      return fail("TARGET_ELIMINATED", `${playerName(targetId)} is already eliminated.`);
    }
    if (state.shells.length < 1) return fail("EMPTY_MAGAZINE", "The shotgun is empty.");
    doShoot(ctx, targetId);
    return { ok: true, events: ctx.events };
  }

  if (action.type === "useItem") {
    const { slot } = action;
    if (!Number.isInteger(slot) || slot < 0 || slot >= user.items.length) {
      return fail("INVALID_SLOT", "There's no item in that slot.");
    }
    const args: ItemArgs = action.args ?? {};
    const item = user.items[slot];
    const err = canUse(state, item, user, args);
    if (err !== "") return fail("ITEM_UNUSABLE", err);
    doUse(ctx, slot, args);
    return { ok: true, events: ctx.events };
  }

  return fail("WRONG_PHASE", "Unknown action.");
}

function doShoot(ctx: Ctx, targetId: number): void {
  const { state } = ctx;
  const shooter = state.players[state.current];
  const target = state.players[targetId];
  const selfShot = targetId === state.current;

  emit(ctx, { type: "shotFired", shooter: shooter.seat, target: targetId });

  const live = popShell(state);
  let dmg = 0;
  if (live) {
    dmg = shooter.sawed ? 2 : 1;
    shooter.sawed = false; // the saw is used up by a LIVE shot only
    damage(target, dmg);
  }
  let message = `${playerName(shooter.seat)} shoots ${selfShot ? "THEMSELVES" : playerName(targetId)}: `;
  if (live) {
    message += `LIVE! -${dmg} HP`;
  } else {
    message += "BLANK.";
    if (selfShot) message += " Shoot again!";
  }
  emit(ctx, {
    type: "shotResolved",
    shooter: shooter.seat,
    target: targetId,
    live,
    damage: dmg,
    selfShot,
    message,
  });

  // A blank fired at yourself is the only shot that keeps your turn.
  resolve(ctx, !(selfShot && !live));
}

function doUse(ctx: Ctx, slot: number, args: ItemArgs): void {
  const { state, rng } = ctx;
  const user = state.players[state.current];
  const item = user.items[slot];
  user.items.splice(slot, 1);
  const res = applyItem(state, item, user, args, rng);
  emit(ctx, {
    type: "itemUsed",
    seat: user.seat,
    item: res.item,
    hpChange: res.hpChange,
    eject: res.eject,
    publicText: res.publicText,
    privateText: res.privateText,
    ...(res.reveal ? { reveal: res.reveal } : {}),
  });
  resolve(ctx, false);
}

/**
 * A player leaves the match (voluntarily or after the disconnect grace period): they are
 * eliminated through the normal flow, so turn order and victory are handled by resolve().
 * Returns [] if there is nothing to do.
 */
export function forfeitPlayer(state: GameState, seat: number, rng: Rng): EngineEvent[] {
  if (state.phase !== "AWAITING") return [];
  if (!Number.isInteger(seat) || seat < 0 || seat >= PLAYER_COUNT) return [];
  const player = state.players[seat];
  if (!player.alive) return [];
  const ctx: Ctx = { state, rng, events: [] };
  player.hp = 0;
  resolve(ctx, false);
  return ctx.events;
}
