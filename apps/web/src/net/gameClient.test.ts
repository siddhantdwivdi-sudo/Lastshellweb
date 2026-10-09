import { C2S, S2C, type ClientEvent } from "@lastshell/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameClient, memoryStore, type KeyValueStore } from "./gameClient";
import { applyEvent, displayFrom } from "./presenter";
import { FakeSocket, batch, ev, player, priv, room, snapshot, view } from "./testkit";

const TOKEN = "T".repeat(22);

interface Rig {
  socket: FakeSocket;
  client: GameClient;
  storage: KeyValueStore;
  state: () => ReturnType<GameClient["getState"]>;
}

/** A client connected to a fake server that is in a running match, seat 0, with an idle table. */
function inMatch(opts: { seat?: number; storage?: KeyValueStore } = {}): Rig {
  const storage = opts.storage ?? memoryStore();
  const socket = new FakeSocket();
  const client = new GameClient({ socket, storage, ackTimeoutMs: 1000, resumeRetryMs: 500 });
  socket.replies.set(C2S.create, () => ({ ok: true, code: "ABCDE", seat: opts.seat ?? 0, token: TOKEN }));
  socket.replies.set(C2S.action, () => ({ ok: true, version: 99 }));
  client.connect();
  return { socket, client, storage, state: () => client.getState() };
}

async function enter(rig: Rig, seat = 0): Promise<void> {
  await rig.client.createRoom();
  rig.socket.push(S2C.roomState, room({ you: seat }));
  rig.socket.push(S2C.snapshot, snapshot({ you: seat, view: view({ current: seat }), version: 5 }));
}

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  // The client must never log anything (payloads may contain private information).
  for (const s of spies) expect(s).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("presenter", () => {
  const v = view();
  it("maps shot results to banners, messages and effects", () => {
    const live = applyEvent(displayFrom(v, priv()), ev({ type: "shotResolved", shooter: 0, target: 1, live: true, damage: 1, selfShot: false, message: "PLAYER 1 shoots PLAYER 2: LIVE! -1 HP" }));
    expect(live.banner?.text).toBe("LIVE");
    expect(live.message).toMatchObject({ text: "PLAYER 1 shoots PLAYER 2: LIVE! -1 HP", bad: true });
    expect(live.fx).toMatchObject({ kind: "flash-live", shake: true });
    const blank = applyEvent(live, ev({ type: "shotResolved", shooter: 0, target: 1, live: false, damage: 0, selfShot: false, message: "BLANK." }));
    expect(blank.banner?.text).toBe("BLANK");
    expect(blank.fx?.kind).toBe("flash-blank");
  });

  it("shows exactly the text the server chose for this player (no extra secrets)", () => {
    const mine = applyEvent(null, ev({ type: "itemUsed", seat: 0, item: "magnifier", hpChange: 0, eject: -1, text: "PLAYER 1 inspects the chamber: LIVE", reveal: { kind: "chamber", shellNumber: 1, live: true } }));
    const others = applyEvent(null, ev({ type: "itemUsed", seat: 0, item: "magnifier", hpChange: 0, eject: -1, text: "PLAYER 1 inspects the chamber." }));
    expect(mine.message?.text).toContain("LIVE");
    expect(others.message?.text).not.toMatch(/LIVE|BLANK/);
    expect(others.banner?.text).toBe("MAGNIFYING GLASS");
  });

  it("covers reload, aim, skip, elimination and the idle gun", () => {
    const d1 = applyEvent(null, ev({ type: "reload", loadNumber: 2, live: 3, blank: 2 }));
    expect(d1.reload).toEqual({ loadNumber: 2, live: 3, blank: 2 });
    const d2 = applyEvent(d1, ev({ type: "shotFired", shooter: 0, target: 2 }));
    expect(d2.reload).toBeNull();
    expect(d2.aim).toMatchObject({ shooter: 0, target: 2 });
    expect(applyEvent(d2, ev({ type: "turnBegan", seat: 1, announce: true })).aim).toBeNull();
    expect(applyEvent(d2, ev({ type: "skipped", seat: 1 })).message?.text).toBe("PLAYER 2 IS HANDCUFFED - TURN SKIPPED");
    const out = applyEvent(d2, ev({ type: "eliminated", seat: 2 }));
    expect(out.banner?.text).toBe("PLAYER 3 OUT");
    expect(out.fx?.kind).toBe("flash-out");
  });

  it("takes the state from the event itself", () => {
    const next = view({ current: 2, fired: 3 });
    const d = applyEvent(displayFrom(v, priv()), ev({ type: "turnBegan", seat: 2, announce: true }, next));
    expect(d.view.current).toBe(2);
    expect(d.view.fired).toBe(3);
  });
});

