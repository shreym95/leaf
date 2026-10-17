"use client";

// The group reads this book is linked to, for the reader's Group tab. The tab exists
// only when this returns a non-null value (GROUPS_V1_BUILD.md L1, L5).
//
// With the flag off nothing here runs: no client, no query, no listener. With it on,
// the lookup happens once per book open and never blocks rendering. Offline, or on any
// failure, it resolves to null: no tab, and reading is untouched.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { findReadForBook, getGroup } from "@/lib/db/groups";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { resolveUserId } from "@/lib/offline/outbox";
import type { GroupReadContext } from "./group-notes";

export interface GroupReadsState {
  userId: string;
  reads: GroupReadContext[];
}

const FALLBACK_NAME = "Member";

function isOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  } catch {
    return false;
  }
}

async function loadGroupReads(bookId: string): Promise<GroupReadsState | null> {
  const supabase = createClient();
  const me = await resolveUserId(supabase);
  if (!me) return null;
  const linked = await findReadForBook(me, bookId, supabase);
  if (linked.length === 0) return null;

  const groupIds = [...new Set(linked.map(({ read }) => read.group_id))];
  const details = await Promise.all(groupIds.map((id) => getGroup(id, supabase)));
  const byGroup = new Map<string, NonNullable<(typeof details)[number]>>();
  groupIds.forEach((id, i) => {
    const detail = details[i];
    if (detail) byGroup.set(id, detail);
  });

  const reads: GroupReadContext[] = [];
  for (const { read, copy } of linked) {
    const detail = byGroup.get(read.group_id);
    if (!detail) continue;
    // Names come from current members; a member without one reads as "Member".
    const names = new Map<string, string>();
    for (const m of detail.members) {
      names.set(m.user_id, m.display_name?.trim() || FALLBACK_NAME);
    }
    reads.push({
      readId: read.id,
      groupId: read.group_id,
      groupName: detail.group.name,
      outline: read.outline,
      alignment: copy.alignment,
      copySha256: copy.contentSha256,
      names,
    });
  }
  return reads.length > 0 ? { userId: me, reads } : null;
}

export function useGroupReads(bookId: string): GroupReadsState | null {
  const [state, setState] = useState<{ bookId: string; value: GroupReadsState | null } | null>(
    null,
  );

  useEffect(() => {
    // L1: flag off → no client, no query.
    if (!GROUPS_ENABLED) return;
    if (isOffline()) return;

    let cancelled = false;
    void (async () => {
      let next: GroupReadsState | null = null;
      try {
        next = await loadGroupReads(bookId);
      } catch {
        next = null;
      }
      if (!cancelled) setState({ bookId, value: next });
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (!GROUPS_ENABLED) return null;
  return state && state.bookId === bookId ? state.value : null;
}
