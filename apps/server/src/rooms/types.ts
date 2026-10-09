import type { Ack, ErrorCode } from "@lastshell/shared";

/** One live connection. The Socket.IO layer and the tests both implement this. */
export interface Peer {
  readonly id: string;
  readonly ip: string;
  send(event: string, payload: unknown): void;
  /** Ask the transport to close this connection. */
  disconnect(): void;
}

export type Result<T extends object = object> = Ack<T>;

export function fail(code: ErrorCode, message: string, version?: number): Extract<Result, { ok: false }> {
  return version === undefined ? { ok: false, code, message } : { ok: false, code, message, version };
}

export function ok<T extends object>(value: T): { ok: true } & T {
  return { ok: true, ...value };
}
