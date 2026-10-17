// Typed convenience wrappers over the `annotations` table (0012, NOTES_PLAN §4.1).
//
// Like `bookmarks.ts`, these take an EXPLICIT Supabase client so the module stays
// browser-safe. Callers provide the client:
//   - browser (reader annotation manager): the browser client.
//   - server (Route Handlers / Server Components): `await createClient()` from
//     `@/lib/supabase/server`.
//
// Security is RLS (owner-only, 0012). The rows are scoped to the signed-in user by
// the policy, so these functions take no user id on reads, updates or deletes. A
// create takes `userId` because the insert must name its owner (`user_id = auth.uid()`).
//
// Client-side checks below mirror the database checks (0012) so a bad value fails
// before a round trip. The database remains the guard.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Annotation, AnnotationKind } from "@/lib/types";
import {
  classifyWriteFailure,
  pendingAnnotationEntries,
  type AnnotationCreatePayload,
  type AnnotationDeletePayload,
  type AnnotationNotePayload,
  type BookmarkCreatePayload,
  type HighlightCreatePayload,
  type QueuedEntry,
} from "@/lib/offline/outbox";

/** Note length cap, in characters (`char_length`), 1–500 when present (§4.1). */
export const ANNOTATION_NOTE_MAX = 500;

/** Client-side cap on a `range` quote, in characters (§4.1). The database has no cap. */
export const ANNOTATION_QUOTE_MAX = 5000;

function resolveClient(client?: SupabaseClient): SupabaseClient {
  if (client) return client;
  throw new Error(
    "annotations helpers require an explicit Supabase client (browser client " +
      "in the reader, `await createClient()` from @/lib/supabase/server on the server).",
  );
}

/** Length in characters, counted the way Postgres `char_length` counts them (code points). */
function charLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Throws unless `note` is null or 1–500 characters. A note is never empty:
 * clearing a note is `null`, not `""`.
 */
export function validateAnnotationNote(note: string | null): void {
  if (note === null) return;
  const length = charLength(note);
  if (length < 1 || length > ANNOTATION_NOTE_MAX) {
    throw new RangeError(
      `annotation note must be 1–${ANNOTATION_NOTE_MAX} characters (got ${length})`,
    );
  }
}

/**
 * Throws unless the kind and quote agree: a `range` needs a non-empty quote of at
 * most 5000 characters, and a `page` carries no quote.
 */
export function validateAnnotationQuote(kind: AnnotationKind, quote: string | null | undefined): void {
  if (kind === "page") {
    if (quote !== null && quote !== undefined) {
      throw new RangeError("a page annotation carries no quote");
    }
    return;
  }
  if (typeof quote !== "string" || quote.length === 0) {
    throw new RangeError("a range annotation needs a quote");
  }
  const length = charLength(quote);
  if (length > ANNOTATION_QUOTE_MAX) {
    throw new RangeError(
      `annotation quote must be at most ${ANNOTATION_QUOTE_MAX} characters (got ${length})`,
    );
  }
}

/** Every annotation for `bookId`, oldest first. RLS scopes the rows to the caller. */
export async function listAnnotations(
  bookId: string,
  client?: SupabaseClient,
): Promise<Annotation[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .eq("book_id", bookId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Annotation[] | null) ?? [];
}

/** Fields the caller supplies when creating an annotation. */
export interface CreateAnnotationInput {
  /**
   * Client-supplied id, so an outbox entry keeps the same id on replay (§3).
   * Omit it to let the database generate one.
   */
  id?: string;
  /** Owner. The insert must name the signed-in user (RLS `user_id = auth.uid()`). */
  userId: string;
  bookId: string;
  kind: AnnotationKind;
  /** epub.js CFI: the page start for `page`, the range for `range`. */
  cfi: string;
  /** Selected text. Required for `range`, must be absent for `page`. */
  quote?: string | null;
  /** 1–500 characters, or null / omitted for none. */
  note?: string | null;
  /** Chapter title at creation. Null when unknown. */
  label?: string | null;
  /** 0–1 progress at creation. Null when unknown. */
  percent?: number | null;
}

