// POST /api/account/delete   body: { confirm: "DELETE" }
//
// Irreversibly deletes the SIGNED-IN user's account and everything it owns
// (SPEC §9 M4: "delete-account cleanup (rows + files)"). The user is always
// derived from the session (`getUser()`) — there is no "delete user X"
// parameter, so a caller can only ever delete themselves.
//
// Deletion order (deterministic + testable):
//   1. Storage: list every object under the `epubs/${user.id}/` prefix
//      (paginated) and remove them. The DB cascade from `auth.users` does NOT
//      touch Storage, so this must happen explicitly and must succeed before
//      we go further — a Storage failure aborts with 500 and the auth user is
//      left intact (the account is NOT half-deleted silently).
//   2. DB rows: delete the rows the user owns, children first —
//      highlights -> reading_state -> books -> reader_settings -> profiles.
//      (`auth.users` also cascades these, but doing it explicitly makes the
//      outcome deterministic and unit-testable.)
//   3. Auth: `admin.auth.admin.deleteUser(user.id)`.
//   4. Sign the caller out (clear the session cookies) and return { ok: true }.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const STORAGE_BUCKET = "epubs";
const STORAGE_PAGE_SIZE = 100;

// Children first — a row that others reference is deleted last.
const OWNED_TABLES = [
  "highlights",
  "reading_state",
  "books",
  "reader_settings",
] as const;

function serverError(message = "Could not delete your account. Please try again.") {
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return serverError();
  }

  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in first." },
      { status: 401 },
    );
  }

  let confirm: unknown;
  try {
    ({ confirm } = (await request.json()) as { confirm?: unknown });
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }
  if (confirm !== "DELETE") {
    return NextResponse.json(
      { error: 'Confirmation required: send { "confirm": "DELETE" }.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // --- 1. Storage cleanup (must fully succeed before anything else) --------
  try {
    const prefix = user.id;
    const toRemove: string[] = [];
    for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
      const { data: page, error } = await admin.storage
        .from(STORAGE_BUCKET)
        .list(prefix, { limit: STORAGE_PAGE_SIZE, offset });
      if (error) throw error;
      if (!page || page.length === 0) break;
      for (const entry of page) {
        // `id === null` marks a nested folder rather than a file; the upload
        // convention is flat (`${uid}/<uuid>.epub`), so this is defensive only.
        if (entry.id !== null) toRemove.push(`${prefix}/${entry.name}`);
      }
      if (page.length < STORAGE_PAGE_SIZE) break;
    }

    if (toRemove.length > 0) {
      const { error } = await admin.storage
        .from(STORAGE_BUCKET)
        .remove(toRemove);
      if (error) throw error;
    }
  } catch (err) {
    console.error("account delete: storage cleanup failed", {
      userId: user.id,
      err,
    });
    return serverError(
      "Could not remove your uploaded files. Your account was not deleted — please try again.",
    );
  }

  // --- 2. Owned DB rows (children first) ---------------------------------
  try {
    for (const table of OWNED_TABLES) {
      const { error } = await admin.from(table).delete().eq("user_id", user.id);
      if (error) throw error;
    }
    // profiles is keyed by the auth uid itself (no user_id column).
    const { error: profileError } = await admin
      .from("profiles")
      .delete()
      .eq("id", user.id);
    if (profileError) throw profileError;
  } catch (err) {
    console.error("account delete: row cleanup failed", {
      userId: user.id,
      err,
    });
    return serverError();
  }

  // --- 3. Auth user ----------------------------------------------------
  try {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  } catch (err) {
    console.error("account delete: auth user deletion failed", {
      userId: user.id,
      err,
    });
    return serverError();
  }

  // --- 4. Clear the caller's session cookies --------------------------
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Best-effort: the auth user is already gone, the JWT is now worthless.
    // The client redirects to /login regardless.
  }

  return NextResponse.json({ ok: true });
}
