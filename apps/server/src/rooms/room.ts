// One room = one lobby and (later) one match. All methods are synchronous, and Node runs one
// callback at a time, so a room can never be mutated by two requests simultaneously. The
// `busy` flag then enforces the pacing: no new action is accepted until the previous action's
// animation time has elapsed.

import {
  EVENT_DURATION_MS,
  PLAYER_COUNT,
  S2C,
  type ActionRequest,
  type GameEventsPayload,
  type GameIdlePayload,
  type GameSnapshot,
  type JoinedInfo,
  type RoomState,
  type RoomStatus,
} from "@lastshell/shared";
import type { RoomConfig } from "../config";
import {
  applyAction,
  createMatch,
  forfeitPlayer,
  type Action,
  type EngineEvent,
  type GameState,
  type Rng,
} from "../engine";
import { projectEvent, projectPrivate, projectPublic } from "../views";
import { generateToken, hashToken, tokenMatches } from "./ids";
import { fail, ok, type Peer, type Result } from "./types";

type Timer = ReturnType<typeof setTimeout>;

interface SeatSlot {
  seat: number;
  tokenHash: Buffer;
  peer: Peer | null;
  graceTimer: Timer | null;
  graceEndsAt: number | null;
  /** Left voluntarily or ran out of grace time: no longer part of the match. */
  forfeited: boolean;
  /** Left voluntarily: the token can no longer be used to come back. */
  revoked: boolean;
}

export interface RoomHooks {
  /** The room removed itself (empty). */
  onDestroy(room: Room): void;
  /** A peer was kicked from its seat by a newer connection with the same token. */
  onUnbind(peerId: string): void;
}

const RECENT_ACTION_LIMIT = 256;

type ActionAck = Result<{ version: number; duplicate?: boolean }>;

export class Room {
  status: RoomStatus = "LOBBY";
  adminSeat: number | null = null;
  slots: (SeatSlot | null)[] = Array.from({ length: PLAYER_COUNT }, () => null);
  /** Server-only match state. Never serialise this object. */
  game: GameState | null = null;
  version = 0;
  busy = false;
  destroyed = false;

  private busyTimer: Timer | null = null;
  private emptyTimer: Timer | null = null;
  private pendingForfeits: number[] = [];
  private recentActions = new Map<string, ActionAck>();
  private processing = false;

  constructor(
    readonly code: string,
    private readonly rng: Rng,
    private readonly config: RoomConfig,
    private readonly hooks: RoomHooks,
  ) {}

  // ============================================================ membership

  addPlayer(peer: Peer): Result<JoinedInfo> {
    if (this.status !== "LOBBY") return fail("ROOM_STARTED", "That match has already started.");
    const seat = this.slots.findIndex((s) => s === null);
    if (seat === -1) return fail("ROOM_FULL", "That room is full.");
    const token = generateToken();
    this.slots[seat] = {
      seat,
      tokenHash: hashToken(token),
      peer,
      graceTimer: null,
      graceEndsAt: null,
      forfeited: false,
      revoked: false,
    };
    if (this.adminSeat === null) this.adminSeat = seat;
    this.clearEmptyTimer();
    this.broadcastRoomState();
    return ok({ code: this.code, seat, token });
  }

  /** Re-attach a new connection to the seat that owns `token`. */
  resume(peer: Peer, token: string): Result<JoinedInfo> {
    const slot = this.slots.find((s) => s !== null && !s.revoked && tokenMatches(token, s.tokenHash)) ?? null;
    if (!slot) return fail("INVALID_TOKEN", "That session is no longer valid.");

    if (slot.peer && slot.peer.id !== peer.id) {
      const old = slot.peer;
      slot.peer = null;
      this.hooks.onUnbind(old.id);
      old.send(S2C.replaced, {});
      old.disconnect();
    }
    this.clearGrace(slot);
    slot.peer = peer;
    this.clearEmptyTimer();
    this.sendSnapshot(slot);
    this.broadcastRoomState();
    return ok({ code: this.code, seat: slot.seat, token });
  }

  /** Voluntary leave or a lost connection. */
  removePeer(peer: Peer, reason: "leave" | "disconnect"): void {
    const slot = this.slotFor(peer);
    if (!slot) return;

    if (this.status === "LOBBY") {
      this.clearGrace(slot);
      this.slots[slot.seat] = null;
    } else if (reason === "leave") {
      this.clearGrace(slot);
      slot.peer = null;
      slot.revoked = true;
      slot.forfeited = true;
      this.queueForfeit(slot.seat);
    } else {
      slot.peer = null;
      const alive = this.game?.players[slot.seat].alive ?? false;
      if (this.status === "IN_MATCH" && alive && !slot.forfeited) this.startGrace(slot);
    }
    this.afterMembershipChange();
  }