/** Insert an annotation and return the stored row. Validates before the round trip. */
export async function createAnnotation(
  input: CreateAnnotationInput,
  client?: SupabaseClient,
): Promise<Annotation> {
  const quote = input.quote ?? null;
  const note = input.note ?? null;
  validateAnnotationQuote(input.kind, quote);
  validateAnnotationNote(note);

  const supabase = resolveClient(client);
  const row = {
    ...(input.id !== undefined ? { id: input.id } : {}),
    user_id: input.userId,
    book_id: input.bookId,
    kind: input.kind,
    cfi: input.cfi,
    quote,
    note,
    label: input.label ?? null,
    percent: input.percent ?? null,
  };
  const { data, error } = await supabase
    .from("annotations")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as Annotation;
}

/**
 * Set (or clear, with `null`) the note on one annotation. The database trigger
 * stamps `updated_at` and copies the note to a shared group copy (0012).
 */
export async function updateAnnotationNote(
  id: string,
  note: string | null,
  client?: SupabaseClient,
): Promise<void> {
  validateAnnotationNote(note);
  const supabase = resolveClient(client);
  const { error } = await supabase
    .from("annotations")
    .update({ note })
    .eq("id", id);
  if (error) throw error;
}

/** Delete one annotation. Its shared group copy is removed by the cascade (0012). */
export async function deleteAnnotation(id: string, client?: SupabaseClient): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase.from("annotations").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Offline cache (N1e). The signed-in user's own annotations, per book, in a
// separate IndexedDB database. Group items are never cached: this table holds
// personal rows only, and `writeCachedAnnotations` drops any other owner's row.
//
// The cache holds server rows only. Queued offline edits are applied at read
// time (`applyPendingEdits`), so the cache never holds a half-replayed state.
// ---------------------------------------------------------------------------

const CACHE_DB_NAME = "leaf-annotations";
const CACHE_DB_VERSION = 1;
const CACHE_STORE = "books";

interface CachedBook {
  key: string;
  userId: string;
  bookId: string;
  rows: Annotation[];
  cachedAt: number;
}

function cacheKey(userId: string, bookId: string): string {
  return `${userId}:${bookId}`;
}

function currentIdbFactory(): IDBFactory | undefined {
  try {
    return typeof indexedDB === "undefined" ? undefined : indexedDB;
  } catch {
    return undefined;
  }
}

// One connection per IDBFactory, memoised like `outbox.ts` `getDb`. A failed
// open is never memoised, so storage that becomes available later is used.
let cacheDbPromise: Promise<IDBDatabase | undefined> | undefined;
let cacheDbFactory: IDBFactory | undefined;

