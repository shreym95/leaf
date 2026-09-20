/**
 * Offline reading service worker (Stage 1 of the offline plan).
 *
 * Self-contained: no imports from the rest of `src/` (this file is compiled
 * as its own bundle entry via `new URL(..., import.meta.url)` in
 * `RegisterServiceWorker.tsx`, per Next's PWA guide — see
 * `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`).
 *
 * Goal: a navigation to `/reader/<bookId>` succeeds with no network, for a
 * book previously opened on this device. Everything else is deliberately
 * left alone — see the fetch handler's allowlist below.
 *
 * ---------------------------------------------------------------------------
 * SPIKE FINDING — process.env is unusable in this file
 * ---------------------------------------------------------------------------
 * The plan called for cache names to embed `NEXT_PUBLIC_BUILD_ID` directly
 * (`leaf-offline-reader-<buildId>`), so `activate` could drop every cache
 * whose name didn't match the current build. That doesn't work: Turbopack
 * compiles this file into a special "service worker" chunking context
 * (distinct from the normal client/server bundles), and that context does
 * not support Node's `process` module — ANY `process.env.*` reference here
 * fails the whole `next build` with:
 *
 *   TurbopackInternalError: Failed to write app endpoint /favicon.ico/route
 *   Caused by: the chunking context (unknown) does not support external
 *   modules (request: node:process)
 *
 * Confirmed by isolating it to a one-line repro (`const x =
 * process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"` alone breaks the build).
 * `RegisterServiceWorker.tsx`, by contrast, compiles as an ordinary client
 * component, where Next's usual `NEXT_PUBLIC_*` inlining works fine (it's
 * how `IS_DEMO` etc. already work elsewhere in this codebase) — so the build
 * id has to travel from there into the worker at runtime instead of being
 * baked into the worker's own source at build time. See "Versioning" below.
 *
 * ---------------------------------------------------------------------------
 * Local ambient types
 * ---------------------------------------------------------------------------
 * The project's single `tsconfig.json` sets `"lib": ["dom", ...]` for the
 * whole program (app code needs `Window`). TypeScript does not allow mixing
 * the "dom" and "webworker" lib files in one compilation (their globals
 * conflict), and a `/// <reference lib="webworker" />` directive would apply
 * to the whole `tsc` run, not just this file. So instead of pulling in the
 * official webworker lib, this file declares the small slice of the
 * ServiceWorkerGlobalScope surface it actually uses and accesses `self`
 * through that local type via a single cast. `fetch`, `Request`, `Response`,
 * `Headers`, `caches`, and `URL` are all still available from the "dom" lib
 * (they're declared as bare globals / on `WindowOrWorkerGlobalScope`, which
 * `Window` also implements), so those need no special handling.
 */

interface SWExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SWFetchEvent extends Event {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
  waitUntil(promise: Promise<unknown>): void;
}

interface SWMessageEvent extends Event {
  readonly data: unknown;
  readonly source: unknown;
  waitUntil(promise: Promise<unknown>): void;
}

interface SWClient {
  readonly id: string;
}

interface SWClients {
  claim(): Promise<void>;
  matchAll(options?: { includeUncontrolled?: boolean; type?: string }): Promise<SWClient[]>;
}

interface SWRegistration {
  unregister(): Promise<boolean>;
}

interface SWGlobalScope {
  location: Location;
  clients: SWClients;
  registration: SWRegistration;
  skipWaiting(): Promise<void>;
  addEventListener(type: "install", listener: (event: SWExtendableEvent) => void): void;
  addEventListener(type: "activate", listener: (event: SWExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: SWFetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: SWMessageEvent) => void): void;
}

const sw = self as unknown as SWGlobalScope;

// ---------------------------------------------------------------------------
// Kill switch — required by the offline plan. A bad worker can serve stale
// assets across the whole app, so we ship an escape hatch from day one: flip
// this to `true` in a follow-up deploy and every client that boots this
// worker purges its caches and unregisters itself instead of intercepting
// anything.
// ---------------------------------------------------------------------------
const KILL_SWITCH_ENABLED = false;

