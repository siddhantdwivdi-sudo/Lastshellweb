import { MAX_HP, MAX_SLOTS, START_SLOTS, type ItemId } from "@lastshell/shared";
import type { PlayerState } from "./types";

export function createPlayer(seat: number): PlayerState {
  return { seat, hp: MAX_HP, alive: true, slots: START_SLOTS, items: [], sawed: false, cuffed: false };
}

export function hasSpace(p: PlayerState): boolean {
  return p.alive && p.items.length < Math.min(p.slots, MAX_SLOTS);
}

export function addItem(p: PlayerState, item: ItemId): boolean {
  if (!hasSpace(p)) return false;
  p.items.push(item);
  return true;
}

/** Returns how much HP was actually restored (never above MAX_HP). */
export function heal(p: PlayerState, amount: number): number {
  const before = p.hp;
  p.hp = Math.min(MAX_HP, Math.max(0, p.hp + amount));
  return p.hp - before;
}

export function damage(p: PlayerState, amount: number): void {
  p.hp = Math.max(0, p.hp - Math.max(0, amount));
}

export function eliminate(p: PlayerState): void {
  p.alive = false;
  p.hp = 0;
  p.items = [];
  p.sawed = false;
  p.cuffed = false;
}