function getCacheDb(): Promise<IDBDatabase | undefined> {
  const factory = currentIdbFactory();
  if (!factory) return Promise.resolve(undefined);
  if (cacheDbPromise && cacheDbFactory === factory) return cacheDbPromise;

  cacheDbFactory = factory;
  const pending: Promise<IDBDatabase | undefined> = new Promise((resolve) => {
    try {
      const req = factory.open(CACHE_DB_NAME, CACHE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          if (cacheDbPromise === pending) cacheDbPromise = undefined;
        };
        resolve(db);
      };
      req.onerror = () => resolve(undefined);
      req.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  cacheDbPromise = pending;
  void pending.then((db) => {
    if (!db && cacheDbPromise === pending) cacheDbPromise = undefined;
  });
  return pending;
}

/** The cached rows for one user's book, or `[]` when nothing is cached. Never throws. */
export async function readCachedAnnotations(userId: string, bookId: string): Promise<Annotation[]> {
  try {
    const db = await getCacheDb();
    if (!db) return [];
    const row = await new Promise<CachedBook | undefined>((resolve) => {
      try {
        const req = db
          .transaction(CACHE_STORE, "readonly")
          .objectStore(CACHE_STORE)
          .get(cacheKey(userId, bookId));
        req.onsuccess = () => resolve(req.result as CachedBook | undefined);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    return row?.rows ?? [];
  } catch {
    return [];
  }
}

/**
 * Replace the cached rows for one user's book with `rows`. Only rows owned by
 * `userId` and in `bookId` are kept, so nothing that is not the user's own
 * personal annotation is ever written. Never throws.
 */
export async function writeCachedAnnotations(
  userId: string,
  bookId: string,
  rows: Annotation[],
): Promise<void> {
  try {
    const db = await getCacheDb();
    if (!db) return;
    const kept = rows.filter((r) => r.user_id === userId && r.book_id === bookId);
    const record: CachedBook = {
      key: cacheKey(userId, bookId),
      userId,
      bookId,
      rows: kept,
      cachedAt: Date.now(),
    };
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(CACHE_STORE, "readwrite");
        tx.objectStore(CACHE_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Degrade silently: a missing cache only means an empty offline list.
  }
}

/**
 * Drop every cached annotation on this device. Called from `purgeOutbox`, which
 * sign-out and account deletion already run (`purge.ts`). Never throws.
 */
export async function purgeAnnotationCache(): Promise<void> {
  try {
    const db = await getCacheDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(CACHE_STORE, "readwrite");
          tx.objectStore(CACHE_STORE).clear();
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
    // Best-effort, as in outbox.ts.
  }
  cacheDbPromise = undefined;
  cacheDbFactory = undefined;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function rowFromCreate(p: AnnotationCreatePayload, ts: number): Annotation {
  const at = new Date(ts).toISOString();
  return {
    id: p.id,
    user_id: p.userId,
    book_id: p.bookId,
    kind: p.kind,
    cfi: p.cfi,
    quote: p.quote,
    note: p.note,
    label: p.label,
    percent: p.percent,
    created_at: at,
    updated_at: at,
  };
}

/** A legacy bookmark/highlight create, shaped as the annotation it replays into. */
function rowFromLegacyCreate(e: QueuedEntry): Annotation | undefined {
  const at = new Date(e.ts).toISOString();
  if (e.kind === "bookmark-create") {
    const p = e.payload as BookmarkCreatePayload;
    return {
      id: p.localId,
      user_id: p.userId,
      book_id: p.bookId,
      kind: "page",
      cfi: p.cfi,
      quote: null,
      note: null,
      label: p.label,
      percent: p.percent,
      created_at: at,
      updated_at: at,
    };
  }
  if (e.kind === "highlight-create") {
    const p = e.payload as HighlightCreatePayload;
    return {
      id: p.localId,
      user_id: p.userId,
      book_id: p.bookId,
      kind: "range",
      cfi: p.cfiRange,
      quote: p.text,
      note: null,
      label: null,
      percent: null,
      created_at: at,
      updated_at: at,
    };
  }
  return undefined;
}

/**
 * Apply queued edits to a list of rows, oldest first. Only this book's creates
 * are added. Notes and deletes match by id and are no-ops for unknown ids.
 * Legacy kinds are applied as their replay shims would apply them.
 */
function applyPendingEdits(
  rows: Annotation[],
  entries: QueuedEntry[],
  bookId: string,
): Annotation[] {
  const byId = new Map<string, Annotation>(rows.map((r) => [r.id, r]));
  for (const e of entries) {
    const at = new Date(e.ts).toISOString();
    switch (e.kind) {
      case "annotation-create": {
        const p = e.payload as AnnotationCreatePayload;
        if (p.bookId === bookId) byId.set(p.id, rowFromCreate(p, e.ts));
        break;
      }
      case "bookmark-create":
      case "highlight-create": {
        const row = rowFromLegacyCreate(e);
        if (row && row.book_id === bookId) byId.set(row.id, row);
        break;
      }
      case "annotation-note":
      case "highlight-note": {
        const p = e.payload as AnnotationNotePayload;
        const row = byId.get(p.id);
        if (row) byId.set(p.id, { ...row, note: p.note, updated_at: at });
        break;
      }
      case "annotation-delete":
      case "bookmark-delete":
      case "highlight-delete":
        byId.delete((e.payload as AnnotationDeletePayload).id);
        break;
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );
}

/**
 * The user's annotations for one book, with queued offline edits applied.
 *
 * Online: the server list, which refreshes the cache. Offline, or on a network
 * failure (`classifyWriteFailure` = "transport"): the cached list. Any other
 * error is thrown, not hidden by the cache.
 */
export async function listAnnotationsWithCache(
  userId: string,
  bookId: string,
  client?: SupabaseClient,
): Promise<Annotation[]> {
  const supabase = resolveClient(client);
  let rows: Annotation[];
  if (isOffline()) {
    rows = await readCachedAnnotations(userId, bookId);
  } else {
    try {
      rows = await listAnnotations(bookId, supabase);
      await writeCachedAnnotations(userId, bookId, rows);
    } catch (err) {
      if (classifyWriteFailure(err) !== "transport") throw err;
      rows = await readCachedAnnotations(userId, bookId);
    }
  }
  const pending = await pendingAnnotationEntries(userId);
  return applyPendingEdits(rows, pending, bookId);
}
