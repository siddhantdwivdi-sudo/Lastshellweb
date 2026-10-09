import { PLAYER_COUNT } from "@lastshell/shared";
import { describe, expect, it } from "vitest";
import { mkRoom } from "./builders";
import { SCENARIOS } from "./gallery";
import { buildPlayScript } from "./playScript";

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe("mock data stays inside the public protocol", () => {
  for (const you of [0, 1, 2]) {
    const room = mkRoom({ you, admin: 0, status: "IN_MATCH" });
    const script = buildPlayScript(you, room);

    it(`scripted match for seat ${you} is internally consistent`, () => {
      expect(script.length).toBeGreaterThan(10);
      for (const frame of script) {
        const { view } = frame.model;
        expect(view.players).toHaveLength(PLAYER_COUNT);
        expect(view.magazine.total).toBe(view.magazine.live + view.magazine.blank);
        for (const p of view.players) {
          // Between a shot and its "eliminated" event the server legitimately shows hp 0 while still alive.
          if (!p.alive) expect(p.hp).toBe(0);
          else expect(p.hp).toBeGreaterThanOrEqual(0);
        }
        if (view.phase === "AWAITING") expect(view.players[view.current].alive).toBe(true);
        else expect(view.winner).not.toBeNull();
        // the UI must only ever be given things the real server would send
        const keys = collectKeys(frame.model);
        for (const bad of ["shells", "observations", "after", "token"]) expect(keys.has(bad)).toBe(false);
        // private knowledge must refer to shells that are still inside
        for (const k of frame.model.private.knownShells) expect(k.position).toBeLessThan(Math.max(view.magazine.total, 1));
      }
    });

    it(`every gallery scenario builds for seat ${you}`, () => {
      for (const sc of SCENARIOS) {
        const model = sc.build(script, you);
        expect(model.you).toBe(you);
        expect(model.view.players).toHaveLength(PLAYER_COUNT);
      }
    });
  }
});