// ---------------------------------------------------------------------------
// Cache versioning — adapted per the spike finding above. Cache names are
// fixed (no build id in the string); instead the current build id is stored
// as a value inside a small "meta" cache, and RegisterServiceWorker.tsx
// (which CAN see `NEXT_PUBLIC_BUILD_ID`, re-exposed in `next.config.ts`'s
// `env` field from `VERCEL_GIT_COMMIT_SHA`, falling back to a timestamp
// locally) tells the worker what it is via `postMessage`. On a mismatch —
// including "no stored id yet" — the worker drops the reader/static caches
// from whatever the previous build left behind. Net effect is the same as
// the original plan: a deploy drops stale cached shells.
// ---------------------------------------------------------------------------
const CACHE_PREFIX = "leaf-offline";
const READER_CACHE = `${CACHE_PREFIX}-reader`;
const STATIC_CACHE = `${CACHE_PREFIX}-static`;
const META_CACHE = `${CACHE_PREFIX}-meta`;
const BUILD_ID_KEY = "https://leaf.internal/__build_id__";

const READER_ROUTE_PATTERN = /^\/reader\/[^/]+$/;

/**
 * Message shapes the app can post to this worker
 * (`navigator.serviceWorker.controller?.postMessage(...)`):
 *
 *   { type: "leaf-offline/build-id", buildId: string }
 *     Tell the worker the current build id (send this once the worker is
 *     controlling the page, e.g. after `navigator.serviceWorker.ready` and
 *     again on `controllerchange`). If it differs from the id the worker
 *     last saw, the worker drops the reader + static caches before
 *     recording the new one — this is what makes a deploy drop stale
 *     cached shells, since (see spike finding above) the worker's own
 *     source can't read `NEXT_PUBLIC_BUILD_ID` itself.
 *
 *   { type: "leaf-offline/purge" }
 *     Drop every cache this worker owns, unconditionally. Call this on
 *     sign-out: the authenticated `/reader/<id>` document must not outlive
 *     a sign-out, and a second user on the same device must never see the
 *     first user's cached pages.
 *
 * The worker replies to every open client with
 * `{ type: "leaf-offline/purged" }` after either message results in a
 * purge, so a caller can confirm if it wants to.
 */
const BUILD_ID_MESSAGE_TYPE = "leaf-offline/build-id";
const PURGE_MESSAGE_TYPE = "leaf-offline/purge";
const PURGED_MESSAGE_TYPE = "leaf-offline/purged";

async function purgeContentCaches(): Promise<void> {
  await Promise.all([caches.delete(READER_CACHE), caches.delete(STATIC_CACHE)]);
}

async function purgeAllCaches(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key))
  );
}

/** Returns true if the stored build id was stale (and has now been synced). */
async function syncBuildId(buildId: string): Promise<boolean> {
  const meta = await caches.open(META_CACHE);
  const stored = await meta.match(BUILD_ID_KEY);
  const storedBuildId = stored ? await stored.text() : null;
  if (storedBuildId === buildId) return false;
  await purgeContentCaches();
  await meta.put(BUILD_ID_KEY, new Response(buildId));
  return true;
}

async function notifyClientsPurged(): Promise<void> {
  const clients = await sw.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    (client as unknown as { postMessage?: (message: unknown) => void }).postMessage?.({
      type: PURGED_MESSAGE_TYPE,
    });
  }
}

