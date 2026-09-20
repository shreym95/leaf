// Cached book bytes (Stage 2 of offline reading). LOGIC ONLY — no design/component
// imports.
//
// A book opened once should reopen instantly and work with no network. EPUBs run
// 0.5–5MB, well past what `localStorage` can hold (it caps around 5MB total, and
// `src/reader/locations-cache.ts` already lives there for its small JSON table).
// So book bytes live in IndexedDB instead, in their own database — see that
// file's header for why the two caches stay separate rather than merging.
//
// Storage is IndexedDB, deliberately:
//   - it comfortably holds tens of megabytes per origin, unlike localStorage;
//   - a book's bytes never change after upload (a re-upload mints a new row and
//     a new `bookId`, see `src/lib/books/ingest.ts`), so the id alone is a sound
//     cache key and a hit is always correct by construction;
//   - native versioning (`onupgradeneeded`) handles schema changes without a
//     hand-rolled key-prefix scheme.
//
// Everything here is best-effort. A miss, a browser with storage disabled or
// blocked (private browsing), a thrown `indexedDB.open`, or eviction pressure
// must all degrade to "fetch it again over the network", never to a broken
// reader. This is a nicety, not state — nothing here is the source of truth for
// anything.

const DB_NAME = "leaf-books";
const DB_VERSION = 1;
const BOOKS_STORE = "books";
const META_STORE = "meta";
const META_KEY = "summary";

/** Fallback budget when `navigator.storage.estimate()` is unavailable or throws. */
const FALLBACK_BUDGET_BYTES = 100 * 1024 * 1024;
/** Hard ceiling regardless of how generous the quota estimate is. */
const MAX_BUDGET_BYTES = 300 * 1024 * 1024;

export interface CachedBookMeta {
  title: string;
  author: string;
  percent?: number;
}

export interface CachedBookSummary {
  bookId: string;
  title: string;
  author: string;
  percent?: number;
}

interface BookRecord {
  bookId: string;
  bytes: ArrayBuffer;
  byteLength: number;
  cachedAt: number;
  lastOpenedAt: number;
  title: string;
  author: string;
  percent?: number;
}

interface MetaRecord {
  totalBytes: number;
}

/**
 * Open (and, on first use, create) the database, or `undefined` on any kind of
 * failure. IndexedDB is absent during SSR and in a jsdom test without a shim,
 * and `indexedDB.open` can throw outright in a browser configured to block
 * site data (private browsing in some engines) — both degrade to "no cache".
 */
function openDb(): Promise<IDBDatabase | undefined> {
  try {
    if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  } catch {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BOOKS_STORE)) {
          const store = db.createObjectStore(BOOKS_STORE, {
            keyPath: "bookId",
          });
          store.createIndex("by-lastOpenedAt", "lastOpenedAt");
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
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
 * One connection, shared by every call. Opening per call leaked a handle each
 * time, and a live handle blocks a later `DB_VERSION` upgrade (`onblocked`) —
 * the very failure `openDb` already treats as "no cache". The cache is dropped
 * when the connection closes or another tab starts an upgrade, so the next
 * call re-opens cleanly. A failed open is never memoised: storage can become
 * available again (a tab leaving private browsing, a quota freed).
 */
let dbPromise: Promise<IDBDatabase | undefined> | undefined;
/**
 * The factory the cached handle was opened from. A handle is only valid for
 * its own `IDBFactory`, so if the global is ever replaced the cache is stale
 * and must be dropped rather than reused.
 */
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

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getMeta(db: IDBDatabase): Promise<MetaRecord> {
  const tx = db.transaction(META_STORE, "readonly");
  const value = await reqToPromise(tx.objectStore(META_STORE).get(META_KEY));
  return (value as MetaRecord | undefined) ?? { totalBytes: 0 };
}

/**
 * The device's cache budget: half the reported quota, capped at 300MB, or a
 * conservative 100MB flat when the estimate API is unavailable or throws.
 */
async function cacheBudget(): Promise<number> {
  try {
    if (
      typeof navigator === "undefined" ||
      !navigator.storage?.estimate
    ) {
      return FALLBACK_BUDGET_BYTES;
    }
    const { quota } = await navigator.storage.estimate();
    if (!quota) return FALLBACK_BUDGET_BYTES;
    return Math.min(MAX_BUDGET_BYTES, quota * 0.5);
  } catch {
    return FALLBACK_BUDGET_BYTES;
  }
}

/** Best-effort persistence request. Feature-detected, try/caught, result ignored. */
function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // Not available, or the browser refused — either way, carry on.
  }
}

/**
 * Evict least-recently-opened books (skipping `skipBookId`, the one currently
 * being written) until there is room for `needed` more bytes within `budget`.
 * `currentSize` is `skipBookId`'s own existing byte length (0 if it isn't
 * cached yet), backed out of the running total since those bytes are about to
 * be replaced, not added on top of.
 *
 * Returns `false` — without writing anything — if eviction alone can't make
 * room; the caller must then skip the write rather than blow the budget.
 */
async function evictToFit(
  db: IDBDatabase,
  needed: number,
  currentSize: number,
  budget: number,
  skipBookId: string,
): Promise<boolean> {
  let meta = await getMeta(db);

  while (meta.totalBytes - currentSize + needed > budget) {
    const evicted = await evictOldest(db, skipBookId);
    if (evicted == null) return false; // nothing left to evict — give up quietly
    meta = { totalBytes: Math.max(0, meta.totalBytes - evicted) };
    await writeMeta(db, meta);
  }
  return true;
}