  private afterMembershipChange(): void {
    this.ensureAdmin();
    const anyConnected = this.slots.some((s) => s !== null && s.peer !== null);
    if (!anyConnected) {
      if (this.status === "LOBBY") {
        this.destroy();
        return;
      }
      this.startEmptyTimer();
    }
    this.broadcastRoomState();
  }

  private startGrace(slot: SeatSlot): void {
    this.clearGrace(slot);
    slot.graceEndsAt = Date.now() + this.config.graceMs;
    slot.graceTimer = setTimeout(() => this.onGraceExpired(slot.seat), this.config.graceMs);
    slot.graceTimer.unref?.();
  }

  private clearGrace(slot: SeatSlot): void {
    if (slot.graceTimer) clearTimeout(slot.graceTimer);
    slot.graceTimer = null;
    slot.graceEndsAt = null;
  }

  private onGraceExpired(seat: number): void {
    const slot = this.slots[seat];
    if (!slot || slot.peer || this.destroyed) return;
    slot.graceTimer = null;
    slot.graceEndsAt = null;
    slot.forfeited = true;
    this.queueForfeit(seat);
    this.ensureAdmin();
    this.broadcastRoomState();
  }

  /** Admin role passes to the lowest connected seat when the admin is gone. */
  private ensureAdmin(): void {
    const current = this.adminSeat !== null ? this.slots[this.adminSeat] : null;
    const stillAdmin =
      current !== null &&
      !current.revoked &&
      !current.forfeited &&
      (current.peer !== null || this.status === "IN_MATCH");
    if (stillAdmin) return;
    const next = this.slots.find((s) => s !== null && s.peer !== null && !s.revoked);
    if (next) this.adminSeat = next.seat;
    else if (!current || current.revoked) this.adminSeat = null;
  }

  private startEmptyTimer(): void {
    this.clearEmptyTimer();
    this.emptyTimer = setTimeout(() => this.destroy(), this.config.emptyRoomTtlMs);
    this.emptyTimer.unref?.();
  }

  private clearEmptyTimer(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearEmptyTimer();
    if (this.busyTimer) clearTimeout(this.busyTimer);
    this.busyTimer = null;
    for (const s of this.slots) if (s) this.clearGrace(s);
    this.hooks.onDestroy(this);
  }

  // ============================================================ match flow

  start(peer: Peer): Result {
    const slot = this.slotFor(peer);
    if (!slot) return fail("NOT_IN_ROOM", "You are not in this room.");
    if (slot.seat !== this.adminSeat) return fail("NOT_ADMIN", "Only the room admin can do that.");
    if (this.status !== "LOBBY") return fail("WRONG_STATE", "The match has already started.");
    if (!this.allSeatsConnected()) return fail("ROOM_NOT_FULL", "All three players must be connected.");
    this.beginMatch();
    return ok({});
  }

  playAgain(peer: Peer): Result {
    const slot = this.slotFor(peer);
    if (!slot) return fail("NOT_IN_ROOM", "You are not in this room.");
    if (slot.seat !== this.adminSeat) return fail("NOT_ADMIN", "Only the room admin can do that.");
    if (this.status !== "GAME_OVER") return fail("WRONG_STATE", "The match is not over yet.");
    if (this.busy) return fail("BUSY", "Wait for the match to finish playing out.");
    if (this.allSeatsConnected()) this.beginMatch();
    else this.returnToLobby();
    return ok({});
  }

  private allSeatsConnected(): boolean {
    return this.slots.every((s) => s !== null && s.peer !== null && !s.revoked);
  }

  private beginMatch(): void {
    const { state, events } = createMatch(this.rng);
    this.game = state;
    this.status = "IN_MATCH";
    this.pendingForfeits = [];
    this.recentActions.clear();
    for (const s of this.slots) {
      if (s) {
        s.forfeited = false;
        this.clearGrace(s);
      }
    }
    this.broadcastRoomState();
    this.applyEvents(events);
  }

  private returnToLobby(): void {
    for (const s of this.slots) {
      if (s && (s.peer === null || s.revoked)) {
        this.clearGrace(s);
        this.slots[s.seat] = null;
      }
    }
    this.game = null;
    this.status = "LOBBY";
    this.pendingForfeits = [];
    this.recentActions.clear();
    this.ensureAdmin();
    this.broadcastRoomState();
  }