describe("room lifecycle", () => {
  it("creates a room, stores the session per tab, and follows the server's room state", async () => {
    const rig = inMatch();
    expect(rig.state().connection).toBe("ready");
    await rig.client.createRoom();
    expect(rig.state().session).toEqual({ code: "ABCDE", seat: 0, token: TOKEN });
    expect(JSON.parse(rig.storage.getItem("lastshell.session")!)).toMatchObject({ code: "ABCDE" });
    rig.socket.push(S2C.roomState, room({ status: "LOBBY" }));
    expect(rig.state().room?.status).toBe("LOBBY");
  });

  it("shows server refusals for create and join", async () => {
    const rig = inMatch();
    rig.socket.replies.set(C2S.create, () => ({ ok: false, code: "RATE_LIMITED", message: "x" }));
    await rig.client.createRoom();
    expect(rig.state().notice?.text).toMatch(/Too many/);
    rig.socket.replies.set(C2S.join, () => ({ ok: false, code: "ROOM_FULL", message: "That room is full." }));
    expect(await rig.client.joinRoom("ABCDE")).toBe("That room is full.");
    rig.socket.replies.set(C2S.join, () => ({ ok: false, code: "ROOM_NOT_FOUND", message: "No room with that code." }));
    expect(await rig.client.joinRoom("ABCDF")).toBe("No room with that code.");
    expect(rig.state().session).toBeNull();
    expect(rig.state().joining).toBe(false);
  });

  it("times out cleanly when the server does not answer", async () => {
    const rig = inMatch();
    rig.socket.replies.delete(C2S.create);
    const pending = rig.client.createRoom();
    await vi.advanceTimersByTimeAsync(1100);
    await pending;
    expect(rig.state().creating).toBe(false);
    expect(rig.state().notice?.text).toMatch(/didn't answer/);
  });

  it("only the admin can start; start errors become a toast", async () => {
    const rig = inMatch();
    await rig.client.createRoom();
    rig.socket.push(S2C.roomState, room({ status: "LOBBY", you: 1, adminSeat: 0 }));
    await rig.client.startMatch();
    expect(rig.socket.count(C2S.start)).toBe(0);
    rig.socket.push(S2C.roomState, room({ status: "LOBBY", you: 0, adminSeat: 0 }));
    rig.socket.replies.set(C2S.start, () => ({ ok: false, code: "ROOM_NOT_FULL", message: "All three players must be connected." }));
    await rig.client.startMatch();
    expect(rig.socket.count(C2S.start)).toBe(1);
    expect(rig.state().toast?.text).toBe("All three players must be connected.");
    expect(rig.state().starting).toBe(false);
    await vi.advanceTimersByTimeAsync(5100);
    expect(rig.state().toast).toBeNull();
  });

  it("leaving clears the session and ignores late room updates", async () => {
    const rig = inMatch();
    rig.socket.replies.set(C2S.leave, () => ({ ok: true }));
    await enter(rig);
    await rig.client.leaveRoom();
    expect(rig.state().session).toBeNull();
    expect(rig.state().room).toBeNull();
    expect(rig.storage.getItem("lastshell.session")).toBeNull();
    rig.socket.push(S2C.roomState, room({ status: "LOBBY" }));
    expect(rig.state().room).toBeNull();
  });

  it("announces admin changes and disconnected players", async () => {
    const rig = inMatch();
    await enter(rig, 1);
    const base = room({ you: 1, adminSeat: 0 });
    rig.socket.push(S2C.roomState, { ...base, adminSeat: 1, seats: base.seats.map((s) => s && { ...s, isAdmin: s.seat === 1 }) });
    expect(rig.state().toast?.text).toBe("You are now the room admin.");
    const gone = room({ you: 1, adminSeat: 1 });
    rig.socket.push(S2C.roomState, { ...gone, seats: gone.seats.map((s) => (s && s.seat === 2 ? { ...s, connected: false, graceEndsAt: Date.now() + 60000 } : s)) });
    expect(rig.state().toast?.text).toMatch(/PLAYER 3 disconnected/);
  });

  it("returns to the lobby view when the room goes back to the lobby", async () => {
    const rig = inMatch();
    await enter(rig);
    expect(rig.state().display).not.toBeNull();
    rig.socket.push(S2C.roomState, room({ status: "LOBBY" }));
    expect(rig.state().display).toBeNull();
  });
});

describe("reconnecting", () => {
  function stored(): KeyValueStore {
    const s = memoryStore();
    s.setItem("lastshell.session", JSON.stringify({ code: "ABCDE", seat: 1, token: TOKEN }));
    return s;
  }

  it("resumes the saved seat on connect and shows reconnecting meanwhile", () => {
    const socket = new FakeSocket();
    const client = new GameClient({ socket, storage: stored(), ackTimeoutMs: 1000 });
    client.connect();
    expect(socket.last(C2S.resume)?.payload).toEqual({ code: "ABCDE", token: TOKEN });
    expect(client.getState().resuming).toBe(true);
    socket.last(C2S.resume)!.ack!({ ok: true, code: "ABCDE", seat: 1, token: TOKEN });
    return Promise.resolve().then(() => expect(client.getState().resuming).toBe(false));
  });

  it.each([
    ["ROOM_NOT_FOUND", /no longer exists/],
    ["INVALID_TOKEN", /seat expired/],
  ])("%s clears the session and explains why", async (code, text) => {
    const socket = new FakeSocket();
    socket.replies.set(C2S.resume, () => ({ ok: false, code, message: "x" }));
    const store = stored();
    const client = new GameClient({ socket, storage: store });
    client.connect();
    await Promise.resolve();
    const s = client.getState();
    expect(s.session).toBeNull();
    expect(s.notice?.text).toMatch(text);
    expect(store.getItem("lastshell.session")).toBeNull();
  });

  it("retries a temporary failure later without losing the session", async () => {
    const socket = new FakeSocket();
    let calls = 0;
    socket.replies.set(C2S.resume, () => (++calls === 1 ? { ok: false, code: "RATE_LIMITED", message: "x" } : { ok: true, code: "ABCDE", seat: 1, token: TOKEN }));
    const client = new GameClient({ socket, storage: stored(), resumeRetryMs: 500 });
    client.connect();
    await vi.advanceTimersByTimeAsync(10);
    expect(client.getState().session).not.toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toBe(2);
    expect(client.getState().resuming).toBe(false);
  });

  it("a dropped connection mid-match keeps the match on screen and resumes after reconnect", async () => {
    const rig = inMatch();
    rig.socket.replies.set(C2S.resume, () => ({ ok: true, code: "ABCDE", seat: 0, token: TOKEN }));
    await enter(rig);
    rig.socket.disconnect();
    expect(rig.state().socketConnected).toBe(false);
    expect(rig.state().display).not.toBeNull();
    expect(rig.client.canAct()).toBe(false);
    rig.socket.connect();
    await vi.advanceTimersByTimeAsync(5);
    expect(rig.socket.count(C2S.resume)).toBe(1);
    expect(rig.state().resuming).toBe(false);
  });

  it("a snapshot replaces whatever was being played", async () => {
    const rig = inMatch();
    await enter(rig);
    rig.socket.push(S2C.events, batch(6, 1000, [ev({ type: "shotFired", shooter: 0, target: 1 }), ev({ type: "shotResolved", shooter: 0, target: 1, live: true, damage: 1, selfShot: false, message: "m" })]));
    expect(rig.state().busy).toBe(true);
    rig.socket.push(S2C.snapshot, snapshot({ version: 9, view: view({ current: 2, fired: 4 }), busy: false }));
    expect(rig.state().display?.view.fired).toBe(4);
    expect(rig.state().busy).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(rig.state().display?.view.fired).toBe(4); // the old queue never overwrote it
  });

  it("another window taking the seat sends this one back to the title", async () => {
    const rig = inMatch();
    await enter(rig);
    rig.socket.push(S2C.replaced);
    expect(rig.state().session).toBeNull();
    expect(rig.state().notice?.text).toMatch(/another window/);
  });
});

describe("event playback", () => {
  it("plays events in order at the server's pace and never goes backwards", async () => {
    const rig = inMatch();
    await enter(rig);
    const v1 = view({ current: 0, fired: 1 });
    const v2 = view({ current: 1, fired: 1 });
    rig.socket.push(
      S2C.events,
      batch(6, 2100, [
        ev({ type: "shotFired", shooter: 0, target: 1 }, v1),
        ev({ type: "shotResolved", shooter: 0, target: 1, live: true, damage: 1, selfShot: false, message: "hit" }, v1),
        ev({ type: "turnBegan", seat: 1, announce: true }, v2),
      ]),
    );
    expect(rig.state().display?.aim).not.toBeNull(); // first event shown immediately
    expect(rig.state().display?.banner).toBeNull();
    expect(rig.state().display?.view.current).toBe(0);
    await vi.advanceTimersByTimeAsync(900);
    expect(rig.state().display?.banner?.text).toBe("LIVE");
    expect(rig.state().display?.view.current).toBe(0);
    await vi.advanceTimersByTimeAsync(1200);
    expect(rig.state().display?.view.current).toBe(1);
    // the table is still "busy" until the server says idle
    expect(rig.state().busy).toBe(true);
    rig.socket.push(S2C.idle, { version: 6 });
    expect(rig.state().busy).toBe(false);
  });

  it("ignores old and repeated batches", async () => {
    const rig = inMatch();
    await enter(rig);
    const newer = batch(7, 0, [ev({ type: "turnBegan", seat: 2, announce: true }, view({ current: 2 }))]);
    rig.socket.push(S2C.events, newer);
    expect(rig.state().display?.view.current).toBe(2);
    rig.socket.push(S2C.events, batch(6, 0, [ev({ type: "turnBegan", seat: 1, announce: true }, view({ current: 1 }))]));
    rig.socket.push(S2C.events, newer);
    expect(rig.state().display?.view.current).toBe(2);
  });

  it("an idle for an older version does not unlock the table", async () => {
    const rig = inMatch();
    await enter(rig);
    rig.socket.push(S2C.events, batch(7, 0, [ev({ type: "turnBegan", seat: 0, announce: false })]));
    rig.socket.push(S2C.idle, { version: 6 });
    expect(rig.state().busy).toBe(true);
    rig.socket.push(S2C.idle, { version: 7 });
    expect(rig.state().busy).toBe(false);
  });
});

describe("sending actions", () => {
  it("only when it is my turn, the table is idle and nothing is in flight", async () => {
    const rig = inMatch();
    await enter(rig, 0);
    expect(rig.client.canAct()).toBe(true);
    rig.client.shoot(1);
    expect(rig.socket.count(C2S.action)).toBe(1);

    const other = inMatch();
    await enter(other, 1); // snapshot says current = 1 -> change it to someone else's turn
    other.socket.push(S2C.snapshot, snapshot({ you: 1, version: 8, view: view({ current: 2 }) }));
    other.client.shoot(0);
    expect(other.socket.count(C2S.action)).toBe(0);

    const busy = inMatch();
    await enter(busy, 0);
    busy.socket.push(S2C.events, batch(6, 5000, [ev({ type: "shotFired", shooter: 0, target: 1 })]));
    busy.client.shoot(1);
    expect(busy.socket.count(C2S.action)).toBe(0);
  });

  it("sends the version, a fresh action id and the exact action", async () => {
    const rig = inMatch();
    await enter(rig);
    rig.client.useItem(2, { target: 1, stealSlot: 0, subTarget: 2 });
    const sent = rig.socket.last(C2S.action)!.payload as any;
    expect(sent.version).toBe(5);
    expect(sent.actionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(sent.action).toEqual({ type: "useItem", slot: 2, args: { target: 1, stealSlot: 0, subTarget: 2 } });
    expect(Object.keys(sent).sort()).toEqual(["action", "actionId", "version"]); // never a seat
  });

  it("blocks double submissions until the server answers", async () => {
    const rig = inMatch();
    rig.socket.replies.delete(C2S.action); // leave unanswered
    await enter(rig);
    rig.client.shoot(1);
    rig.client.shoot(1);
    rig.client.shoot(2);
    expect(rig.socket.count(C2S.action)).toBe(1);
    expect(rig.state().pending).toBe(true);
    rig.socket.last(C2S.action)!.ack!({ ok: true, version: 6 });
    await Promise.resolve();
    expect(rig.state().pending).toBe(false);
  });

  it.each([
    ["NOT_YOUR_TURN", "It's not your turn.", "It's not your turn."],
    ["ITEM_UNUSABLE", "The hand saw is already active.", "The hand saw is already active."],
    ["BUSY", "x", "Wait for the table to settle."],
    ["STALE_VERSION", "x", "The table just changed. Try again."],
    ["RATE_LIMITED", "x", "Slow down a little."],
  ])("shows a rejected action (%s) as a message and unlocks the buttons", async (code, serverText, shown) => {
    const rig = inMatch();
    rig.socket.replies.set(C2S.action, () => ({ ok: false, code, message: serverText, version: 5 }));
    await enter(rig);
    rig.client.shoot(1);
    await vi.advanceTimersByTimeAsync(5);
    expect(rig.state().pending).toBe(false);
    expect(rig.state().lastActionError).toBe(code);
    expect(rig.state().display?.message).toMatchObject({ text: shown, bad: true });
    expect(rig.client.canAct()).toBe(true);
  });

  it("re-syncs by reconnecting if the server is ahead and nothing arrives", async () => {
    const rig = inMatch();
    rig.socket.replies.set(C2S.resume, () => ({ ok: true, code: "ABCDE", seat: 0, token: TOKEN }));
    rig.socket.replies.set(C2S.action, () => ({ ok: false, code: "STALE_VERSION", message: "x", version: 12 }));
    await enter(rig);
    rig.client.shoot(1);
    await vi.advanceTimersByTimeAsync(1600);
    expect(rig.socket.count(C2S.resume)).toBe(1); // dropped and re-joined
  });

  it("does not send actions after the match ended or while eliminated", async () => {
    const rig = inMatch();
    await enter(rig);
    rig.socket.push(S2C.snapshot, snapshot({ version: 8, view: view({ phase: "GAME_OVER", winner: 1 }) }));
    expect(rig.client.canAct()).toBe(false);
    rig.socket.push(S2C.snapshot, snapshot({ version: 9, view: view({ players: [player(0, { hp: 0, alive: false }), player(1), player(2)] }) }));
    expect(rig.client.canAct()).toBe(false);
  });

  it("PLAY AGAIN is admin-only on the client too", async () => {
    const rig = inMatch();
    await enter(rig, 1);
    rig.socket.push(S2C.roomState, room({ you: 1, adminSeat: 0 }));
    await rig.client.playAgain();
    expect(rig.socket.count(C2S.playAgain)).toBe(0);
    rig.socket.push(S2C.roomState, room({ you: 0, adminSeat: 0 }));
    rig.socket.replies.set(C2S.playAgain, () => ({ ok: true }));
    await rig.client.playAgain();
    expect(rig.socket.count(C2S.playAgain)).toBe(1);
  });
});

describe("private information", () => {
  it("only ever holds the private view the server sent for this player", async () => {
    const rig = inMatch();
    await enter(rig);
    const mine = priv({ knownShells: [{ position: 0, shellNumber: 1, observedLive: true, stale: false }] });
    rig.socket.push(S2C.events, batch(6, 0, [ev({ type: "turnBegan", seat: 0, announce: false }, view(), mine)]));
    expect(rig.state().display?.private.knownShells).toHaveLength(1);
    const json = JSON.stringify(rig.state());
    expect(json).not.toContain('"shells"');
    expect(json).not.toContain('"observations"');
  });
});
