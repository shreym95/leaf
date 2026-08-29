// Reading-position tracking + restore (SPEC §3.7, §8). LOGIC ONLY — no
// design/component imports.
//
// The CFI round-trip is the core promise: what you were reading is exactly
// where you reopen (same device or another). This module:
//   - subscribes to the engine's `relocated` stream, debounces, and writes the
//     CFI + percent to `reading_state`;
//   - `restore()` reads the row back and navigates the engine to that CFI.
//
// Write path: the BROWSER Supabase client + RLS, not a Route Handler. RLS on
// `reading_state` is `user_id = auth.uid()`, which resolves from the session
// cookie, so a direct client write is already scoped to the user — no extra
// endpoint to build or secure. `user_id` for the row comes from
// `supabase.auth.getUser()`.

import { createClient } from "@/lib/supabase/client";
import { getReadingState, upsertReadingState } from "@/lib/db/reading-state";
import type { ReaderController, ReaderLocation } from "./engine";

export interface PositionTracker {
  restore(): Promise<boolean>;
  stop(): void;
}

const DEFAULT_DEBOUNCE_MS = 1500;

export function trackPosition(
  controller: ReaderController,
  bookId: string,
  opts?: { debounceMs?: number },
): PositionTracker {
  const debounceMs = opts?.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { cfi: string; percent: number } | undefined;
  let stopped = false;

  async function flush(): Promise<void> {
    if (!pending) return;
    const toWrite = pending;
    pending = undefined;
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return; // signed out — nothing to scope the write to
      await upsertReadingState(user.id, bookId, toWrite, supabase);
    } catch {
      // Position sync is best-effort: a failed write must never interrupt
      // reading. The next relocation will try again.
    }
  }

  const unsubscribe = controller.onRelocated((loc: ReaderLocation) => {
    if (stopped || !loc.cfi) return;
    pending = { cfi: loc.cfi, percent: loc.percent };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, debounceMs);
  });

  return {
    async restore(): Promise<boolean> {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return false;
        const row = await getReadingState(user.id, bookId, supabase);
        if (row?.cfi) {
          await controller.goTo(row.cfi);
          return true;
        }
        return false;
      } catch {
        // No stored position we can reach — start from the top.
        return false;
      }
    },

    stop(): void {
      stopped = true;
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      // Flush a pending debounced write so the last page read is not lost.
      void flush();
    },
  };
}