  handleAction(peer: Peer, req: ActionRequest): ActionAck {
    const slot = this.slotFor(peer);
    if (!slot) return fail("NOT_IN_ROOM", "You are not in this room.");

    // Replays and retries first: an applied action is never applied twice.
    const key = `${slot.seat}:${req.actionId}`;
    const cached = this.recentActions.get(key);
    if (cached) return cached.ok ? { ...cached, duplicate: true } : cached;

    if (this.status !== "IN_MATCH" || !this.game) return fail("WRONG_STATE", "There is no match in progress.");
    if (req.version !== this.version) {
      return fail("STALE_VERSION", "The game moved on. Wait for the latest update.", this.version);
    }
    if (this.busy || this.processing) return fail("BUSY", "Wait for the current action to finish.", this.version);

    this.processing = true;
    try {
      const result = applyAction(this.game, slot.seat, req.action as Action, this.rng);
      let ack: ActionAck;
      if (!result.ok) {
        ack = fail(result.code, result.message, this.version);
      } else {
        this.applyEvents(result.events);
        ack = ok({ version: this.version });
      }
      this.remember(key, ack);
      return ack;
    } finally {
      this.processing = false;
    }
  }

  private remember(key: string, ack: ActionAck): void {
    this.recentActions.set(key, ack);
    if (this.recentActions.size > RECENT_ACTION_LIMIT) {
      const oldest = this.recentActions.keys().next().value;
      if (oldest !== undefined) this.recentActions.delete(oldest);
    }
  }

  private queueForfeit(seat: number): void {
    if (this.status !== "IN_MATCH") return;
    this.pendingForfeits.push(seat);
    this.processPending();
  }

  /** Forfeits wait until the table is idle, so they never cut into a running sequence. */
  private processPending(): void {
    while (!this.busy && this.pendingForfeits.length > 0 && this.game && this.status === "IN_MATCH") {
      const seat = this.pendingForfeits.shift() as number;
      const events = forfeitPlayer(this.game, seat, this.rng);
      if (events.length > 0) this.applyEvents(events);
    }
  }

  /** Records one resolved step, sends each seat ITS OWN projection, and starts the busy timer. */
  private applyEvents(events: EngineEvent[]): void {
    this.version += 1;
    let total = 0;
    for (const ev of events) total += EVENT_DURATION_MS[ev.type];
    const busyMs = Math.round(total * this.config.busyScale);
    if (events.some((e) => e.type === "gameOver")) {
      this.status = "GAME_OVER";
      this.pendingForfeits = [];
      this.ensureAdmin();
    }
    for (const slot of this.slots) {
      if (!slot?.peer) continue;
      const payload: GameEventsPayload = {
        version: this.version,
        busyMs,
        events: events.map((e) => projectEvent(e, slot.seat)),
      };
      slot.peer.send(S2C.events, payload);
    }
    this.busy = true;
    if (busyMs > 0) {
      this.busyTimer = setTimeout(() => this.onIdle(), busyMs);
      this.busyTimer.unref?.();
    } else {
      this.onIdle();
    }
  }

  private onIdle(): void {
    if (this.destroyed) return;
    this.busy = false;
    this.busyTimer = null;
    const payload: GameIdlePayload = { version: this.version };
    for (const slot of this.slots) slot?.peer?.send(S2C.idle, payload);
    this.broadcastRoomState();
    this.processPending();
  }

  // ============================================================ outgoing

  private slotFor(peer: Peer): SeatSlot | null {
    return this.slots.find((s) => s !== null && s.peer !== null && s.peer.id === peer.id) ?? null;
  }

  roomStateFor(seat: number): RoomState {
    // Don't announce the end of the match before its last animation has finished.
    const status = this.status === "GAME_OVER" && this.busy ? "IN_MATCH" : this.status;
    return {
      code: this.code,
      status,
      adminSeat: this.adminSeat,
      you: seat,
      seats: this.slots.map((s) =>
        s
          ? {
              seat: s.seat,
              connected: s.peer !== null,
              isAdmin: s.seat === this.adminSeat,
              graceEndsAt: s.graceEndsAt,
              forfeited: s.forfeited,
            }
          : null,
      ),
    };
  }

  private broadcastRoomState(): void {
    for (const slot of this.slots) slot?.peer?.send(S2C.roomState, this.roomStateFor(slot.seat));
  }

  snapshotFor(seat: number): GameSnapshot | null {
    if (!this.game || this.status === "LOBBY") return null;
    return {
      version: this.version,
      busy: this.busy,
      you: seat,
      view: projectPublic(this.game),
      private: projectPrivate(this.game, seat),
    };
  }

  private sendSnapshot(slot: SeatSlot): void {
    const snap = this.snapshotFor(slot.seat);
    if (snap && slot.peer) slot.peer.send(S2C.snapshot, snap);
  }

  /** Number of seats whose player is currently connected (for tests / diagnostics). */
  connectedCount(): number {
    return this.slots.filter((s) => s !== null && s.peer !== null).length;
  }
}
