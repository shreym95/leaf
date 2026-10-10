// Shared entry checks for the groups Route Handlers: the feature flag, the
// session, and the response helpers. The user always comes from the session,
// never from the request.

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { getUser } from "@/lib/auth";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function serverError(
  message = "Something went wrong. Try again.",
): NextResponse {
  return jsonError(message, 500);
}

export type GroupsAuth =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

/** 404 when groups are off (L1), 401 when signed out, else the session user. */
export async function requireGroupsUser(): Promise<GroupsAuth> {
  if (!GROUPS_ENABLED) {
    return { ok: false, response: jsonError("Not found.", 404) };
  }
  const user = await getUser();
  if (!user) {
    return {
      ok: false,
      response: jsonError("You need to sign in first.", 401),
    };
  }
  return { ok: true, user };
}

/** Parse a JSON object body; null when malformed or not an object. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
