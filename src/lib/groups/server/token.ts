// Invite tokens and their defaults.

import { randomBytes } from "node:crypto";

/** Random bytes behind a token. 32 bytes is 43 base64url characters (DB CHECK: >= 43). */
export const INVITE_TOKEN_BYTES = 32;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The group cap is 5 members including the owner, so 4 joins. */
export const INVITE_DEFAULT_MAX_USES = 4;

const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

export function mintInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

/** Cheap shape check before touching the database. */
export function isPlausibleInviteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}