function offlineFallbackResponse(): Response {
  return new Response(
    `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Not available offline</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; color: #333;">
<h1>This book isn't available offline yet</h1>
<p>Open it once while you have a connection, and it'll be ready to read offline after that.</p>
</body>
</html>`,
    {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}

function isRscRequest(request: Request, url: URL): boolean {
  if (url.searchParams.has("_rsc")) return true;
  // Next's RSC fetch header. See fetch-server-response.js: on request
  // failure (offline) the catch block returns the URL string, which the
  // router treats as an MPA navigation — a real document request, which is
  // exactly the class we want to intercept and serve from cache. So we must
  // NOT intercept the RSC fetch itself; let it fail naturally.
  if (request.headers.get("RSC") === "1") return true;
  return false;
}

/**
 * `cache.put` is handed to the event's `waitUntil`, never left dangling: the
 * browser is free to terminate the worker once the promise passed to
 * `respondWith` settles, which would drop a write still in flight and leave
 * the page permanently uncached.
 */
type KeepAlive = (promise: Promise<unknown>) => void;

async function handleReaderNavigation(
  request: Request,
  url: URL,
  keepAlive: KeepAlive
): Promise<Response> {
  const cache = await caches.open(READER_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      keepAlive(cache.put(url.pathname, response.clone()).catch(() => {}));
    }
    return response;
  } catch {
    const cached = await cache.match(url.pathname);
    if (cached) return cached;
    return offlineFallbackResponse();
  }
}

async function handleStaticAsset(
  request: Request,
  keepAlive: KeepAlive
): Promise<Response> {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    keepAlive(cache.put(request, response.clone()).catch(() => {}));
  }
  return response;
}

async function disableWorker(): Promise<void> {
  await purgeAllCaches();
  await sw.registration.unregister();
}

sw.addEventListener("install", (event) => {
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (KILL_SWITCH_ENABLED) {
        await disableWorker();
        return;
      }
      // Any cache from a prior *scheme* (e.g. a future rename of these two
      // caches) would be orphaned garbage; build-id staleness within the
      // current names is handled by `syncBuildId` on the "build-id" message
      // instead (see the spike finding above).
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(CACHE_PREFIX) &&
              key !== READER_CACHE &&
              key !== STATIC_CACHE &&
              key !== META_CACHE
          )
          .map((key) => caches.delete(key))
      );
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener("message", (event) => {
  const data = event.data as { type?: string; buildId?: string } | null;

  if (data?.type === BUILD_ID_MESSAGE_TYPE && typeof data.buildId === "string") {
    const buildId = data.buildId;
    event.waitUntil(
      (async () => {
        const wasStale = await syncBuildId(buildId);
        if (wasStale) await notifyClientsPurged();
      })()
    );
    return;
  }

  if (data?.type === PURGE_MESSAGE_TYPE) {
    event.waitUntil(
      (async () => {
        await purgeAllCaches();
        await notifyClientsPurged();
      })()
    );
  }
});

sw.addEventListener("fetch", (event) => {
  if (KILL_SWITCH_ENABLED) return;

  const { request } = event;

  // Never intercept anything but a plain GET.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin: excludes every Supabase auth call and every signed
  // Storage URL without hardcoding a hostname. No hostname denylist here —
  // this guard is the mechanism.
  if (url.origin !== sw.location.origin) return;

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // RSC payload fetches: let them fail naturally offline so Next's router
  // falls back to a real (MPA) navigation, which we DO intercept below.
  if (isRscRequest(request, url)) return;

  // `/_next/image` proxies a signed, expiring URL via its `url=` param.
  if (url.pathname === "/_next/image") return;

  // Reader navigations only.
  if (request.mode === "navigate" && READER_ROUTE_PATTERN.test(url.pathname)) {
    event.respondWith(
      handleReaderNavigation(request, url, (p) => event.waitUntil(p))
    );
    return;
  }

  // Content-hashed static assets: cache-first, never revalidate.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStaticAsset(request, (p) => event.waitUntil(p)));
    return;
  }

  // Every other navigation (/library, /settings, /login, /, ...): allowlist,
  // not denylist. Do not intercept — a stale shell with stale auth state
  // must never be servable, and no future route silently inherits caching.
});

export {};
