// Invite use accounting. `uses` is incremented with a compare-and-set update
// (`uses = <value just read>` and `uses < max_uses`), so two simultaneous
// accepts of the last remaining use cannot both succeed: the loser's update
// matches no row and it re-reads.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupInvite } from "@/lib/types";

const MAX_ATTEMPTS = 4;

export async function loadInvite(
  admin: SupabaseClient,
  token: string,
): Promise<GroupInvite | null> {
  const { data, error } = await admin
    .from("group_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return (data as GroupInvite | null) ?? null;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "used_up" | "busy" };

/** Take one use of the invite, or say why not. */
export async function claimInviteUse(
  admin: SupabaseClient,
  initial: GroupInvite,
  now: Date = new Date(),
): Promise<ClaimResult> {
  let invite: GroupInvite = initial;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (new Date(invite.expires_at).getTime() <= now.getTime()) {
      return { ok: false, reason: "expired" };
    }
    if (invite.uses >= invite.max_uses) {
      return { ok: false, reason: "used_up" };
    }

    const { data, error } = await admin
      .from("group_invites")
      .update({ uses: invite.uses + 1 })
      .eq("token", invite.token)
      .eq("uses", invite.uses)
      .lt("uses", invite.max_uses)
      .gt("expires_at", now.toISOString())
      .select("token");
    if (error) throw error;
    if (Array.isArray(data) && data.length === 1) return { ok: true };

    // Someone else moved `uses` first. Look again.
    const fresh = await loadInvite(admin, invite.token);
    if (!fresh) return { ok: false, reason: "missing" };
    invite = fresh;
  }
  return { ok: false, reason: "busy" };
}

/** Give a claimed use back after the membership insert failed. Best effort. */
export async function releaseInviteUse(
  admin: SupabaseClient,
  token: string,
): Promise<void> {
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await loadInvite(admin, token);
      if (!current || current.uses <= 0) return;
      const { data, error } = await admin
        .from("group_invites")
        .update({ uses: current.uses - 1 })
        .eq("token", token)
        .eq("uses", current.uses)
        .select("token");
      if (error) return;
      if (Array.isArray(data) && data.length === 1) return;
    }
  } catch {
    // A lost use only makes the link slightly shorter-lived.
  }
}