/** Delete the single least-recently-opened book (other than `skipBookId`). Returns its byte length, or `undefined` if there was nothing to evict. */
async function evictOldest(
  db: IDBDatabase,
  skipBookId: string,
): Promise<number | undefined> {
  const tx = db.transaction(BOOKS_STORE, "readwrite");
  const index = tx.objectStore(BOOKS_STORE).index("by-lastOpenedAt");

  return new Promise((resolve, reject) => {
    const cursorReq = index.openCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve(undefined);
        return;
      }
      const record = cursor.value as BookRecord;
      if (record.bookId === skipBookId) {
        cursor.continue();
        return;
      }
      const deleteReq = cursor.delete();
      deleteReq.onsuccess = () => resolve(record.byteLength);
      deleteReq.onerror = () => reject(deleteReq.error);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** The currently-cached byte length for `bookId`, or 0 if it isn't cached. */
async function getExistingByteLength(
  db: IDBDatabase,
  bookId: string,
): Promise<number> {
  const tx = db.transaction(BOOKS_STORE, "readonly");
  const record = (await reqToPromise(
    tx.objectStore(BOOKS_STORE).get(bookId),
  )) as BookRecord | undefined;
  return record?.byteLength ?? 0;
}

async function writeMeta(db: IDBDatabase, meta: MetaRecord): Promise<void> {
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put(meta, META_KEY);
  await txDone(tx);
}

/**
 * The cached bytes for a book, or `undefined` on any kind of miss (never
 * throws). Bumps `lastOpenedAt` as a best-effort side effect so eviction
 * order stays accurate — failure to do so is not reported to the caller.
 */
export async function readCachedBook(
  bookId: string,
): Promise<ArrayBuffer | undefined> {
  if (!bookId) return undefined;
  try {
    const db = await getDb();
    if (!db) return undefined;

    const tx = db.transaction(BOOKS_STORE, "readonly");
    const record = (await reqToPromise(
      tx.objectStore(BOOKS_STORE).get(bookId),
    )) as BookRecord | undefined;
    if (!record) return undefined;

    // Best-effort recency bump — never lets a failure here turn a hit into a
    // reported miss.
    try {
      const writeTx = db.transaction(BOOKS_STORE, "readwrite");
      writeTx.objectStore(BOOKS_STORE).put({
        ...record,
        lastOpenedAt: Date.now(),
      });
    } catch {
      // Recency tracking is a nicety; the read already succeeded.
    }

    // A fresh copy, not the stored buffer itself — the engine goes on to hand
    // this to a zip parser that may write into or transfer it, which must
    // never corrupt what stays cached for the next read.
    return record.bytes.slice(0);
  } catch {
    return undefined;
  }
}

/**
 * Cache a book's bytes, evicting older books if needed to stay within budget.
 * Fire-and-forget: failures are swallowed, never thrown, because the reader
 * already has the bytes in memory regardless of whether this succeeds.
 */
export async function writeCachedBook(
  bookId: string,
  bytes: ArrayBuffer,
  meta: CachedBookMeta,
): Promise<void> {
  if (!bookId) return;
  try {
    const db = await getDb();
    if (!db) return;

    const byteLength = bytes.byteLength;
    const budget = await cacheBudget();
    if (byteLength > budget) return; // too big to ever fit — skip entirely

    const existingSize = await getExistingByteLength(db, bookId);
    const madeRoom = await evictToFit(
      db,
      byteLength,
      existingSize,
      budget,
      bookId,
    );
    if (!madeRoom) return; // evicted everything evictable; still doesn't fit

    const now = Date.now();
    const record: BookRecord = {
      bookId,
      // A copy, not the caller's live buffer: ReaderShell hands the original
      // to the engine right after this call, and a zip parser writing into or
      // transferring that buffer must never reach back into what is cached.
      bytes: bytes.slice(0),
      byteLength,
      cachedAt: now,
      lastOpenedAt: now,
      title: meta.title,
      author: meta.author,
      percent: meta.percent,
    };

    // Get-then-put on both stores within a SINGLE transaction: nesting a
    // separate transaction inside an open one on the same store can deadlock
    // (the inner one queues behind the outer, which is awaiting the inner).
    const tx = db.transaction([BOOKS_STORE, META_STORE], "readwrite");
    const booksStore = tx.objectStore(BOOKS_STORE);
    const metaStore = tx.objectStore(META_STORE);

    const existing = (await reqToPromise(booksStore.get(bookId))) as
      | BookRecord
      | undefined;
    const currentMeta =
      ((await reqToPromise(metaStore.get(META_KEY))) as
        | MetaRecord
        | undefined) ?? { totalBytes: 0 };
    const delta = byteLength - (existing?.byteLength ?? 0);

    booksStore.put(record);
    metaStore.put(
      { totalBytes: Math.max(0, currentMeta.totalBytes + delta) },
      META_KEY,
    );
    await txDone(tx);

    requestPersistence();
  } catch {
    // Caching is a nicety; the reader already has the bytes in memory.
  }
}

/**
 * The metadata an offline shelf needs to render cached books, with no network.
 * Returns an empty list on any failure.
 */
export async function listCachedBooks(): Promise<CachedBookSummary[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    const tx = db.transaction(BOOKS_STORE, "readonly");
    const records = (await reqToPromise(
      tx.objectStore(BOOKS_STORE).getAll(),
    )) as BookRecord[];

    return records.map((r) => ({
      bookId: r.bookId,
      title: r.title,
      author: r.author,
      percent: r.percent,
    }));
  } catch {
    return [];
  }
}

/**
 * Empty the cache entirely. Called on sign-out: caching authenticated content
 * is a new exposure, and a second user on the same device must never reach the
 * first user's books.
 */
export async function purgeCachedBooks(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const tx = db.transaction([BOOKS_STORE, META_STORE], "readwrite");
    tx.objectStore(BOOKS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    await txDone(tx);
  } catch {
    // Nothing more we can do; the caller should not be blocked on this.
  }
}
