// Durable outbox for the five client-side writes that go straight from the
// browser Supabase client to Postgres and, today, silently drop on failure
// (`docs/REVISED_PLAN.md` §8, `DEFECTS.md` D8):
//   - reading position    (src/reader/position.ts)
//   - bookmarks           (src/reader/bookmarks.ts)
//   - highlights          (src/reader/highlights.ts)
//   - reader settings     (src/store/reader-settings.ts)
//   - finished / unread   (src/reader/book-status.ts)
//
// LOGIC ONLY — no design/component imports (ESLint seam rule).
//
// Shape: an append-only IndexedDB queue (`OutboxStore`) + a replay engine
// (`drain`) that is deliberately generic over the store and over per-kind
// `ReplayHandler`s. That split is what makes this testable at all: jsdom has
// no IndexedDB, and this repo cannot add `fake-indexeddb` (another agent owns
// `package.json`), so `outbox.test.ts` exercises `drain` and the conflict
// rule (`isFurtherAlong`) against a hand-written in-memory `OutboxStore`. Only
// `createIndexedDbStore` and `initOutboxReplay`'s event wiring need a real
// browser — see the test file's header for exactly what is and isn't covered.
//
// Storage is a SEPARATE IndexedDB database (`leaf-outbox`) from the book
// store's `leaf-books`, so the two agents' schemas cannot collide.
//
// Conventions follow `src/reader/locations-cache.ts`: a support guard that
// survives SSR *and* blocked storage, operations that never throw, and
// silent degradation to today's behaviour (drop the write) when IndexedDB is
// unavailable.

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getReadingState, upsertReadingState } from "@/lib/db/reading-state";
import { setBookFinished } from "@/lib/db/book-status";
import { createBookmark, deleteBookmark } from "@/lib/db/bookmarks";
import {
  createHighlight,
  deleteHighlight,
  updateHighlightNote,
} from "@/lib/db/highlights";

// ---------------------------------------------------------------------------
// Entry shapes
// ---------------------------------------------------------------------------

export type OutboxKind =
  | "reading-state"
  | "bookmark-create"
  | "bookmark-delete"
  | "highlight-create"
  | "highlight-delete"
  | "highlight-note"
  | "reader-settings"
  | "book-status";

export interface ReadingStatePayload {
  userId: string;
  bookId: string;
  cfi: string;
  percent: number;
}

export interface BookmarkCreatePayload {
  userId: string;
  /** The optimistic `local-…` id the manager already showed the user. */
  localId: string;
  bookId: string;
  cfi: string;
  label: string | null;
  percent: number | null;
}

export interface BookmarkDeletePayload {
  userId: string;
  id: string;
}

export interface HighlightCreatePayload {
  userId: string;
  localId: string;
  bookId: string;
  cfiRange: string;
  text: string;
  color: string;
}

export interface HighlightDeletePayload {
  userId: string;
  id: string;
}

export interface HighlightNotePayload {
  userId: string;
  id: string;
  note: string | null;
}

/** Exactly the row shape `reader-settings.ts`'s `toRow()` already builds. */
export interface ReaderSettingsRowPayload {
  user_id: string;
  font_family: string;
  font_size: number;
  line_spacing: number;
  margins: string;
  theme: string;
}

/** A finished/unread write. `finishedAt` null = back to unread. */
export interface BookStatusPayload {
  userId: string;
  bookId: string;
  finishedAt: string | null;
}

export type OutboxPayload =
  | ReadingStatePayload
  | BookmarkCreatePayload
  | BookmarkDeletePayload
  | HighlightCreatePayload
  | HighlightDeletePayload
  | HighlightNotePayload
  | ReaderSettingsRowPayload
  | BookStatusPayload;

/** One queued write. Enough to replay itself with no other context. The
 *  storage layer treats `payload` as opaque (`unknown`, not the `OutboxPayload`
 *  union above) — only the per-kind `ReplayHandler` knows its concrete shape,
 *  which keeps `OutboxStore` (and its test fake) free of every kind's types. */
