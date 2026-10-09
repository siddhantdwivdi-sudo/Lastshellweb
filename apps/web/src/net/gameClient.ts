// Socket.IO client adapter. It owns the connection, the session (so a refresh or a dropped link
// can resume the same seat), the room/lobby state, and the ordered playback of game events.
//
// It has no game rules. Everything it knows about the match comes from the server's projected
// public view + this player's own private view. It never logs payloads.
//
// DOM-free on purpose (storage and the socket are injected) so it can be tested in Node against a
// real server.

import {
  C2S,
  EVENT_DURATION_MS,
  S2C,
  type ActionBody,
  type Ack,
  type ClientEvent,
  type ErrorCode,
  type GameEventsPayload,
  type GameIdlePayload,
  type GameSnapshot,
  type JoinedInfo,
  type RoomState,
} from "@lastshell/shared";
import { seatName } from "../lib/layout";
import type { ConnectionState } from "../ui/model";
import { applyEvent, displayFrom, newId, withMessage, type DisplayState } from "./presenter";

// ------------------------------------------------------------------ injected pieces

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** The small part of a Socket.IO socket we use (lets tests substitute a fake). */
export interface SocketLike {
  readonly connected: boolean;
  on(event: string, handler: (...args: any[]) => void): unknown;
  emit(event: string, ...args: any[]): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

export interface ClientOptions {
  socket: SocketLike;
  storage: KeyValueStore;
  /** How long to wait for the server to answer a request (ms). */
  ackTimeoutMs?: number;
  /** Delay before retrying a resume that failed for a temporary reason (ms). */
  resumeRetryMs?: number;
}

// ------------------------------------------------------------------ public state

export interface Session {
  code: string;
  seat: number;
  token: string;
}

export interface Notice {
  kind: "error" | "info";
  text: string;
}

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
}

export interface ClientState {
  connection: ConnectionState;
  socketConnected: boolean;
  resuming: boolean;
  session: Session | null;
  room: RoomState | null;
  display: DisplayState | null;
  creating: boolean;
  joining: boolean;
  starting: boolean;
  /** One of my own requests is waiting for the server's answer. */
  pending: boolean;
  /** The table is still playing out (or the server hasn't said "idle" yet). */
  busy: boolean;
  /** Why the server refused my last action (null if it was accepted or none was sent). */
  lastActionError: ErrorCode | null;
  notice: Notice | null;
  toast: Toast | null;
}

const SESSION_KEY = "lastshell.session";

const FRIENDLY: Partial<Record<ErrorCode, string>> = {
  ROOM_NOT_FOUND: "No room with that code.",
  ROOM_FULL: "That room is full.",
  ROOM_STARTED: "That match has already started.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
  SERVER_FULL: "The server is full. Try again later.",
};

function describeError(res: { code: ErrorCode; message: string }): string {
  return FRIENDLY[res.code] ?? res.message;
}

function newActionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

interface Step {
  ev: ClientEvent;
  ms: number;
}

export class GameClient {
  private state: ClientState;
  private readonly listeners = new Set<() => void>();
  private readonly socket: SocketLike;
  private readonly storage: KeyValueStore;
  private readonly ackTimeoutMs: number;
  private readonly resumeRetryMs: number;

  // playback of server events
  private queue: Step[] = [];
  private playing = false;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  /** Highest room version received. Anything older is ignored. */
  private serverVersion = 0;
  private serverIdle = true;

  private timers = new Set<ReturnType<typeof setTimeout>>();
  private ignoreRoomEvents = false;
  private disposed = false;

  constructor(options: ClientOptions) {
    this.socket = options.socket;
    this.storage = options.storage;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 6000;
    this.resumeRetryMs = options.resumeRetryMs ?? 3000;
    this.state = {
      connection: "connecting",
      socketConnected: false,
      resuming: false,
      session: this.loadSession(),
      room: null,
      display: null,
      creating: false,
      joining: false,
      starting: false,
      pending: false,
      busy: false,
      lastActionError: null,
      notice: null,
      toast: null,
    };
    this.wire();
  }

