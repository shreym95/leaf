/**
 * Offline reading service worker (Stage 1 of the offline plan; `/library` /
 * `/offline` handling added in Stage 4).
 *
 * Self-contained: no imports from the rest of `src/` (this file is compiled
 * as its own bundle entry via `new URL(..., import.meta.url)` in
 * `RegisterServiceWorker.tsx`, per Next's PWA guide — see
 * `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`).
 *
 * Goal: a navigation to `/reader/<bookId>` succeeds with no network, for a
 * book previously opened on this device — served AT ITS OWN ADDRESS, no
 * redirect. That's the one exception, and the whole point of the feature.
 *
 * Every other navigation that fails offline — an uncached `/reader/<id>`,
 * `/library`, `/login`, `/settings`, `/`, or anything else — lands on ONE
 * address, `/offline`, via a real redirect (302), so the address bar always
 * matches what's actually on screen. (An earlier version served the
 * `/offline` shelf's HTML IN PLACE for every route but the reader, so a
 * failed `/library` navigation still read "/library" in the address bar —
 * two different addresses for the same page. Fixed: one mechanism, one
 * address, for every failed navigation.) This also covers the installed
 * PWA's `start_url` (`/library`, an authenticated page this worker must
 * never cache) landing somewhere useful on a cold, offline launch.
 *
 * See `respondToFailedNavigation` — the single place that decides "redirect
 * to `/offline`, or the 503 floor if even that isn't cached" — and the fetch
 * handler's final `request.mode === "navigate"` branch, which is what routes
 * every navigation not otherwise handled through it. This is NOT a new cache
 * entry in the allowlist below: `/library`, `/login`, `/settings`, etc. stay
 * completely uncached (network-first, nothing ever written to any cache for
 * them) — a failed navigation to one of them changes what the browser DOES
 * with the failure, never what gets stored. A non-navigation request (a
 * script, an image, a fetch) is untouched by any of this — it's gated on
 * navigation mode alone, checked last, after every route that DOES get its
 * own caching behaviour above it.
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
// Stage 4: the auth-free `/offline` shelf's own document, precached at
// install so it can stand in for `/library` (see the fetch handler below).
// Deliberately its OWN cache, not folded into READER_CACHE: unlike a reader
// page it is never written from a runtime navigation-with-fallback (only
// `install` and a successful `/offline` fetch populate it), and unlike
// STATIC_CACHE it is never a `/_next/static/*` cache-first match. Kept
// SEPARATE from `purgeContentCaches` too — see that function's comment.
const OFFLINE_CACHE = `${CACHE_PREFIX}-offline`;
const OFFLINE_PATH = "/offline";
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
 *     Drop READER_CACHE only — the one cache that can hold anything
 *     user-specific (authenticated `/reader/<id>` documents, each embedding
 *     a short-lived signed Supabase Storage URL). Call this on sign-out: that
 *     document must not outlive a sign-out, and a second user on the same
 *     device must never see the first user's cached pages. OFFLINE_CACHE,
 *     STATIC_CACHE and META_CACHE are deliberately left alone: none holds
 *     anything user-specific, and OFFLINE_CACHE in particular is the offline
 *     entry point back into the app (the precached `/offline` shelf) —
 *     nothing repopulates it at runtime (`precacheOfflineShell` only runs on
 *     `install`), so dropping it here left a signed-out, offline visitor
 *     stuck on the inline `offlineFallbackResponse()` instead of the
 *     `/offline` shelf's signed-out state. See `purgeAllCaches` (used only by
 *     the kill switch) for the unscoped version.
 *
 *   { type: "leaf-offline/cache-reader", path: string }
 *     Best-effort: fetch `path` itself (same-origin, credentialed — the same
 *     kind of request a real navigation makes) and, on a genuinely
 *     successful response, cache it into READER_CACHE under the same key
 *     `handleReaderNavigation` uses (`url.pathname`). Exists because a
 *     `/library` → `/reader/<id>` click is a Next App Router SOFT
 *     navigation (an RSC fetch, deliberately excluded below — see
 *     `isRscRequest`), never a `navigate` request, so nothing ever reaches
 *     `handleReaderNavigation` to cache the document during ordinary
 *     click-through use; only a plain reload previously populated the
 *     cache. Send this once a book has finished opening online so it works
 *     offline too even for a reader who never reloads.
 *
 *     `path` is UNTRUSTED — it comes from a page, not from this worker —
 *     and is validated (`validatedReaderPath`) against
 *     `READER_ROUTE_PATTERN` before anything is fetched, so a hostile
 *     same-origin script can only ever make the worker (re)fetch-and-cache
 *     a `/reader/<id>` document using the visiting page's OWN credentials —
 *     exactly what that page could already fetch and see itself by
 *     navigating there directly (RLS still applies server-side; a book the
 *     signed-in user doesn't own 404s, and a 404 is never `response.ok`, so
 *     it's never cached). It cannot be used to fetch or cache any other
 *     path, cross-origin content, or a redirect/error response. No reply is
 *     sent — this is fire-and-forget, and never blocks or surfaces an error
 *     to the page.
 *
 * The worker replies to every open client with
 * `{ type: "leaf-offline/purged" }` after either the "purge" message results
 * in a purge, so a caller can confirm if it wants to.
 */
