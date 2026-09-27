"use client";

import { useEffect } from "react";

import { IS_DEMO } from "@/lib/demo/flag";

/** Must match `BUILD_ID_MESSAGE_TYPE` in `src/lib/offline/service-worker.ts`. */
const BUILD_ID_MESSAGE_TYPE = "leaf-offline/build-id";

/**
 * Registers the offline reading service worker (Stage 1 of the offline
 * plan). Mounted app-wide from the root layout, `src/app/layout.tsx` — see
 * the comment there for why it is no longer reader-only (a session that never
 * opened a book never installed a worker). Its reach is root scope
 * (`scope: "/"`), which Next's build grants it via an
 * auto-injected `Service-Worker-Allowed` header (see
 * `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`).
 *
 * Renders nothing. Bails out entirely in demo mode, in non-production
 * builds, and in browsers without `navigator.serviceWorker` — offline
 * reading simply doesn't activate; the reader works online exactly as
 * today. Registration failure is caught and swallowed for the same reason.
 *
 * Also tells the worker the current build id once it's controlling the
 * page, and again on every `controllerchange` (a new worker took over
 * mid-session). The worker's own source can't read `NEXT_PUBLIC_BUILD_ID`
 * itself — see the spike-finding comment at the top of
 * `service-worker.ts` — so this component, an ordinary client component
 * where Next's env inlining works normally, carries the value across at
 * runtime instead.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (IS_DEMO) return;
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const buildId = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
    const sendBuildId = () => {
      navigator.serviceWorker.controller?.postMessage({
        type: BUILD_ID_MESSAGE_TYPE,
        buildId,
      });
    };

    navigator.serviceWorker
      .register(new URL("../../lib/offline/service-worker.ts", import.meta.url), {
        scope: "/",
        updateViaCache: "none",
      })
      .then(() => navigator.serviceWorker.ready)
      .then(sendBuildId)
      .catch(() => {
        // Offline reading simply doesn't activate; the reader still works
        // online exactly as today.
      });

    navigator.serviceWorker.addEventListener("controllerchange", sendBuildId);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", sendBuildId);
    };
  }, []);

  return null;
}
