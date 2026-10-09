// Turns server-only state/events into what ONE seat is allowed to see.
// Every object is built field by field (never spread from engine state) so a new hidden field
// can't leak by accident.

import type {
  ClientEvent,
  ClientEventBody,
  KnownShell,
  LegalOptions,
  PrivateView,
  PublicGameView,
} from "@lastshell/shared";
import { cuffTargets, isStealable, opponents, usableNow } from "../engine/items";
import type { EngineEvent, GameState } from "../engine/types";

export function projectPublic(state: GameState): PublicGameView {
  const live = state.shells.filter((s) => s).length;
  return {
    phase: state.phase,
    current: state.current,
    loadNumber: state.loadNumber,
    fired: state.fired,
    magazine: { total: state.shells.length, live, blank: state.shells.length - live },
    players: state.players.map((p) => ({
      seat: p.seat,
      hp: p.hp,
      alive: p.alive,
      slots: p.slots,
      items: [...p.items],
      sawed: p.sawed,
      cuffed: p.cuffed,
    })),
    winner: state.winner,
  };
}

/**
 * Greys-out hints for the player whose turn it is. Uses only public facts (counts, flags, item
 * lists) and the player's own items. null when it isn't their turn.
 */
export function projectLegal(state: GameState, seat: number): LegalOptions | null {
  if (state.phase !== "AWAITING" || state.current !== seat) return null;
  const user = state.players[seat];
  if (!user.alive) return null;
  const steal: (boolean[] | null)[] = state.players.map(() => null);
  for (const id of opponents(state, user)) {
    steal[id] = state.players[id].items.map((it) => isStealable(state, it, user));
  }
  return {
    itemBlocked: user.items.map((it) => usableNow(state, it, user) || null),
    cuffTargets: cuffTargets(state, user),
    steal,
  };
}

/** Only this seat's own observations. After game over nothing is shown (as in the prototype). */
export function projectPrivate(state: GameState, seat: number): PrivateView {
  const knownShells: KnownShell[] = [];
  if (state.phase !== "GAME_OVER") {
    for (let i = 0; i < state.shells.length; i++) {
      const obs = state.observations[i][seat];
      if (obs) {
        knownShells.push({
          position: i,
          shellNumber: state.fired + i + 1,
          observedLive: obs.live,
          stale: obs.stale,
        });
      }
    }
  }
  return { knownShells, legal: projectLegal(state, seat) };
}

function projectBody(ev: EngineEvent, seat: number): ClientEventBody {
  switch (ev.type) {
    case "matchStarted":
      return { type: "matchStarted" };
    case "reload":
      return { type: "reload", loadNumber: ev.loadNumber, live: ev.live, blank: ev.blank };
    case "turnBegan":
      return { type: "turnBegan", seat: ev.seat, announce: ev.announce };
    case "shotFired":
      return { type: "shotFired", shooter: ev.shooter, target: ev.target };
    case "shotResolved":
      return {
        type: "shotResolved",
        shooter: ev.shooter,
        target: ev.target,
        live: ev.live,
        damage: ev.damage,
        selfShot: ev.selfShot,
        message: ev.message,
      };
    case "itemUsed": {
      const mine = ev.seat === seat;
      const body: ClientEventBody = {
        type: "itemUsed",
        seat: ev.seat,
        item: ev.item,
        hpChange: ev.hpChange,
        eject: ev.eject,
        text: mine ? ev.privateText : ev.publicText,
      };
      if (mine && ev.reveal) {
        body.reveal = { kind: ev.reveal.kind, shellNumber: ev.reveal.shellNumber, live: ev.reveal.live };
      }
      return body;
    }
    case "skipped":
      return { type: "skipped", seat: ev.seat };
    case "eliminated":
      return { type: "eliminated", seat: ev.seat };
    case "gameOver":
      return { type: "gameOver", winner: ev.winner };
  }
}

export function projectEvent(ev: EngineEvent, seat: number): ClientEvent {
  return {
    ...projectBody(ev, seat),
    view: projectPublic(ev.after),
    private: projectPrivate(ev.after, seat),
  };
}