export interface QueuedEntry<P = unknown> {
  id: string;
  kind: OutboxKind;
  /** Target-row identity — used for ordering-independent lookups (cancel /
   *  coalesce), not for ordering itself (that's insertion order). */
  key: string;
  payload: P;
  /** Monotonic write time (ms). Doubles as the `updated_at` proxy for the
   *  reading-state conflict rule. */
  ts: number;
}

// ---------------------------------------------------------------------------
// Storage adapter — the seam the tests inject a fake through.
// ---------------------------------------------------------------------------

export interface OutboxStore {
  /** Append one entry. Returns its generated id. */
  enqueue(entry: Omit<QueuedEntry, "id">): Promise<string>;
  /** Every queued entry, oldest first. */
  list(): Promise<QueuedEntry[]>;
  /** Drop one entry — called once it has landed, or is confirmed dead. */
  discard(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// The conflict rule — §8(b). Pure and independently testable.
// ---------------------------------------------------------------------------

export interface PositionSnapshot {
  percent: number;
  updatedAt: string;
}

/**
 * Furthest-position-wins, not last-write-wins: a queued write from an hour
 * ago must never drag a reader backwards on a device that has since read
 * further. `percent` is the cheap proxy §8 sanctions over `EpubCFI.compare`;
 * `updatedAt` (ISO 8601, lexicographically sortable) breaks an exact tie.
 */
export function isFurtherAlong(
  current: PositionSnapshot | null,
  queued: PositionSnapshot,
): boolean {
  if (!current) return true;
  if (queued.percent > current.percent) return true;
  if (queued.percent < current.percent) return false;
  return queued.updatedAt >= current.updatedAt;
}

// ---------------------------------------------------------------------------
// Failure classification — transport (retry) vs. rejection (discard).
// ---------------------------------------------------------------------------

export type WriteFailure = "transport" | "rejected";

/**
 * A genuine Postgrest/Postgres error — RLS denial, a missing FK, invalid
 * input — always carries a structured `code` string: the request reached the
 * server and was refused. A connectivity failure (offline, DNS, timeout, the
 * tab dying mid-request) surfaces as a plain `TypeError` / "Failed to fetch"
 * with no such field. `SupabaseNotConfiguredError` (env not wired) is neither
 * — there is no backend to ever replay against, so treat it the same as a
 * rejection: nothing worth queuing.
 *
 * This is a heuristic on `supabase-js`'s documented error shape, not a
 * guarantee — see the test file and the final report for what would need a
 * real browser/Supabase project to confirm end-to-end.
 */
export function classifyWriteFailure(err: unknown): WriteFailure {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; name?: unknown };
    if (e.name === "SupabaseNotConfiguredError") return "rejected";
    if (typeof e.code === "string" && e.code.length > 0) return "rejected";
  }
  return "transport";
}

// ---------------------------------------------------------------------------
// Offline-tolerant identity resolution.
//
// `auth.getUser()` revalidates against the Auth server — exactly the network
// round trip that fails offline. `auth.getSession()` reads the already-
// verified session back out of local storage with no network call, so it is
// the only way to learn *who* a write belongs to once `getUser()` has failed
// for being offline. It is used ONLY to address a queued write; the online
// path is untouched and keeps using `getUser()` first.
// ---------------------------------------------------------------------------

interface MinimalAuthClient {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error?: unknown;
    }>;
    getSession: () => Promise<{
      data: { session: { user: { id: string } } | null };
    }>;
  };
}

/**
 * `getUser()`, falling back to the cached session when the Auth server is
 * unreachable. Null means "signed out" or "no identity we can safely queue
 * against" — either way, drop.
 *
 * auth-js does NOT throw on a network failure: it catches the
 * `AuthRetryableFetchError` and RESOLVES `{ data: { user: null }, error }`.
 * So the offline case is an `error` that is a retryable fetch error, not an
 * exception. Only that error falls back to the cached session. Any other
 * error (e.g. `AuthSessionMissingError`) or no error with no user means the
 * server — or the local storage — says nobody is signed in: return null and
 * never queue against a cached id the server just disowned. A thrown
 * `getUser()` (defensive; not what auth-js does) also falls back.
 */
export async function resolveUserId(
  supabase: MinimalAuthClient,
): Promise<string | null> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (user) return user.id;
    if (error && isAuthRetryableFetchError(error)) {
      return getCachedUserId(supabase);
    }
    return null;
  } catch {
    return getCachedUserId(supabase);
  }
}

