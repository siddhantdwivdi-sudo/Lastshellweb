// Static "jump to" states for inspecting every part of the game screen without playing through.

import { opponentsOf } from "../lib/layout";
import type { GameUiModel } from "../ui/model";
import { mkRoom } from "./builders";
import type { MockFrame } from "./playScript";

export interface Scenario {
  id: string;
  label: string;
  build(script: MockFrame[], you: number): GameUiModel;
}

const clone = (m: GameUiModel): GameUiModel => structuredClone(m);

export const SCENARIOS: Scenario[] = [
  { id: "your-turn", label: "Your turn (intel)", build: (s) => clone(s[1].model) },
  { id: "opponent-turn", label: "Opponent's turn", build: (s) => clone(s[3].model) },
  { id: "result-live", label: "Shot result: LIVE", build: (s) => clone(s[2].model) },
  { id: "inverter", label: "Outdated info (Inverter)", build: (s) => clone(s[6].model) },
  { id: "reload", label: "Reload overlay", build: (s) => clone(s[0].model) },
  { id: "elimination", label: "Elimination", build: (s) => clone(s[10].model) },
  { id: "winner-admin", label: "Winner (you are admin)", build: (s) => clone(s[13].model) },
  {
    id: "winner-guest",
    label: "Winner (not admin)",
    build: (s, you) => {
      const m = clone(s[13].model);
      const admin = opponentsOf(you).left;
      m.room = mkRoom({ code: m.room.code, you, admin, status: "GAME_OVER" });
      return m;
    },
  },
  {
    id: "opponent-won",
    label: "You lost",
    build: (s, you) => {
      const m = clone(s[13].model);
      const { left } = opponentsOf(you);
      m.view.winner = left;
      m.view.players[you] = { ...m.view.players[you], hp: 0, alive: false, items: [] };
      m.view.players[left] = { ...m.view.players[left], hp: 1, alive: true };
      return m;
    },
  },
  {
    id: "spectating",
    label: "You are eliminated (spectating)",
    build: (s, you) => {
      const m = clone(s[3].model);
      m.view.players[you] = { ...m.view.players[you], hp: 0, alive: false, items: [] };
      return m;
    },
  },
  {
    id: "disconnected",
    label: "Opponent disconnected",
    build: (s, you) => {
      const m = clone(s[1].model);
      const { left } = opponentsOf(you);
      m.room = mkRoom({
        code: m.room.code,
        you,
        admin: m.room.adminSeat ?? 0,
        status: "IN_MATCH",
        disconnected: [{ seat: left, graceMs: 42_000 }],
      });
      return m;
    },
  },
  {
    id: "reconnecting",
    label: "Reconnecting…",
    build: (s) => ({ ...clone(s[1].model), reconnecting: true }),
  },
  {
    id: "error",
    label: "Rejected action (error)",
    build: (s) => ({ ...clone(s[1].model), message: { id: Date.now(), text: "It's not your turn.", bad: true } }),
  },
];
