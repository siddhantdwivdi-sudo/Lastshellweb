// Pure functions that turn what the server sends into what the screen shows.
// No sockets, no timers, no DOM: this is the part that is easiest to unit test.

import { ITEM_DEFS, type ClientEvent, type PrivateView, type PublicGameView, type RoomState } from "@lastshell/shared";
import { seatName } from "../lib/layout";
import type { AimModel, BannerModel, FxModel, GameUiModel, MessageModel, ReloadModel } from "../ui/model";

const RED = "#EB2B1F";
const BLUE = "#739EF2";
const AMBER = "#FFA838";

/** What is on screen right now. It trails the server while events are being played back. */
export interface DisplayState {
  view: PublicGameView;
  private: PrivateView;
  banner: BannerModel | null;
  message: MessageModel | null;
  aim: AimModel | null;
  fx: FxModel | null;
  reload: ReloadModel | null;
}

let nextId = 1;
export function newId(): number {
  nextId += 1;
  return nextId;
}

export function displayFrom(view: PublicGameView, priv: PrivateView): DisplayState {
  return { view, private: priv, banner: null, message: null, aim: null, fx: null, reload: null };
}

/** Applies ONE server event to the display (state first, then the animation cues for it). */
export function applyEvent(prev: DisplayState | null, ev: ClientEvent): DisplayState {
  const base: DisplayState = prev
    ? { ...prev, view: ev.view, private: ev.private, reload: null }
    : displayFrom(ev.view, ev.private);

  switch (ev.type) {
    case "matchStarted":
      return { ...base, banner: null, message: null, aim: null, fx: null };
    case "reload":
      return { ...base, reload: { loadNumber: ev.loadNumber, live: ev.live, blank: ev.blank } };
    case "turnBegan":
      return { ...base, aim: null };
    case "shotFired":
      return { ...base, aim: { shooter: ev.shooter, target: ev.target, shotId: newId() } };
    case "shotResolved":
      return {
        ...base,
        banner: { id: newId(), text: ev.live ? "LIVE" : "BLANK", color: ev.live ? RED : BLUE },
        message: { id: newId(), text: ev.message, bad: ev.live },
        fx: ev.live ? { id: newId(), kind: "flash-live", shake: true } : { id: newId(), kind: "flash-blank" },
      };
    case "itemUsed": {
      const def = ITEM_DEFS[ev.item];
      return {
        ...base,
        banner: { id: newId(), text: def.name, color: def.color },
        message: { id: newId(), text: ev.text, bad: ev.hpChange < 0 },
        fx: { id: newId(), kind: "flash-item", color: def.color, shake: ev.hpChange < 0 },
      };
    }
    case "skipped":
      return {
        ...base,
        banner: { id: newId(), text: "SKIPPED", color: AMBER },
        message: { id: newId(), text: `${seatName(ev.seat)} IS HANDCUFFED - TURN SKIPPED`, bad: true },
      };
    case "eliminated":
      return {
        ...base,
        banner: { id: newId(), text: `${seatName(ev.seat)} OUT`, color: RED },
        message: { id: newId(), text: `${seatName(ev.seat)} IS ELIMINATED`, bad: true },
        fx: { id: newId(), kind: "flash-out", shake: true },
      };
    case "gameOver":
      return base;
  }
}

export function withMessage(display: DisplayState, text: string, bad = true): DisplayState {
  return { ...display, message: { id: newId(), text, bad } };
}

export interface ModelInputs {
  seat: number;
  room: RoomState;
  display: DisplayState;
  busy: boolean;
  pending: boolean;
  reconnecting: boolean;
}

export function buildGameModel(i: ModelInputs): GameUiModel {
  const d = i.display;
  return {
    you: i.seat,
    view: d.view,
    private: d.private,
    room: i.room,
    busy: i.busy,
    pending: i.pending,
    reconnecting: i.reconnecting,
    banner: d.banner,
    message: d.message,
    aim: d.aim,
    fx: d.fx,
    reload: d.reload,
  };
}