/** The locally cached session's user id, with no network round trip. Used
 *  directly by the page-hide flush (D8), where even attempting the network
 *  is the thing we're trying to avoid. */
export async function getCachedUserId(
  supabase: MinimalAuthClient,
): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Replay engine — generic over `OutboxStore` and `ReplayHandler`. This is the
// part `outbox.test.ts` drives directly with a fake store + fake handlers.
// ---------------------------------------------------------------------------

/**
 * `applied`  — the write happened.
 * `skipped`  — correctly did nothing (a stale queued position, or a delete
 *              whose row is already gone) — success, not failure.
 * `rejected` — a non-network failure (RLS, bad data, no backend configured).
 * `transport`— a connectivity failure; leave the entry queued.
 */
export type ReplayOutcome = "applied" | "skipped" | "rejected" | "transport";

export type ReplayHandler = (entry: QueuedEntry) => Promise<ReplayOutcome>;

export interface DrainResult {
  applied: number;
  skipped: number;
  rejected: number;
  requeued: number;
}

/** Replay every queued entry once, oldest first. An entry a handler doesn't
 *  recognise is left alone (forward compatibility), not discarded. */
export async function drain(
  store: OutboxStore,
  handlers: Partial<Record<OutboxKind, ReplayHandler>>,
): Promise<DrainResult> {
  const result: DrainResult = { applied: 0, skipped: 0, rejected: 0, requeued: 0 };
  const entries = await store.list();
  for (const entry of entries) {
    const handler = handlers[entry.kind];
    if (!handler) continue;
    let outcome: ReplayOutcome;
    try {
      outcome = await handler(entry);
    } catch {
      // A handler must not throw, but if one slips through, be conservative
      // and retry later rather than lose the write.
      outcome = "transport";
    }
    switch (outcome) {
      case "applied":
        result.applied += 1;
        await store.discard(entry.id);
        break;
      case "skipped":
        result.skipped += 1;
        await store.discard(entry.id);
        break;
      case "rejected":
        result.rejected += 1;
        await store.discard(entry.id);
        break;
      case "transport":
        result.requeued += 1;
        break; // leave it queued
    }
  }
  return result;
}

/** Find the first still-queued entry matching `kind` + `key`, if any. */
export async function findPending(
  store: OutboxStore,
  kind: OutboxKind,
  key: string,
): Promise<QueuedEntry | undefined> {
  const entries = await store.list();
  return entries.find((e) => e.kind === kind && e.key === key);
}

/** Cancel a still-queued entry by kind + key. Returns whether one was found.
 *  Used to drop a queued `*-create` when its optimistic record is deleted
 *  before ever reaching the server — see `enqueueBookmarkDelete` /
 *  `enqueueHighlightDelete` below for why that matters. */
export async function cancelPending(
  store: OutboxStore,
  kind: OutboxKind,
  key: string,
): Promise<boolean> {
  const entry = await findPending(store, kind, key);
  if (!entry) return false;
  await store.discard(entry.id);
  return true;
}

// ---------------------------------------------------------------------------
// IndexedDB-backed store — the real thing. Every operation is wrapped so a
// missing, blocked, or erroring IndexedDB degrades to "the write is dropped",
// exactly like today, rather than breaking reading.
// ---------------------------------------------------------------------------

