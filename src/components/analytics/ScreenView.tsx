"use client";

import { useEffect } from "react";
import { trackScreen, type ScreenName } from "@/lib/analytics";

/**
 * ScreenView — fire-and-forget "this screen was shown" beacon. Renders nothing.
 *
 * Drop one into a route (server or client) to count views. It sends only the
 * screen name through `@/lib/analytics` — no route params, ids, titles or
 * content (see that module's hard privacy rule).
 */
export function ScreenView({ name }: { name: ScreenName }) {
  useEffect(() => {
    trackScreen(name);
  }, [name]);

  return null;
}
