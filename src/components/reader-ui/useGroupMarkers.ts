"use client";

// Other group members' places in the open book (GROUPS_V1_BUILD.md U4; L1, L5, L6).
//
// With the flag off nothing here runs: no client, no query, no listener. With it on,
// the lookup happens once on open and again on window focus, never blocks rendering,
// and any failure resolves to no markers — it cannot affect reading.
//
// `percent` is the member's `read_progress.percent`, which is measured against the
// read's outline (chapters), not against the viewer's own book. It therefore only
// approximates where that member is on the viewer's progress track.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { findReadForBook, getGroup, getReadProgress } from "@/lib/db/groups";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { resolveUserId } from "@/lib/offline/outbox";

export interface GroupMarker {
  userId: string;
  name: string;
  /** 0–1, as the dock's own `percent`. */
  percent: number;
}

const FALLBACK_NAME = "Member";

function isOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  } catch {
    return false;
  }
}

async function loadMarkers(bookId: string): Promise<GroupMarker[]> {
  const supabase = createClient();
  const me = await resolveUserId(supabase);
  if (!me) return [];
  const reads = await findReadForBook(me, bookId, supabase);
  if (reads.length === 0) return [];

  const groupIds = [...new Set(reads.map(({ read }) => read.group_id))];
  const [groups, progress] = await Promise.all([
    Promise.all(groupIds.map((id) => getGroup(id, supabase))),
    Promise.all(reads.map(({ read }) => getReadProgress(read.id, supabase))),
  ]);

  // Names come from current members only; a row without one is not shown.
  const names = new Map<string, string>();
  for (const detail of groups) {
    for (const m of detail?.members ?? []) {
      if (!names.has(m.user_id)) names.set(m.user_id, m.display_name?.trim() || FALLBACK_NAME);
    }
  }

  const latest = new Map<string, { percent: number; at: number }>();
  for (const rows of progress) {
    for (const row of rows) {
      if (row.user_id === me || !names.has(row.user_id)) continue;
      if (!Number.isFinite(row.percent)) continue;
      const at = Date.parse(row.updated_at);
      const prev = latest.get(row.user_id);
      if (prev && (Number.isNaN(at) ? 0 : at) < prev.at) continue;
      latest.set(row.user_id, {
        percent: Math.min(1, Math.max(0, row.percent)),
        at: Number.isNaN(at) ? 0 : at,
      });
    }
  }

  return [...latest].map(([userId, v]) => ({
    userId,
    name: names.get(userId) ?? FALLBACK_NAME,
    percent: v.percent,
  }));
}

export function useGroupMarkers(bookId: string): GroupMarker[] {
  const [markers, setMarkers] = useState<GroupMarker[]>([]);

  useEffect(() => {
    // L1: flag off → no client, no query, no listener.
    if (!GROUPS_ENABLED) return;

    let cancelled = false;
    let seq = 0;

    function refresh(): void {
      if (isOffline()) return;
      const mine = ++seq;
      void (async () => {
        let next: GroupMarker[] = [];
        try {
          next = await loadMarkers(bookId);
        } catch {
          next = [];
        }
        if (!cancelled && mine === seq) setMarkers(next);
      })();
    }

    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [bookId]);

  return markers;
}