const BUILD_ID_MESSAGE_TYPE = "leaf-offline/build-id";
const PURGE_MESSAGE_TYPE = "leaf-offline/purge";
const PURGED_MESSAGE_TYPE = "leaf-offline/purged";
const CACHE_READER_MESSAGE_TYPE = "leaf-offline/cache-reader";

/**
 * Dropped on a stale build id (see `syncBuildId` below). Deliberately does
 * NOT include `OFFLINE_CACHE`: that cache is refreshed unconditionally on
 * every `install` (a new SW version — i.e. every deploy — always re-fetches
 * `/offline` fresh, see `precacheOfflineShell`), which already happens
 * before a client ever gets far enough to postMessage a build id. Dropping
 * it again here would just discard a precache that already matches the
 * CURRENT build for no benefit, and — unlike `STATIC_CACHE`, which is
 * repopulated lazily on the next visit to any cached route — nothing
 * lazily repopulates `/offline` at runtime except an online visit to that
 * exact route, so an unnecessary drop here could leave the shelf without
 * its fallback until one happens.
 */
async function purgeContentCaches(): Promise<void> {
  await Promise.all([caches.delete(READER_CACHE), caches.delete(STATIC_CACHE)]);
}

/**
 * Drops READER_CACHE only — the one cache that can hold anything
 * user-specific. Used for the "leaf-offline/purge" message (sign-out /
 * account deletion, via `src/lib/offline/purge.ts`). See that message's doc
 * comment above for why OFFLINE_CACHE, STATIC_CACHE and META_CACHE are left
 * alone, and `purgeAllCaches` below for the kill switch's unscoped version.
 */
async function purgeReaderCache(): Promise<void> {
  await caches.delete(READER_CACHE);
}

/**
 * Drops every cache this worker owns, unconditionally. Used only by the kill
 * switch (`disableWorker`): a worker being retired for being broken should
 * leave no trace at all, which is a different goal from the ordinary
 * sign-out purge's scoping (`purgeReaderCache`) — a bad worker is exactly
 * the situation where "trust that the other three caches are fine" is the
 * assumption most likely to be wrong.
 */
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

/**
 * The absolute last resort: no network, AND whatever cache should have had
 * an answer doesn't. In normal operation this should be unreachable —
 * `/offline` is precached at `install` (see `precacheOfflineShell`) before
 * this worker ever starts intercepting fetches — but `install` fetching
 * `/offline` can itself fail (installing this very worker while already
 * offline), so this stays as a true floor rather than an assumed-dead branch.
 */
