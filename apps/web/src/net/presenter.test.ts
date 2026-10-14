import { describe, expect, it } from "vitest";
import { applyEvent, buildGameModel, displayFrom } from "./presenter";
import { ev, priv, room, view } from "./testkit";

describe("scene cues come straight from server events", () => {
  const start = displayFrom(view(), priv());

  it("a live shot carries who shot, who was hit and the damage the server applied", () => {
    const d = applyEvent(start, ev({ type: "shotResolved", shooter: 1, target: 0, live: true, damage: 2, selfShot: false, message: "m" }));
    expect(d.cues.shot).toMatchObject({ shooter: 1, target: 0, live: true, damage: 2, selfShot: false });
  });

  it("a blank is a dry click: live is false and no damage", () => {
    const d = applyEvent(start, ev({ type: "shotResolved", shooter: 0, target: 0, live: false, damage: 0, selfShot: true, message: "m" }));
    expect(d.cues.shot).toMatchObject({ live: false, damage: 0, selfShot: true });
  });

  it("every event gets a fresh cue id, so an animation plays once and never replays on re-render", () => {
    const a = applyEvent(start, ev({ type: "shotResolved", shooter: 1, target: 0, live: true, damage: 1, selfShot: false, message: "m" }));
    const b = applyEvent(a, ev({ type: "shotResolved", shooter: 1, target: 0, live: true, damage: 1, selfShot: false, message: "m" }));
    expect(b.cues.shot!.id).not.toBe(a.cues.shot!.id);
    // unrelated events leave the existing cue untouched (same id, nothing to replay)
    const c = applyEvent(b, ev({ type: "turnBegan", seat: 2, announce: true }));
    expect(c.cues.shot!.id).toBe(b.cues.shot!.id);
  });

  it("eliminations and item uses are cues too", () => {
    const e = applyEvent(start, ev({ type: "eliminated", seat: 2 }));
    expect(e.cues.elim).toMatchObject({ seat: 2 });
    const i = applyEvent(start, ev({ type: "itemUsed", seat: 1, item: "medicine", hpChange: -1, eject: -1, text: "t" }));
    expect(i.cues.item).toMatchObject({ seat: 1, item: "medicine", hpChange: -1 });
  });

  it("a new match clears every cue; the model hands them to the screen unchanged", () => {
    const shot = applyEvent(start, ev({ type: "shotResolved", shooter: 1, target: 0, live: true, damage: 1, selfShot: false, message: "m" }));
    const fresh = applyEvent(shot, ev({ type: "matchStarted" }));
    expect(fresh.cues).toEqual({ shot: null, elim: null, item: null });
    const model = buildGameModel({ seat: 0, room: room(), display: shot, busy: false, pending: false, reconnecting: false });
    expect(model.cues).toBe(shot.cues);
  });

  it("cues contain nothing but public event facts (no hidden shell data)", () => {
    const d = applyEvent(start, ev({ type: "shotResolved", shooter: 1, target: 0, live: true, damage: 1, selfShot: false, message: "m" }));
    expect(Object.keys(d.cues.shot!).sort()).toEqual(["damage", "id", "live", "selfShot", "shooter", "target"]);
  });
});
