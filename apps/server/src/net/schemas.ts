// Every message from a browser is untrusted. Nothing reaches the rooms layer unless it passes
// these schemas. All objects are strict, so extra fields (for example a fake "seat") are rejected.
// The player's seat is NEVER read from a message; it comes from the authenticated socket session.

import { PLAYER_COUNT, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@lastshell/shared";
import { z } from "zod";

export const roomCodeSchema = z
  .string()
  .trim()
  .length(ROOM_CODE_LENGTH)
  .transform((s) => s.toUpperCase())
  .refine((s) => [...s].every((c) => ROOM_CODE_ALPHABET.includes(c)), "invalid room code");

const seatIndex = z.number().int().min(0).max(PLAYER_COUNT - 1);
const slotIndex = z.number().int().min(0).max(7);

export const joinSchema = z.object({ code: roomCodeSchema }).strict();

export const resumeSchema = z
  .object({
    code: roomCodeSchema,
    token: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export const actionBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shoot"), target: seatIndex }).strict(),
  z
    .object({
      type: z.literal("useItem"),
      slot: slotIndex,
      args: z
        .object({
          target: seatIndex.optional(),
          stealSlot: slotIndex.optional(),
          subTarget: seatIndex.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

export const actionSchema = z
  .object({
    actionId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
    version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    action: actionBodySchema,
  })
  .strict();

/** Events that carry no data: anything other than "nothing" is a malformed request. */
export const emptySchema = z.undefined().or(z.null()).or(z.object({}).strict());
