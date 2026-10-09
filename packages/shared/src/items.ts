// Item metadata ported from item_manager.gd (names, colours and descriptions only; no secrets).

export const ITEM_IDS = [
  "magnifier",
  "beer",
  "saw",
  "cigarettes",
  "handcuffs",
  "phone",
  "medicine",
  "inverter",
  "adrenaline",
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export interface ItemDef {
  name: string;
  short: string;
  color: string;
  desc: string;
}

export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  magnifier: {
    name: "MAGNIFYING GLASS",
    short: "LENS",
    color: "#73CCF2",
    desc: "Reveal whether the chamber shell is LIVE or BLANK.",
  },
  beer: {
    name: "BEER",
    short: "BEER",
    color: "#F2B833",
    desc: "Eject the chamber shell without firing it. You keep your turn.",
  },
  saw: {
    name: "HAND SAW",
    short: "SAW",
    color: "#C7C7D1",
    desc: "Your next LIVE shot deals 2 damage.",
  },
  cigarettes: {
    name: "CIGARETTES",
    short: "SMOKES",
    color: "#E0D9BF",
    desc: "Restore 1 HP (max 3).",
  },
  handcuffs: {
    name: "HANDCUFFS",
    short: "CUFFS",
    color: "#9EADBF",
    desc: "Choose an opponent. They skip their next turn.",
  },
  phone: {
    name: "BURNER PHONE",
    short: "PHONE",
    color: "#80E68C",
    desc: "Reveal a random FUTURE shell (never the chamber).",
  },
  medicine: {
    name: "EXPIRED MEDICINE",
    short: "MEDS",
    color: "#D980D9",
    desc: "50%: +2 HP. 50%: -1 HP.",
  },
  inverter: {
    name: "INVERTER",
    short: "INVERT",
    color: "#F2664D",
    desc: "Flip the chamber shell: LIVE becomes BLANK, BLANK becomes LIVE.",
  },
  adrenaline: {
    name: "ADRENALINE",
    short: "ADRENALINE",
    color: "#FF8C26",
    desc: "Steal an item from an opponent and use it immediately.",
  },
};

export function itemName(item: ItemId): string {
  return ITEM_DEFS[item].name;
}
