// Port of item_manager.gd: validation (can_use / usable_now) and effects (apply).

import { ITEM_IDS, itemName, playerName, type ItemId, type Reveal } from "@lastshell/shared";
import { damage, heal } from "./player";
import type { Rng } from "./rng";
import { invertChamber, observeChamber, observeRandomFuture, popShell } from "./shotgun";
import type { GameState, ItemArgs, PlayerState } from "./types";

export interface ItemResult {
  item: ItemId;
  publicText: string;
  privateText: string;
  hpChange: number;
  eject: -1 | 0 | 1;
  reveal?: Reveal;
}

export function randomItem(rng: Rng): ItemId {
  return ITEM_IDS[rng.int(ITEM_IDS.length)];
}

/** Non-integers behave like "nothing chosen", like args.get(key, -1) did in Godot. */
function intOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

// ---------------------------------------------------------------- queries

export function opponents(state: GameState, user: PlayerState): number[] {
  return state.players.filter((p) => p.alive && p.seat !== user.seat).map((p) => p.seat);
}

export function cuffTargets(state: GameState, user: PlayerState): number[] {
  return opponents(state, user).filter((id) => !state.players[id].cuffed);
}

export function isStealable(state: GameState, item: ItemId, user: PlayerState): boolean {
  return item !== "adrenaline" && usableNow(state, item, user) === "";
}

export function stealVictims(state: GameState, user: PlayerState): number[] {
  return opponents(state, user).filter((id) =>
    state.players[id].items.some((it) => isStealable(state, it, user)),
  );
}

/** "" if the item could be used now (ignoring chosen targets), else the reason it can't. */
export function usableNow(state: GameState, item: ItemId, user: PlayerState): string {
  switch (item) {
    case "magnifier":
    case "beer":
    case "inverter":
      if (state.shells.length < 1) return "The magazine is empty.";
      break;
    case "saw":
      if (user.sawed) return "The hand saw is already active.";
      break;
    case "phone":
      if (state.shells.length < 2) return "No future shells to reveal.";
      break;
    case "handcuffs":
      if (cuffTargets(state, user).length === 0) return "No opponent can be handcuffed right now.";
      break;
    case "adrenaline":
      if (stealVictims(state, user).length === 0) return "No opponent has an item you can steal.";
      break;
    default:
      break;
  }
  return "";
}

/** Full validation including the chosen targets. Returns "" when legal. */
export function canUse(state: GameState, item: ItemId, user: PlayerState, args: ItemArgs): string {
  if (!ITEM_IDS.includes(item)) return "Unknown item.";
  const err = usableNow(state, item, user);
  if (err !== "") return err;
  if (item === "handcuffs") {
    if (!cuffTargets(state, user).includes(intOr(args.target, -1))) {
      return "Pick an opponent who isn't already handcuffed.";
    }
  } else if (item === "adrenaline") {
    const victimId = intOr(args.target, -1);
    if (!stealVictims(state, user).includes(victimId)) {
      return "Pick an opponent who has a stealable item.";
    }
    const victim = state.players[victimId];
    const slot = intOr(args.stealSlot, -1);
    if (slot < 0 || slot >= victim.items.length) return "Pick an item to steal.";
    const stolen = victim.items[slot];
    if (!isStealable(state, stolen, user)) return "You can't steal that item right now.";
    if (stolen === "handcuffs" && !cuffTargets(state, user).includes(intOr(args.subTarget, -1))) {
      return "Pick an opponent to handcuff.";
    }
  }
  return "";
}

// ---------------------------------------------------------------- effects

/** Assumes canUse() already passed. */
export function applyItem(
  state: GameState,
  item: ItemId,
  user: PlayerState,
  args: ItemArgs,
  rng: Rng,
): ItemResult {
  const who = playerName(user.seat);
  const res: ItemResult = { item, publicText: "", privateText: "", hpChange: 0, eject: -1 };
  const both = (text: string) => {
    res.publicText = text;
    res.privateText = text;
  };

  switch (item) {
    case "magnifier": {
      observeChamber(state, user.seat);
      const live = state.shells[0];
      res.publicText = `${who} inspects the chamber.`;
      res.privateText = `${who} inspects the chamber: ${live ? "LIVE" : "BLANK"}`;
      res.reveal = { kind: "chamber", shellNumber: state.fired + 1, live };
      break;
    }
    case "beer": {
      const live = popShell(state);
      res.eject = live ? 1 : 0;
      both(`${who} ejects a ${live ? "LIVE" : "BLANK"} shell.`);
      break;
    }
    case "saw":
      user.sawed = true;
      both(`${who} saws off the barrel. Next LIVE shot deals 2!`);
      break;
    case "cigarettes": {
      const healed = heal(user, 1);
      res.hpChange = healed;
      both(healed > 0 ? `${who} smokes a cigarette. +1 HP` : `${who} smokes at full health. No effect.`);
      break;
    }
    case "handcuffs": {
      const target = state.players[intOr(args.target, -1)];
      target.cuffed = true;
      both(`${who} handcuffs ${playerName(target.seat)}. They will skip their next turn.`);
      break;
    }
    case "phone": {
      const info = observeRandomFuture(state, user.seat, rng);
      if (info === null) {
        both(`${who}'s call goes nowhere.`);
      } else {
        res.publicText = `${who} uses a burner phone.`;
        res.privateText = `Shell #${info.shellNumber}: ${info.live ? "LIVE" : "BLANK"}`;
        res.reveal = { kind: "future", shellNumber: info.shellNumber, live: info.live };
      }
      break;
    }
    case "medicine": {
      const before = user.hp;
      if (rng.float() < 0.5) heal(user, 2);
      else damage(user, 1);
      res.hpChange = user.hp - before;
      if (res.hpChange > 0) both(`${who} takes the medicine. It works! +${res.hpChange} HP`);
      else if (res.hpChange < 0) both(`${who} takes the medicine. It's expired! -1 HP`);
      else both(`${who} takes the medicine at full health. Nothing happens.`);
      break;
    }
    case "inverter":
      invertChamber(state, user.seat);
      both(`${who} inverts the chamber shell.`);
      break;
    case "adrenaline": {
      const victim = state.players[intOr(args.target, -1)];
      const slot = intOr(args.stealSlot, -1);
      const stolen = victim.items[slot];
      victim.items.splice(slot, 1);
      const inner = applyItem(state, stolen, user, { target: intOr(args.subTarget, -1) }, rng);
      const prefix = `${who} steals ${itemName(stolen)} from ${playerName(victim.seat)}. `;
      inner.publicText = prefix + inner.publicText;
      inner.privateText = prefix + inner.privateText;
      return inner;
    }
  }
  return res;
}
