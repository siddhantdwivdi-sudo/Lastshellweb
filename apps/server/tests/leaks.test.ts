import { PLAYER_COUNT } from "@lastshell/shared";
import { describe, expect, it } from "vitest";
import { createSeededRng, type GameState } from "../src/engine";
import { projectEvent, projectPrivate, projectPublic } from "../src/views";
import { playRandomGame } from "./sim";

const FORBIDDEN_KEYS = ["shells", "observations", "after", "publicText", "privateText"];

function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe("nothing hidden is ever sent to a client", () => {
  it("projected events never contain engine-only fields, and only the user gets reveals", () => {
    let eventsChecked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      playRandomGame(seed, (_state, events) => {
        for (const ev of events) {
          for (let seat = 0; seat < PLAYER_COUNT; seat++) {
            const out = projectEvent(ev, seat);
            const keys = collectKeys(out);
            for (const bad of FORBIDDEN_KEYS) expect(keys.has(bad), `key ${bad}`).toBe(false);
            if (ev.type === "itemUsed") {
              const o = out as { reveal?: unknown; text: string };
              if (ev.seat !== seat) {
                expect(o.reveal).toBeUndefined();
                if (ev.item === "magnifier" || ev.item === "phone") {
                  expect(o.text, `seed ${seed}: ${o.text}`).not.toMatch(/LIVE|BLANK|Shell #/);
                }
              }
            } else {
              expect(keys.has("reveal")).toBe(false);
            }
            eventsChecked++;
          }
        }
      });
    }
    expect(eventsChecked).toBeGreaterThan(5000);
  });

  it("a seat's view is unchanged by anything it doesn't know (non-interference)", () => {
    const pick = createSeededRng(123);
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      playRandomGame(seed, (state) => {
        for (let seat = 0; seat < PLAYER_COUNT; seat++) {
          const tampered = structuredClone(state) as GameState;
          // (a) re-order the shells this seat has NOT observed (counts stay the same)
          const unknown: number[] = [];
          tampered.shells.forEach((_, i) => {
            if (tampered.observations[i][seat] === null) unknown.push(i);
          });
          const values = unknown.map((i) => tampered.shells[i]);
          pick.shuffle(values);
          unknown.forEach((idx, n) => (tampered.shells[idx] = values[n]));
          // (b) scramble every other seat's private observations
          tampered.observations.forEach((row) =>
            row.forEach((_, s) => {
              if (s !== seat) row[s] = pick.float() < 0.5 ? null : { live: pick.float() < 0.5, stale: false };
            }),
          );
          expect(JSON.stringify(projectPublic(tampered))).toBe(JSON.stringify(projectPublic(state)));
          expect(JSON.stringify(projectPrivate(tampered, seat))).toBe(JSON.stringify(projectPrivate(state, seat)));
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("stale knowledge is only ever reported for the chamber and fresh knowledge is accurate", () => {
    for (let seed = 1; seed <= 40; seed++) {
      playRandomGame(seed, (state) => {
        for (let seat = 0; seat < PLAYER_COUNT; seat++) {
          for (const k of projectPrivate(state, seat).knownShells) {
            if (k.stale) expect(k.position).toBe(0);
            else expect(k.observedLive).toBe(state.shells[k.position]);
          }
        }
      });
    }
  });
});