  // ------------------------------------------------------------------ store API (for React)

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): ClientState => this.state;

  private commit(patch: Partial<ClientState>): void {
    if (this.disposed) return;
    const next = { ...this.state, ...patch };
    next.busy = !this.serverIdle || this.playing || this.queue.length > 0;
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  connect(): void {
    this.socket.connect();
  }

  dispose(): void {
    this.disposed = true;
    this.clearPlayback();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.listeners.clear();
    this.socket.disconnect();
  }

  // ------------------------------------------------------------------ session storage

  private loadSession(): Session | null {
    try {
      const raw = this.storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<Session>;
      if (typeof s.code === "string" && typeof s.token === "string" && typeof s.seat === "number") {
        return { code: s.code, seat: s.seat, token: s.token };
      }
    } catch {
      /* corrupt or unavailable storage: start fresh */
    }
    return null;
  }

  private saveSession(s: Session | null): void {
    try {
      if (s) this.storage.setItem(SESSION_KEY, JSON.stringify(s));
      else this.storage.removeItem(SESSION_KEY);
    } catch {
      /* private mode etc.: the session just won't survive a refresh */
    }
  }

  // ------------------------------------------------------------------ requests

  /** Sends a request and resolves with the server's answer, or a local error after a timeout. */
  private request<T extends object = object>(event: string, payload?: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => {
      if (!this.socket.connected) {
        resolve({ ok: false, code: "INTERNAL", message: "You're offline. Reconnecting…" });
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.timers.delete(timer);
        resolve({ ok: false, code: "INTERNAL", message: "The server didn't answer. Check your connection." });
      }, this.ackTimeoutMs);
      this.timers.add(timer);
      const cb = (res: Ack<T>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.timers.delete(timer);
        resolve(res);
      };
      if (payload === undefined) this.socket.emit(event, cb);
      else this.socket.emit(event, payload, cb);
    });
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(t);
  }

  // ------------------------------------------------------------------ socket wiring

  private wire(): void {
    const s = this.socket;
    s.on("connect", () => {
      this.commit({ socketConnected: true, connection: "ready" });
      if (this.state.session) void this.resume();
    });
    s.on("disconnect", () => {
      this.commit({
        socketConnected: false,
        connection: "connecting",
        resuming: false,
        pending: false,
        creating: false,
        joining: false,
        starting: false,
      });
    });
    s.on("connect_error", () => {
      if (!this.state.socketConnected) this.commit({ connection: "error" });
    });
    s.on(S2C.roomState, (room: RoomState) => this.onRoomState(room));
    s.on(S2C.snapshot, (snap: GameSnapshot) => this.onSnapshot(snap));
    s.on(S2C.events, (payload: GameEventsPayload) => this.onEvents(payload));
    s.on(S2C.idle, (payload: GameIdlePayload) => this.onIdle(payload));
    s.on(S2C.replaced, () => {
      this.leaveLocal({ kind: "info", text: "This seat was taken over by another window." });
    });
  }

  private async resume(): Promise<void> {
    const session = this.state.session;
    if (!session || this.state.resuming) return;
    this.commit({ resuming: true });
    const res = await this.request<JoinedInfo>(C2S.resume, { code: session.code, token: session.token });
    if (this.disposed || this.state.session?.token !== session.token) return;
    if (res.ok) {
      this.commit({ resuming: false });
      return;
    }
    if (res.code === "INVALID_TOKEN" || res.code === "ROOM_NOT_FOUND") {
      this.leaveLocal({
        kind: "error",
        text:
          res.code === "ROOM_NOT_FOUND"
            ? "That room no longer exists (the server may have restarted)."
            : "Your seat expired. Create or join a room to play again.",
      });
      return;
    }
    this.commit({ resuming: false });
    if (this.socket.connected) this.later(this.resumeRetryMs, () => void this.resume());
  }

  /** Forget the room entirely and go back to the title screen. */
  private leaveLocal(notice: Notice | null): void {
    this.clearPlayback();
    this.serverVersion = 0;
    this.serverIdle = true;
    this.saveSession(null);
    this.commit({
      session: null,
      room: null,
      display: null,
      resuming: false,
      pending: false,
      creating: false,
      joining: false,
      starting: false,
      notice,
    });
  }

  // ------------------------------------------------------------------ incoming: room + game

  private onRoomState(room: RoomState): void {
    if (this.ignoreRoomEvents) return;
    const prev = this.state.room;
    const toastBefore = this.state.toast;
    let toast: Toast | null = toastBefore;

    if (prev && prev.code === room.code) {
      if (prev.adminSeat !== room.adminSeat && room.adminSeat !== null) {
        toast = {
          id: newId(),
          kind: "info",
          text: room.adminSeat === room.you ? "You are now the room admin." : `${seatName(room.adminSeat)} is now the room admin.`,
        };
      }
      for (const seat of room.seats) {
        const before = prev.seats[seat?.seat ?? -1];
        if (!seat || !before || seat.seat === room.you) continue;
        if (before.connected && !seat.connected && !seat.forfeited) {
          toast = { id: newId(), kind: "error", text: `${seatName(seat.seat)} disconnected. They have 60 seconds to return.` };
        } else if (!before.connected && seat.connected) {
          toast = { id: newId(), kind: "info", text: `${seatName(seat.seat)} is back.` };
        } else if (!before.forfeited && seat.forfeited) {
          toast = { id: newId(), kind: "error", text: `${seatName(seat.seat)} left the match.` };
        }
      }
    }

    const patch: Partial<ClientState> = { room, toast };
    if (this.state.session && this.state.session.seat !== room.you) {
      const session = { ...this.state.session, seat: room.you };
      this.saveSession(session);
      patch.session = session;
    }
    if (room.status === "LOBBY") {
      // Back in the lobby (PLAY AGAIN with someone missing): drop the finished match.
      this.clearPlayback();
      this.serverVersion = 0;
      this.serverIdle = true;
      patch.display = null;
      patch.pending = false;
    } else {
      patch.starting = false;
    }
    this.commit(patch);
    if (toast && toast !== toastBefore) {
      const id = toast.id;
      this.later(5000, () => this.dismissToast(id));
    }
  }

  private showToast(kind: Toast["kind"], text: string): void {
    const toast: Toast = { id: newId(), kind, text };
    this.commit({ toast });
    this.later(5000, () => this.dismissToast(toast.id));
  }

  private onSnapshot(snap: GameSnapshot): void {
    this.clearPlayback();
    this.serverVersion = snap.version;
    this.serverIdle = !snap.busy;
    this.commit({ display: displayFrom(snap.view, snap.private), pending: false });
  }

  private onEvents(payload: GameEventsPayload): void {
    // Never let an old or repeated batch overwrite newer state.
    if (payload.version <= this.serverVersion) return;
    this.serverVersion = payload.version;
    this.serverIdle = false;
    let total = 0;
    for (const ev of payload.events) total += EVENT_DURATION_MS[ev.type];
    // Play at the pace the server is using (scale 1 in production, 0 in fast tests).
    const scale = total > 0 ? payload.busyMs / total : 0;
    for (const ev of payload.events) this.queue.push({ ev, ms: EVENT_DURATION_MS[ev.type] * scale });
    this.pump();
  }

  private onIdle(payload: GameIdlePayload): void {
    if (payload.version < this.serverVersion) return;
    this.serverIdle = true;
    this.commit({});
  }

  /** Plays queued events one after another, each held for its animation time. */
  private pump(): void {
    if (this.playing) return;
    this.playing = true;
    const step = (): void => {
      while (this.queue.length > 0 && !this.disposed) {
        const { ev, ms } = this.queue.shift() as Step;
        this.commit({ display: applyEvent(this.state.display, ev) });
        if (ms > 0) {
          this.playTimer = setTimeout(() => {
            this.playTimer = null;
            step();
          }, ms);
          return;
        }
      }
      this.playing = false;
      this.commit({});
    };
    step();
  }

  private clearPlayback(): void {
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
    this.queue = [];
    this.playing = false;
  }

  // ------------------------------------------------------------------ outgoing: title + lobby

  async createRoom(): Promise<void> {
    const s = this.state;
    if (s.connection !== "ready" || s.creating || s.joining || s.session) return;
    this.ignoreRoomEvents = false;
    this.commit({ creating: true, notice: null });
    const res = await this.request<JoinedInfo>(C2S.create);
    if (res.ok) {
      this.adoptSession({ code: res.code, seat: res.seat, token: res.token });
      this.commit({ creating: false });
    } else {
      this.commit({ creating: false, notice: { kind: "error", text: describeError(res) } });
    }
  }

  /** Resolves with an error message to show, or null on success. */
  async joinRoom(code: string): Promise<string | null> {
    const s = this.state;
    if (s.connection !== "ready" || s.joining || s.creating || s.session) return "You are already in a room.";
    this.ignoreRoomEvents = false;
    this.commit({ joining: true, notice: null });
    const res = await this.request<JoinedInfo>(C2S.join, { code });
    if (res.ok) {
      this.adoptSession({ code: res.code, seat: res.seat, token: res.token });
      this.commit({ joining: false });
      return null;
    }
    this.commit({ joining: false });
    return describeError(res);
  }

  private adoptSession(session: Session): void {
    this.saveSession(session);
    this.commit({ session, notice: null });
  }

  async startMatch(): Promise<void> {
    const { room, starting } = this.state;
    if (!room || starting || room.status !== "LOBBY" || room.adminSeat !== room.you) return;
    this.commit({ starting: true });
    const res = await this.request(C2S.start);
    if (!res.ok) {
      this.commit({ starting: false });
      this.showToast("error", describeError(res));
    }
  }

  async leaveRoom(): Promise<void> {
    if (!this.state.session) return;
    this.ignoreRoomEvents = true;
    if (this.socket.connected) await this.request(C2S.leave);
    this.leaveLocal(null);
  }

  async playAgain(): Promise<void> {
    const { room, pending } = this.state;
    if (!room || pending || room.status === "LOBBY" || room.adminSeat !== room.you) return;
    this.commit({ pending: true });
    const res = await this.request(C2S.playAgain);
    this.commit({ pending: false });
    if (!res.ok) this.showToast("error", describeError(res));
  }

  retryConnection(): void {
    this.commit({ connection: "connecting" });
    this.socket.connect();
  }

  dismissNotice = (): void => this.commit({ notice: null });

  dismissToast = (id?: number): void => {
    if (id !== undefined && this.state.toast?.id !== id) return;
    this.commit({ toast: null });
  };

  // ------------------------------------------------------------------ outgoing: actions

  /** True only when pressing a game button could legitimately do something right now. */
  canAct(): boolean {
    const s = this.state;
    const d = s.display;
    if (!d || !s.session || !s.room || !s.socketConnected || s.resuming || s.pending || s.busy) return false;
    if (s.room.status !== "IN_MATCH" || d.view.phase !== "AWAITING") return false;
    const me = d.view.players[s.room.you];
    return !!me?.alive && d.view.current === s.room.you;
  }

  shoot = (target: number): void => void this.submit({ type: "shoot", target });

  useItem = (slot: number, args?: Extract<ActionBody, { type: "useItem" }>["args"]): void =>
    void this.submit(args ? { type: "useItem", slot, args } : { type: "useItem", slot });

  private async submit(action: ActionBody): Promise<void> {
    if (!this.canAct()) return;
    const actionId = newActionId();
    this.commit({ pending: true, lastActionError: null });
    const res = await this.request(C2S.action, { actionId, version: this.serverVersion, action });
    this.commit({ pending: false });
    if (res.ok) return;
    this.commit({ lastActionError: res.code });

    const d = this.state.display;
    let text: string;
    switch (res.code) {
      case "STALE_VERSION":
        text = "The table just changed. Try again.";
        // If the server is ahead of us and nothing arrives, re-sync by reconnecting.
        if (res.version !== undefined && res.version > this.serverVersion) {
          const behind = res.version;
          this.later(1500, () => {
            if (this.serverVersion < behind) this.resync();
          });
        }
        break;
      case "BUSY":
        text = "Wait for the table to settle.";
        break;
      case "RATE_LIMITED":
        text = "Slow down a little.";
        break;
      default:
        text = describeError(res);
    }
    if (d) this.commit({ display: withMessage(d, text) });
  }

  /** Drop and re-establish the connection: the server then sends a fresh snapshot. */
  resync(): void {
    if (!this.state.session) return;
    this.socket.disconnect();
    this.socket.connect();
  }
}