function offlineFallbackResponse(): Response {
  return new Response(
    `<!doctype html>
<html>
<head><meta charset="utf-8"><title>You're offline</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; color: #333;">
<h1>You're offline</h1>
<p>This page hasn't been saved on this device yet. Reconnect and try again.</p>
</body>
</html>`,
    {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}

/**
 * The single "this navigation failed" response — every caller below that
 * can't serve its own request (an uncached `/reader/<id>`, or any other
 * navigation at all: `/library`, `/login`, `/settings`, `/`, ...) ends up
 * here. Redirects to `/offline` ONLY when that shell is actually sitting in
 * `OFFLINE_CACHE`; otherwise falls straight to `offlineFallbackResponse()`'s
 * 503 floor, with no redirect at all.
 *
 * That check is what rules out a redirect loop. `/offline` is precached at
 * `install` (`precacheOfflineShell`) before this worker ever starts
 * intercepting fetches — but installing this very worker while ALREADY
 * offline can itself fail that precache, and unconditionally redirecting
 * anyway would hand the browser a second navigation, to a route this worker
 * still can't serve, which would recurse into this exact function again.
 * Checking the cache first means that second navigation never happens: the
 * caller gets the 503 floor directly, in one hop, from wherever it was.
 *
 * `Response.redirect` needs an absolute URL, built from `sw.location.origin`
 * — the WORKER SCRIPT's own URL — rather than a bare relative path (which
 * would resolve relative to that same worker-script URL, not page root, and
 * that's an unnecessary place for this to be wrong).
 */
async function respondToFailedNavigation(): Promise<Response> {
  const cache = await caches.open(OFFLINE_CACHE);
  const cached = await cache.match(OFFLINE_PATH);
  if (!cached) return offlineFallbackResponse();
  return Response.redirect(
    new URL(OFFLINE_PATH, sw.location.origin).toString(),
    302
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

/**
 * `/reader/<bookId>` navigations — the ONE address that does NOT redirect to
 * `/offline` when this worker can actually answer it. Online, a straight
 * network fetch (cached opportunistically for later offline use, same as
 * ever). Offline, whatever this device already has cached under
 * `url.pathname` — served AT THAT SAME ADDRESS, so a cached book keeps
 * opening exactly where it always has. Only when there's truly nothing
 * cached for THIS specific book does it fall through to
 * `respondToFailedNavigation()` and become an address-bar-changing redirect,
 * same as every other failed navigation.
 */
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
    return respondToFailedNavigation();
  }
}

/**
 * Resolves `rawPath` — as posted by a page via `leaf-offline/cache-reader`,
 * UNTRUSTED input — to a same-origin `/reader/<id>` pathname, or `null` for
 * anything else. Parsing through `URL` (rather than testing the raw string
 * directly) normalizes away any query string / fragment / relative dots the
 * caller included, so on a match the returned pathname is EXACTLY the cache
 * key `handleReaderNavigation` would have used for the same document, and on
 * anything else — a different route, a cross-origin URL, garbage — this
 * returns `null` and the caller does nothing.
 */
function validatedReaderPath(rawPath: string): string | null {
  try {
    const url = new URL(rawPath, sw.location.origin);
    if (url.origin !== sw.location.origin) return null;
    if (!READER_ROUTE_PATTERN.test(url.pathname)) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/**
 * Fetches `pathname` itself — a same-origin, credentialed GET, the same kind
 * of request a real navigation makes — and, only on a genuine success,
 * writes it into READER_CACHE under `pathname`. Only ever called with a
 * value `validatedReaderPath` has already approved (see that function and
 * the `leaf-offline/cache-reader` doc comment above for why that's safe).
 *
 * Never surfaces a failure: offline, a signed-out session (redirect), a
 * missing/forbidden book (404), or any other problem here must be completely
 * invisible to the page that asked — `handleReaderNavigation`'s own
 * reload-triggered caching remains the fallback source of truth regardless.
 */
async function cacheReaderDocument(pathname: string): Promise<void> {
  try {
    const response = await fetch(pathname, { credentials: "same-origin" });
    // A redirect (e.g. to a sign-in page) or a non-2xx status (404, 500)
    // must never be cached as if it were the reader document itself.
    if (!response.ok || response.redirected) return;
    const cache = await caches.open(READER_CACHE);
    await cache.put(pathname, response);
  } catch {
    // Best-effort — see doc comment.
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

/**
 * Every same-origin navigation that isn't `/reader/<id>` (the cached case is
 * handled separately above — this function is also what an UNCACHED reader
 * navigation ends up needing, via `respondToFailedNavigation`, but never
 * calls it directly) or `/offline` itself: `/library`, `/login`, `/settings`,
 * `/`, and anything added later. One function for all of them, because they
 * all want exactly the same thing — try the network, write NOTHING to any
 * cache either way (`/library`, `/login` and `/settings` are all
 * authenticated / session-sensitive content, most not even in this file's
 * allowlist deliberately — see the fetch handler's own comment on that — and
 * this adds no exception), and on failure hand off to
 * `respondToFailedNavigation()`: redirect to `/offline` if it's cached, else
 * the 503 floor. (`/library` used to get its own near-identical function,
 * back when it was the only route besides the reader that needed this; the
 * offline-polish pass generalized it to every other navigation too, and
 * keeping a separate `/library`-only wrapper past that point would just have
 * been the same code twice.)
 *
 * The caller (the fetch handler) is what scopes this to actual navigations
 * only (`request.mode === "navigate"`); this function has no opinion on that.
 */
async function handleNavigation(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    return respondToFailedNavigation();
  }
}

/**
 * A direct navigation to `/offline` itself — typed, bookmarked, reached via
 * `respondToFailedNavigation`'s redirect, or the PWA's own `start_url` if
 * that's ever pointed here. NEVER redirected itself — this is the floor
 * every other failed navigation lands on, so it has nowhere further to
 * redirect to. Network-first so an online visit always sees the current
 * build (and keeps the cache fresh for next time, `keepAlive`d exactly like
 * `handleReaderNavigation`'s cache write); offline, serves the copy
 * `precacheOfflineShell` put there at `install`, or the inline 503 floor if
 * even that isn't cached (installing this very worker while already
 * offline).
 */
async function handleOfflineShellNavigation(
  request: Request,
  keepAlive: KeepAlive
): Promise<Response> {
  const cache = await caches.open(OFFLINE_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      keepAlive(cache.put(OFFLINE_PATH, response.clone()).catch(() => {}));
    }
    return response;
  } catch {
    const cached = await cache.match(OFFLINE_PATH);
    if (cached) return cached;
    return offlineFallbackResponse();
  }
}

/**
 * `/_next/static/*` URLs referenced by an HTML document's `href="..."` /
 * `src="..."` attributes — the crude-but-effective way to find out, from
 * INSIDE the worker, which build-hashed chunks a freshly-fetched page
 * actually needs, with no build-time manifest of our own to consult (see the
 * spike-finding comment at the top of this file for why one isn't available
 * here). Good enough for a best-effort precache: a miss here just means that
 * particular asset gets cached lazily instead, the same way every other
 * `/_next/static/*` request already does (`handleStaticAsset`).
 */
const STATIC_ASSET_HREF_PATTERN = /(?:href|src)="(\/_next\/static\/[^"]+)"/g;

async function precacheStaticAssetsReferencedBy(html: string): Promise<void> {
  const urls = new Set<string>();
  for (const match of html.matchAll(STATIC_ASSET_HREF_PATTERN)) {
    urls.add(match[1]);
  }
  if (urls.size === 0) return;

  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    Array.from(urls).map(async (assetUrl) => {
      try {
        if (await cache.match(assetUrl)) return; // already cached
        const response = await fetch(assetUrl);
        if (response && response.ok) await cache.put(assetUrl, response);
      } catch {
        // Best-effort, per asset: one failure must not fail the whole
        // install, and a miss here is recovered later by the ordinary
        // cache-first `/_next/static/*` fetch handler.
      }
    })
  );
}

/**
 * Precaches the `/offline` document itself, plus every `/_next/static/*`
 * asset its markup references — without both, a browser that opens `/offline`
 * (directly, or via the `/library` fallback) with no network at all would get
 * an unhydratable shell: the server-rendered HTML with no JS to run
 * `OfflineShelf`'s `listCachedBooks()` read. Runs on every `install` (i.e.
 * every deploy), fetching fresh rather than trusting anything already
 * cached, so the chunk hashes it stores always match the build that is about
 * to control the page. Entirely best-effort: a failure here (installing this
 * very worker while already offline, most plausibly) leaves `/offline`
 * without a precached fallback until the next successful install or online
 * visit — `respondToFailedNavigation` and `handleOfflineShellNavigation` both
 * already degrade further to `offlineFallbackResponse()` for exactly that
 * case.
 */
async function precacheOfflineShell(): Promise<void> {
  try {
    const response = await fetch(OFFLINE_PATH, { cache: "no-store" });
    if (!response || !response.ok) return;
    const html = await response.clone().text();
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.put(OFFLINE_PATH, response);
    await precacheStaticAssetsReferencedBy(html);
  } catch {
    // Network unavailable at install time — best-effort, see the doc comment.
  }
}

/**
 * Kill switch. Deliberately calls the UNSCOPED `purgeAllCaches` (every cache
 * this worker owns), not `purgeReaderCache` — a worker being retired as
 * broken should leave nothing behind, including OFFLINE_CACHE/STATIC_CACHE/
 * META_CACHE, which the ordinary sign-out purge above keeps.
 */
async function disableWorker(): Promise<void> {
  await purgeAllCaches();
  await sw.registration.unregister();
}

sw.addEventListener("install", (event) => {
  // `skipWaiting` and the precache are independent — either failing must
  // not block the other, so this is a `Promise.all`, not a `.then` chain.
  // `precacheOfflineShell` never rejects (it's internally try/caught) but
  // treating it as fallible here costs nothing and documents the intent.
  event.waitUntil(Promise.all([sw.skipWaiting(), precacheOfflineShell()]));
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
              key !== META_CACHE &&
              key !== OFFLINE_CACHE
          )
          .map((key) => caches.delete(key))
      );
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener("message", (event) => {
  const data = event.data as
    | { type?: string; buildId?: string; path?: unknown }
    | null;

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
        await purgeReaderCache();
        await notifyClientsPurged();
      })()
    );
    return;
  }

  if (data?.type === CACHE_READER_MESSAGE_TYPE) {
    const rawPath = data.path;
    if (typeof rawPath === "string") {
      const pathname = validatedReaderPath(rawPath);
      if (pathname) {
        event.waitUntil(cacheReaderDocument(pathname));
      }
    }
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

  // `/auth/*` navigations happen only mid-OAuth (the provider redirect back
  // to Supabase's callback route, which then redirects again into the app) —
  // a flow that needs network by definition, since it's exchanging a code
  // with Supabase's auth server. Redirecting a failed leg of THAT to
  // `/offline` would just swap one non-working mid-flow state for another,
  // and would risk this worker ever standing in the middle of a cookie
  // exchange it has no business touching. Left excluded, same as `/api/*`.
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

  // /offline itself — Stage 4. Reached directly, or via
  // `respondToFailedNavigation`'s redirect from every other failed
  // navigation below (including an uncached reader page). NEVER itself
  // redirected — see `handleOfflineShellNavigation`'s doc comment.
  if (request.mode === "navigate" && url.pathname === OFFLINE_PATH) {
    event.respondWith(
      handleOfflineShellNavigation(request, (p) => event.waitUntil(p))
    );
    return;
  }

  // Content-hashed static assets: cache-first, never revalidate.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStaticAsset(request, (p) => event.waitUntil(p)));
    return;
  }

  // Every other same-origin navigation — `/library`, `/login`, `/settings`,
  // `/`, and anything else. Gated on `request.mode === "navigate"` ALONE,
  // with no pathname check: this is not an allowlist and adds no new caching
  // (see `handleNavigation`'s doc comment) — a failed navigation here
  // redirects to the precached `/offline` shelf (or the 503 floor if even
  // that isn't cached), same one address every failed navigation ends up at,
  // rather than serving anything in place at the original URL. A
  // non-navigation request to some other, non-allowlisted path (a script, an
  // image, a plain `fetch`) is NOT a "navigate" request and falls through to
  // the network untouched below, exactly as before — it must never receive a
  // redirect or an HTML body meant for a page.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Every other, non-navigation request to a path not covered above: allow,
  // not intercept. A stale asset with stale auth state must never be
  // servable, and no future route silently inherits caching.
});

export {};
