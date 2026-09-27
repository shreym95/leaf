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
 * book previously opened on this device. Stage 4 adds one more goal: an
 * installed PWA opened with no network at all (its `start_url` is
 * `/library`, an authenticated page this worker must never cache — see
 * `handleLibraryNavigation`) lands on the auth-free `/offline` shelf instead
 * of a dead page.
 *
 * Offline-polish pass adds a third, narrower goal: ANY other same-origin
 * navigation that fails offline (`/login` while signed out, `/settings`, a
 * typed URL, `/`) also lands on the `/offline` shelf instead of the
 * browser's own raw connection-error page — see `handleUncachedNavigation`
 * and the fetch handler's final `request.mode === "navigate"` branch. This
 * is NOT a new cache entry in the allowlist below: those routes stay
 * completely uncached (network-first, nothing ever written to any cache for
 * them), and a non-navigation request (a script, an image, a fetch) is
 * untouched by this — it's gated on navigation mode alone, checked last,
 * after every route that DOES get its own caching behaviour above it.
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
 * Redirects an uncached reader navigation to the offline shelf instead of
 * dead-ending on an inline 503 (the pre-Stage-4 behaviour). `/offline` lists
 * every OTHER book this device does have, so a reader who lands on one
 * uncached book — a cold-boot deep link, a shared/typed URL, a book opened on
 * a different device — gets somewhere useful instead of a page with no way
 * out. A 302 (not a served copy of the `/offline` document) so the address
 * bar and history reflect where the reader actually ended up; the browser's
 * follow-up navigation to `/offline` is a SEPARATE fetch event, handled below
 * by `handleOfflineShellNavigation`, which is what actually serves it from
 * cache. Built from `sw.location.origin` rather than a bare relative path:
 * `Response.redirect` resolves relative to the WORKER SCRIPT's own URL, not
 * page root, and that's an unnecessary place for this to be wrong.
 */
function redirectToOfflineShelf(): Response {
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
    return redirectToOfflineShelf();
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
 * Network-first, writing NOTHING to any cache, falling back to the precached
 * `/offline` shelf on failure (the inline 503 floor if even that isn't
 * cached — see `offlineFallbackResponse`). Shared by every same-origin
 * navigation that must stay completely uncached: `/library` below
 * (authenticated, per-user content) and, since the offline-polish pass,
 * `handleUncachedNavigation` (every OTHER navigation not otherwise handled —
 * `/login`, `/settings`, `/`, ...). Deliberately does not know or care WHICH
 * route it was called for: the whole point of both callers is "this route is
 * never cached," so there is exactly one code path that can write to a
 * cache here, and it doesn't.
 */
async function networkFirstNoCacheWithOfflineFallback(
  request: Request
): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(OFFLINE_CACHE);
    const cached = await cache.match(OFFLINE_PATH);
    if (cached) return cached;
    return offlineFallbackResponse();
  }
}

/**
 * `/library` navigations — Stage 4. `/library` is authenticated, per-user
 * content (`force-dynamic`, reads the session cookie), so caching it — even
 * for a moment, even for "just this session" — risks a shared device serving
 * one person's shelf, or stale auth state, to whoever opens Leaf next. Falls
 * back to the precached `/offline` shelf on failure, which is what actually
 * solves the "installed PWA opens `/library` with no network" problem the
 * manifest's `start_url` creates. See `networkFirstNoCacheWithOfflineFallback`
 * for the (shared, uncached) mechanics.
 */
async function handleLibraryNavigation(request: Request): Promise<Response> {
  return networkFirstNoCacheWithOfflineFallback(request);
}

/**
 * Every same-origin navigation that isn't `/reader/<id>`, `/library`, or
 * `/offline` itself — `/login`, `/settings`, `/`, and anything added later.
 * Offline-polish defect fix: previously these fell all the way through to
 * the network with no interception at all, so a failed navigation surfaced
 * the browser's own raw connection-error page instead of anything Leaf
 * controls.
 *
 * Same shape as `handleLibraryNavigation` and for the same reason these
 * routes must stay uncached: `/login` and `/settings` are exactly as
 * session-sensitive as `/library`, most of them are NOT even in this file's
 * allowlist deliberately (see the fetch handler's own comment on that), and
 * nothing about this changes that — this only softens a network failure into
 * the offline shell, it does not add a single byte to any cache. The caller
 * (the fetch handler) is what keeps this scoped to actual navigations only
 * (`request.mode === "navigate"`); this function itself has no opinion on
 * that, same as `handleLibraryNavigation` doesn't either.
 */
async function handleUncachedNavigation(request: Request): Promise<Response> {
  return networkFirstNoCacheWithOfflineFallback(request);
}

/**
 * A direct navigation to `/offline` itself — typed, bookmarked, reached via
 * `redirectToOfflineShelf`, or the PWA's own `start_url` if that's ever
 * pointed here. Network-first so an online visit always sees the current
 * build (and keeps the cache fresh for next time, `keepAlive`d exactly like
 * `handleReaderNavigation`'s cache write); offline, serves the copy
 * `precacheOfflineShell` put there at `install`.
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
 * visit — `handleLibraryNavigation` and `handleOfflineShellNavigation` both
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

  // /library — Stage 4. Network-first, response NEVER cached (see
  // `handleLibraryNavigation`'s doc comment); falls back to the precached
  // `/offline` shelf on failure instead of the browser's own offline error
  // page, which is what makes the PWA's `start_url` survive a cold, offline
  // launch.
  if (request.mode === "navigate" && url.pathname === "/library") {
    event.respondWith(handleLibraryNavigation(request));
    return;
  }

  // /offline itself — Stage 4. Reached directly, or via the redirect from an
  // uncached reader navigation / the /library fallback above.
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

  // Every other same-origin navigation (/settings, /login, /, ...) —
  // offline-polish defect fix. Gated on `request.mode === "navigate"` ALONE,
  // with no pathname check: this is not a new allowlist entry and adds no
  // new caching (see `handleUncachedNavigation`'s doc comment) — it only
  // means a failed navigation to one of these routes gets the precached
  // `/offline` shelf instead of the browser's own raw connection-error page.
  // A non-navigation request to some other, non-allowlisted path (a script,
  // an image, a plain `fetch`) is NOT a "navigate" request and falls through
  // to the network untouched below, exactly as before — it must never
  // receive an HTML body it isn't expecting.
  if (request.mode === "navigate") {
    event.respondWith(handleUncachedNavigation(request));
    return;
  }

  // Every other, non-navigation request to a path not covered above: allow,
  // not intercept. A stale asset with stale auth state must never be
  // servable, and no future route silently inherits caching.
});

export {};
