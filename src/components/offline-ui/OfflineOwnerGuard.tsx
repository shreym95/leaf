"use client";

import { useEffect } from "react";
import { enforceOfflineOwner } from "@/lib/offline/owner";

/**
 * Mounted once from the root layout (`src/app/layout.tsx`), NOT from either
 * route group's own layout. The root layout is the one ancestor every route
 * shares — `(chrome)`, `(reader)`, and `/offline` (which sits outside both
 * groups and renders from the root layout alone, see that page's header) —
 * so a single mount here runs at every "boot" (a fresh document load; App
 * Router client-side navigations do not remount a layout that's already
 * mounted, which is exactly the "once per boot" semantics this needs).
 *
 * `/offline` is the case that matters most: it is deliberately auth-free (no
 * `requireUser`, no cookies read server-side) so a fully offline PWA launch
 * still has somewhere to land. That is also exactly the page a second user
 * on a shared device would hit first, offline, with the first user's cached
 * books still on disk — so this guard has to be running by the time that
 * page's own client code (`OfflineShelf`) asks what's cached, not just on
 * routes that happen to require a session server-side.
 *
 * Renders nothing. See `enforceOfflineOwner` for what it does and why it can
 * never throw or hang.
 */
export function OfflineOwnerGuard() {
  useEffect(() => {
    void enforceOfflineOwner();
  }, []);

  return null;
}
