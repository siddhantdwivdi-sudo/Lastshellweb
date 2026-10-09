// A scripted mock match. Every frame is hand-written data (not the output of any rules), so the
// UI can be explored without a server. "waits" frames stop until the player presses something.

import { ITEM_DEFS, type ItemId, type KnownShell, type PublicGameView, type RoomState } from "@lastshell/shared";
import { opponentsOf, seatName } from "../lib/layout";
import type { GameUiModel } from "../ui/model";
import { known, mkPlayer, mkView, uid } from "./builders";

export interface MockFrame {
  model: GameUiModel;
  /** Move on to the next frame by itself after this many ms. */
  auto?: number;
  /** Move on to the next frame when the player does something. */
  waits?: boolean;
  label: string;
}

const RED = "#EB2B1F";
const BLUE = "#739EF2";

export function buildPlayScript(you: number, room: RoomState): MockFrame[] {
  const { left: L, right: R } = opponentsOf(you);
  const nm = seatName;

  const base = (view: PublicGameView, priv: KnownShell[], extra: Partial<GameUiModel> = {}): GameUiModel => ({
    you,
    view,
    private: { knownShells: priv, legal: null },
    room: { ...room, status: view.phase === "GAME_OVER" ? "GAME_OVER" : "IN_MATCH" },
    busy: false,
    pending: false,
    reconnecting: false,
    banner: null,
    message: null,
    aim: null,
    fx: null,
    reload: null,
    ...extra,
  });

  const msg = (text: string, bad = false) => ({ id: uid(), text, bad });
  const banner = (text: string, color: string) => ({ id: uid(), text, color });

  // Who holds what (shown on the panels; the local player's items fill the inventory).
  const itemsMe: ItemId[] = ["magnifier", "beer", "handcuffs", "adrenaline", "saw"];
  const itemsL: ItemId[] = ["saw", "cigarettes", "medicine"];
  const itemsR: ItemId[] = ["phone", "inverter", "beer"];

  const players = (hp: { me: number; l: number; r: number }, over: { meItems?: ItemId[]; lAlive?: boolean; rAlive?: boolean; sawedMe?: boolean; cuffedR?: boolean } = {}) => {
    const arr = [0, 1, 2].map((s) => mkPlayer(s));
    arr[you] = mkPlayer(you, {
      hp: hp.me,
      items: [...(over.meItems ?? itemsMe)],
      slots: 5,
      sawed: over.sawedMe ?? false,
      alive: hp.me > 0,
    });
    arr[L] = mkPlayer(L, { hp: hp.l, items: over.lAlive === false ? [] : [...itemsL], slots: 4, alive: over.lAlive ?? true });
    arr[R] = mkPlayer(R, {
      hp: hp.r,
      items: over.rAlive === false ? [] : [...itemsR],
      slots: 4,
      alive: over.rAlive ?? true,
      cuffed: over.cuffedR ?? false,
    });
    return arr;
  };

  const mag = (live: number, blank: number) => ({ total: live + blank, live, blank });

  return [
    // 0 - the deal
    {
      label: "Reload (load 1)",
      auto: 2600,
      model: base(
        mkView(players({ me: 3, l: 2, r: 3 }), { current: you, loadNumber: 1, magazine: mag(3, 3) }),
        [],
        { busy: true, reload: { loadNumber: 1, live: 3, blank: 3 } },
      ),
    },
    // 1 - my turn, with some private knowledge
    {
      label: "Your turn",
      waits: true,
      model: base(
        mkView(players({ me: 3, l: 2, r: 3 }), { current: you, magazine: mag(3, 3) }),
        [known(2, 3, false)],
      ),
    },
    // 2 - I shoot the player on my left: live
    {
      label: "You shoot (LIVE)",
      auto: 2100,
      model: base(
        mkView(players({ me: 3, l: 1, r: 3 }), { current: you, fired: 1, magazine: mag(2, 3) }),
        [known(1, 3, false)],
        {
          busy: true,
          banner: banner("LIVE", RED),
          message: msg(`${nm(you)} shoots ${nm(L)}: LIVE! -1 HP`, true),
          aim: { shooter: you, target: L, shotId: uid() },
          fx: { id: uid(), kind: "flash-live", shake: true },
        },
      ),
    },
    // 3 - opponent's turn
    {
      label: "Opponent's turn",
      auto: 2600,
      model: base(
        mkView(players({ me: 3, l: 1, r: 3 }), { current: L, fired: 1, magazine: mag(2, 3) }),
        [known(1, 3, false)],
      ),
    },
    // 4 - the opponent shoots me: blank
    {
      label: "Opponent shoots you (BLANK)",
      auto: 2100,
      model: base(
        mkView(players({ me: 3, l: 1, r: 3 }), { current: L, fired: 2, magazine: mag(2, 2) }),
        [known(0, 3, false)],
        {
          busy: true,
          banner: banner("BLANK", BLUE),
          message: msg(`${nm(L)} shoots ${nm(you)}: BLANK.`),
          aim: { shooter: L, target: you, shotId: uid() },
          fx: { id: uid(), kind: "flash-blank" },
        },
      ),
    },
    // 5 - the other opponent's turn
    {
      label: "Other opponent's turn",
      auto: 2200,
      model: base(
        mkView(players({ me: 3, l: 1, r: 3 }), { current: R, fired: 2, magazine: mag(2, 2) }),
        [known(0, 3, false)],
      ),
    },
    // 6 - they use the Inverter: my knowledge becomes outdated
    {
      label: "Inverter used (your info is outdated)",
      auto: 2200,
      model: base(
        mkView(players({ me: 3, l: 1, r: 3 }, { cuffedR: false }), { current: R, fired: 2, magazine: mag(2, 2) }),
        [known(0, 3, false, true)],
        {
          busy: true,
          banner: banner(ITEM_DEFS.inverter.name, ITEM_DEFS.inverter.color),
          message: msg(`${nm(R)} inverts the chamber shell.`),
          fx: { id: uid(), kind: "flash-item", color: ITEM_DEFS.inverter.color },
        },
      ),
    },
    // 7 - they shoot me: live
    {
      label: "Opponent shoots you (LIVE)",
      auto: 2200,
      model: base(
        mkView(players({ me: 2, l: 1, r: 3 }), { current: R, fired: 3, magazine: mag(1, 2) }),
        [],
        {
          busy: true,
          banner: banner("LIVE", RED),
          message: msg(`${nm(R)} shoots ${nm(you)}: LIVE! -1 HP`, true),
          aim: { shooter: R, target: you, shotId: uid() },
          fx: { id: uid(), kind: "flash-live", shake: true },
        },
      ),
    },
    // 8 - my turn again
    {
      label: "Your turn again",
      waits: true,
      model: base(
        mkView(players({ me: 2, l: 1, r: 3 }, { meItems: ["magnifier", "handcuffs", "saw"] }), {
          current: you,
          fired: 3,
          magazine: mag(1, 2),
        }),
        [],
      ),
    },
    // 9 - I shoot the left opponent: live, they drop to 0
    {
      label: "You eliminate an opponent",
      auto: 1900,
      model: base(
        mkView(players({ me: 2, l: 0, r: 3 }, { lAlive: true, meItems: ["magnifier", "handcuffs", "saw"] }), {
          current: you,
          fired: 4,
          magazine: mag(0, 2),
        }),
        [],
        {
          busy: true,
          banner: banner("LIVE", RED),
          message: msg(`${nm(you)} shoots ${nm(L)}: LIVE! -1 HP`, true),
          aim: { shooter: you, target: L, shotId: uid() },
          fx: { id: uid(), kind: "flash-live", shake: true },
        },
      ),
    },
    // 10 - elimination stamp
    {
      label: "Elimination",
      auto: 2200,
      model: base(
        mkView(players({ me: 2, l: 0, r: 3 }, { lAlive: false, meItems: ["magnifier", "handcuffs", "saw"] }), {
          current: you,
          fired: 4,
          magazine: mag(0, 2),
        }),
        [],
        {
          busy: true,
          banner: banner(`${nm(L)} OUT`, RED),
          message: msg(`${nm(L)} IS ELIMINATED`, true),
          fx: { id: uid(), kind: "flash-out", shake: true },
        },
      ),
    },
    // 11 - head to head
    {
      label: "Head to head",
      waits: true,
      model: base(
        mkView(players({ me: 2, l: 0, r: 1 }, { lAlive: false, meItems: ["magnifier", "handcuffs", "saw"] }), {
          current: you,
          loadNumber: 2,
          fired: 1,
          magazine: mag(2, 1),
        }),
        [],
      ),
    },
    // 12 - the final shot
    {
      label: "The final shot",
      auto: 2600,
      model: base(
        mkView(players({ me: 2, l: 0, r: 0 }, { lAlive: false, rAlive: false, meItems: ["magnifier", "handcuffs", "saw"] }), {
          current: you,
          loadNumber: 2,
          fired: 2,
          magazine: mag(1, 1),
        }),
        [],
        {
          busy: true,
          banner: banner("LIVE", RED),
          message: msg(`${nm(you)} shoots ${nm(R)}: LIVE! -1 HP`, true),
          aim: { shooter: you, target: R, shotId: uid() },
          fx: { id: uid(), kind: "flash-live", shake: true },
        },
      ),
    },
    // 13 - game over
    {
      label: "Winner",
      model: base(
        mkView(players({ me: 2, l: 0, r: 0 }, { lAlive: false, rAlive: false, meItems: [] }), {
          phase: "GAME_OVER",
          current: you,
          loadNumber: 2,
          fired: 2,
          magazine: mag(1, 1),
          winner: you,
        }),
        [],
      ),
    },
  ];
}
