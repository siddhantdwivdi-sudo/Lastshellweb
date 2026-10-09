import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@lastshell/shared";

/** Cryptographically random room code from an alphabet without look-alike characters. */
export function generateRoomCode(): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return out;
}

/** 128-bit secret that proves "I am this seat". Shown to its owner once, never broadcast. */
export function generateToken(): string {
  return randomBytes(16).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function tokenMatches(token: string, expectedHash: Buffer): boolean {
  const given = hashToken(token);
  return given.length === expectedHash.length && timingSafeEqual(given, expectedHash);
}