const DB_NAME = "leaf-outbox";
const DB_VERSION = 1;
const STORE_NAME = "entries";

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    if (!idbAvailable()) {
      resolve(undefined);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
      req.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * One connection, shared by every operation. Opening per call leaked a handle
 * each time, and a live handle blocks a later `DB_VERSION` upgrade with
 * `onblocked` — the failure `openDb` already degrades on. Dropped on
 * `versionchange`/`close`, and guarded by the `IDBFactory` it was opened from,
 * since a handle is only valid for its own factory (tests swap the global).
 * A failed open is never memoised: storage can become available again.
 */
let dbPromise: Promise<IDBDatabase | undefined> | undefined;
let dbFactory: IDBFactory | undefined;

function currentFactory(): IDBFactory | undefined {
  try {
    return typeof indexedDB === "undefined" ? undefined : indexedDB;
  } catch {
    return undefined;
  }
}

function getDb(): Promise<IDBDatabase | undefined> {
  const factory = currentFactory();
  if (!factory) return Promise.resolve(undefined);
  if (dbPromise && dbFactory === factory) return dbPromise;

  dbFactory = factory;
  const pending = openDb().then((db) => {
    if (!db) {
      if (dbPromise === pending) dbPromise = undefined;
      return undefined;
    }
    db.onversionchange = () => {
      db.close();
      if (dbPromise === pending) dbPromise = undefined;
    };
    db.onclose = () => {
      if (dbPromise === pending) dbPromise = undefined;
    };
    return db;
  });
  dbPromise = pending;
  return pending;
}

let idSeq = 0;
/** Chronologically sortable (string keys sort lexicographically in
 *  IndexedDB, and `Date.now()` only grows), unique within a session. */
function makeId(): string {
  idSeq += 1;
  return `${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** The real store. Every method resolves to a no-op / empty result on any
 *  kind of storage failure — never throws. */
export function createIndexedDbStore(): OutboxStore {
  return {
    async enqueue(entry) {
      const id = makeId();
      try {
        const db = await getDb();
        if (!db) return id; // no IndexedDB — the write is simply not queued
        await new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).add({ ...entry, id });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        });
      } catch {
        // degrade silently
      }
      return id;
    },

    async list() {
      try {
        const db = await getDb();
        if (!db) return [];
        return await new Promise<QueuedEntry[]>((resolve) => {
          try {
            const tx = db.transaction(STORE_NAME, "readonly");
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => resolve((req.result as QueuedEntry[]) ?? []);
            req.onerror = () => resolve([]);
          } catch {
            resolve([]);
          }
        });
      } catch {
        return [];
      }
    },

    async discard(id) {
      try {
        const db = await getDb();
        if (!db) return;
        await new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        });
      } catch {
        // degrade silently
      }
    },
  };
}

// A single store instance for the whole tab — real IndexedDB is fine to
// share across every enqueue/replay call.
const store: OutboxStore = createIndexedDbStore();

// ---------------------------------------------------------------------------
// Real per-kind replay handlers — the part `drain()` is parameterised over.
// ---------------------------------------------------------------------------

function readingStateHandler(): ReplayHandler {
  return async (entry) => {
    const p = entry.payload as ReadingStatePayload;
    try {
      const supabase = createClient();
      const current = await getReadingState(p.userId, p.bookId, supabase);
      const queued: PositionSnapshot = {
        percent: p.percent,
        updatedAt: new Date(entry.ts).toISOString(),
      };
      if (
        current &&
        !isFurtherAlong(
          { percent: current.percent, updatedAt: current.updated_at },
          queued,
        )
      ) {
        return "skipped"; // stale — a further position already landed
      }
      await upsertReadingState(p.userId, p.bookId, { cfi: p.cfi, percent: p.percent }, supabase);
      return "applied";
    } catch (err) {
      return classifyWriteFailure(err);
    }
  };
}

function bookmarkCreateHandler(): ReplayHandler {
  return async (entry) => {
    const p = entry.payload as BookmarkCreatePayload;
    try {
      const supabase = createClient();
      await createBookmark(
        p.userId,
        { bookId: p.bookId, cfi: p.cfi, label: p.label, percent: p.percent },
        supabase,
      );
      return "applied";
    } catch (err) {
      return classifyWriteFailure(err);
    }
  };
}

function bookmarkDeleteHandler(): ReplayHandler {
  return async (entry) => {
    const p = entry.payload as BookmarkDeletePayload;
    try {
      const supabase = createClient();
      // A delete that matches nothing (the row is already gone) is not an
      // error from Postgrest — this naturally covers "already-gone = success".
      await deleteBookmark(p.userId, p.id, supabase);
      return "applied";
    } catch (err) {
      return classifyWriteFailure(err);
    }
  };
}

function highlightCreateHandler(): ReplayHandler {
  return async (entry) => {
    const p = entry.payload as HighlightCreatePayload;
    try {
      const supabase = createClient();
      await createHighlight(
        p.userId,
        { bookId: p.bookId, cfiRange: p.cfiRange, text: p.text, color: p.color },
        supabase,
      );
      return "applied";
    } catch (err) {
      return classifyWriteFailure(err);
    }
  };
}

function highlightDeleteHandler(): ReplayHandler {
  return async (entry) => {
    const p = entry.payload as HighlightDeletePayload;
    try {
      const supabase = createClient();
      await deleteHighlight(p.userId, p.id, supabase);
      return "applied";
    } catch (err) {
      return classifyWriteFailure(err);
    }
  };
}

function highlightNoteHandler(): ReplayHandler {
  return async (entry) => {
    const p = entry.payload as HighlightNotePayload;
    try {
      const supabase = createClient();
      await updateHighlightNote(p.userId, p.id, p.note, supabase);
      return "applied";
    } catch (err) {
      return classifyWriteFailure(err);
    }
  };
}

function readerSettingsHandler(): ReplayHandler {
  return async (entry) => {
    const row = entry.payload as ReaderSettingsRowPayload;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("reader_settings")
        .upsert(row, { onConflict: "user_id" });
      if (error) throw error;
      return "applied";
    } catch (err) {
      return classifyWriteFailure(err);
    }
  };
}

function bookStatusHandler(): ReplayHandler {
  return async (entry) => {
    const p = entry.payload as BookStatusPayload;
    try {
      const supabase = createClient();
      // `setBookFinished`'s finished path only touches a not-yet-finished row,
      // so a stale replay after a later finish matches nothing and is harmless.
      await setBookFinished(p.userId, p.bookId, p.finishedAt, supabase);
      return "applied";
    } catch (err) {
      return classifyWriteFailure(err);
    }
  };
}

function realHandlers(): Partial<Record<OutboxKind, ReplayHandler>> {
  return {
    "reading-state": readingStateHandler(),
    "bookmark-create": bookmarkCreateHandler(),
    "bookmark-delete": bookmarkDeleteHandler(),
    "highlight-create": highlightCreateHandler(),
    "highlight-delete": highlightDeleteHandler(),
    "highlight-note": highlightNoteHandler(),
    "reader-settings": readerSettingsHandler(),
    "book-status": bookStatusHandler(),
  };
}

// ---------------------------------------------------------------------------
// Public enqueue helpers — what position.ts / bookmarks.ts / highlights.ts /
// reader-settings.ts actually call from their `catch` blocks.
// ---------------------------------------------------------------------------

export async function enqueueReadingState(
  userId: string,
  bookId: string,
  patch: { cfi: string; percent: number },
): Promise<void> {
  await store.enqueue({
    kind: "reading-state",
    key: `${userId}:${bookId}`,
    payload: { userId, bookId, cfi: patch.cfi, percent: patch.percent },
    ts: Date.now(),
  });
}

export async function enqueueBookmarkCreate(
  userId: string,
  input: { localId: string; bookId: string; cfi: string; label: string | null; percent: number | null },
): Promise<void> {
  await store.enqueue({
    kind: "bookmark-create",
    key: `${userId}:${input.localId}`,
    payload: {
      userId,
      localId: input.localId,
      bookId: input.bookId,
      cfi: input.cfi,
      label: input.label,
      percent: input.percent,
    },
    ts: Date.now(),
  });
}

/**
 * A bookmark whose id still starts with `local-` never made it past its
 * create — nothing exists server-side to delete. Rather than ask the server
 * to delete a row it never got (which would either no-op or error on the
 * non-UUID id, depending on timing), cancel the still-queued create so it
 * never replays into a ghost row the reader thought they'd deleted. Returns
 * true if a create was in fact queued and cancelled.
 */
export async function cancelQueuedBookmarkCreate(
  userId: string,
  localId: string,
): Promise<boolean> {
  return cancelPending(store, "bookmark-create", `${userId}:${localId}`);
}

export async function enqueueBookmarkDelete(userId: string, id: string): Promise<void> {
  await store.enqueue({
    kind: "bookmark-delete",
    key: `${userId}:${id}`,
    payload: { userId, id },
    ts: Date.now(),
  });
}

export async function enqueueHighlightCreate(
  userId: string,
  input: { localId: string; bookId: string; cfiRange: string; text: string; color: string },
): Promise<void> {
  await store.enqueue({
    kind: "highlight-create",
    key: `${userId}:${input.localId}`,
    payload: {
      userId,
      localId: input.localId,
      bookId: input.bookId,
      cfiRange: input.cfiRange,
      text: input.text,
      color: input.color,
    },
    ts: Date.now(),
  });
}

/** Same reasoning as `cancelQueuedBookmarkCreate`, for highlights. */
export async function cancelQueuedHighlightCreate(
  userId: string,
  localId: string,
): Promise<boolean> {
  return cancelPending(store, "highlight-create", `${userId}:${localId}`);
}

export async function enqueueHighlightDelete(userId: string, id: string): Promise<void> {
  await store.enqueue({
    kind: "highlight-delete",
    key: `${userId}:${id}`,
    payload: { userId, id },
    ts: Date.now(),
  });
}

/**
 * NOTE: if `id` is still a `local-…` id (the highlight has not synced yet —
 * its create is itself queued), the note is queued too but will be discarded
 * unappliable on replay, since it targets an id the server never assigned.
 * The note is lost, same as it is today for this same offline-before-first-
 * sync case — not a regression, just not fully solved either. Merging a
 * pending note into its still-queued create entry would fix this but is out
 * of scope here.
 */
export async function enqueueHighlightNote(
  userId: string,
  id: string,
  note: string | null,
): Promise<void> {
  await store.enqueue({
    kind: "highlight-note",
    key: `${userId}:${id}`,
    payload: { userId, id, note },
    ts: Date.now(),
  });
}

/**
 * Reader settings are a single row per user, replayed as a full snapshot —
 * only the latest matters. Drop any still-queued settings write for this
 * user before adding the new one so an offline settings-fiddling session
 * doesn't pile up redundant entries.
 */
export async function enqueueReaderSettings(row: ReaderSettingsRowPayload): Promise<void> {
  await cancelPending(store, "reader-settings", row.user_id);
  await store.enqueue({
    kind: "reader-settings",
    key: row.user_id,
    payload: row,
    ts: Date.now(),
  });
}

/**
 * Finished/unread is one fact per (user, book) — only the latest intent
 * matters, so a queued earlier write for the same book is dropped first
 * (finish, then un-finish, offline replays as just the un-finish).
 */
export async function enqueueBookStatus(
  userId: string,
  bookId: string,
  finishedAt: string | null,
): Promise<void> {
  const key = `${userId}:${bookId}`;
  await cancelPending(store, "book-status", key);
  await store.enqueue({
    kind: "book-status",
    key,
    payload: { userId, bookId, finishedAt },
    ts: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Replay trigger — on the `online` event and on next start.
// ---------------------------------------------------------------------------

let replaying = false;
async function replayNow(): Promise<void> {
  if (replaying) return;
  replaying = true;
  try {
    await drain(store, realHandlers());
  } catch {
    // never let a replay failure surface anywhere
  } finally {
    replaying = false;
  }
}

/**
 * Drop every queued write and close the connection. Called on sign-out and on
 * account deletion, alongside the book store's `purgeCachedBooks()` and the
 * service worker's `leaf-offline/purge` message.
 *
 * The outbox holds reading positions, bookmark and highlight text keyed by
 * user id. That is another person's content if the device changes hands, so it
 * must not outlive the session that produced it. Like everything else here,
 * this never throws — a purge that cannot run must not block sign-out.
 */
export async function purgeOutbox(): Promise<void> {
  try {
    const db = await getDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
      db.close();
    }
  } catch {
    // Best-effort, as above.
  }
  dbPromise = undefined;
  dbFactory = undefined;
}

let initialized = false;
/**
 * Wire up replay. Idempotent, SSR-safe. Called once, below, as a side effect
 * of importing this module — every one of the four write paths already
 * imports it to enqueue, so this fires as soon as any of them loads
 * client-side ("on next start"), with no separate call needed from
 * `ReaderShell` (out of scope for this agent).
 */
export function initOutboxReplay(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("online", () => void replayNow());
  void replayNow();
}

initOutboxReplay();
