// Local reading-position cache (offline defect: reader reopens at page 0).
// LOGIC ONLY — no design/component imports.
//
// `restore()` in `position.ts` needs a position to fall back to when the
// server is unreachable. Offline, `supabase.auth.getUser()` and
// `getReadingState()` are both network calls that throw — and until now
// nothing durable existed on the device for `restore()` to fall back to, so
// every offline restore landed at CFI 0, silently discarding the reader's
// place.
//
// Storage is `localStorage`, deliberately — same reasoning as
// `locations-cache.ts` (read that file's header first): synchronous, so a
// value is available the instant `restore()` needs it rather than a tick
// later on an async IndexedDB read. `restore()` runs once at mount, so there
// is no repeated-`relocated`-event re-flash window to protect the way there
// is for the locations table, but the underlying trade is the same one that
// file already made and explained: this value is cheap and tiny (one CFI + a
// number + a timestamp), and asynchrony buys nothing here worth the risk of
// a slower store landing after the read that needed it.
//
// Scoped by `bookId` only, matching `locations-cache.ts`, and — also matching
// that file — NOT wired into `src/lib/offline/purge.ts`'s cross-user purge.
// A book's bytes are immutable per `bookId` (a re-upload mints a new row and
// id, per `src/lib/storage.ts`), so a stray entry left behind by a previous
// account on a shared device is orphaned under an id no other account's book
// will ever share, not a live cross-user read the way the book/outbox/reader
// caches would be.
//
// Everything here is best-effort: a miss, a blocked/unavailable storage, or a
// corrupt entry all degrade to "no local position", never to a throw.

/** Bumped when the stored shape changes, which orphans every older entry. */
const SCHEMA = 1;
const PREFIX = `leaf:position:v${SCHEMA}:`;

export interface CachedPosition {
  cfi: string;
  percent: number;
  /** ISO 8601. Compared against the server row via `isFurtherAlong`
   *  (`src/lib/offline/outbox.ts`, §8(b)) so neither a stale local entry nor
   *  a stale server row can drag a reader backwards on restore. */
  updatedAt: string;
}

function keyFor(bookId: string): string {
  return `${PREFIX}${bookId}`;
}

function storage(): Storage | undefined {
  try {
    // Absent during SSR and in a jsdom test without a storage shim; throws
    // outright in a browser configured to block site data.
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isCachedPosition(value: unknown): value is CachedPosition {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.cfi === "string" &&
    v.cfi.length > 0 &&
    typeof v.percent === "number" &&
    Number.isFinite(v.percent) &&
    typeof v.updatedAt === "string" &&
    v.updatedAt.length > 0
  );
}

/**
 * The cached position for `bookId`, or `undefined` on any kind of miss
 * (nothing stored, storage unavailable, or a corrupt/outdated-shape entry).
 */
export function readCachedPosition(bookId: string): CachedPosition | undefined {
  if (!bookId) return undefined;
  const store = storage();
  if (!store) return undefined;
  try {
    const raw = store.getItem(keyFor(bookId));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isCachedPosition(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Store the position. Silent on failure — this is a nicety, not state. */
export function writeCachedPosition(
  bookId: string,
  position: CachedPosition,
): void {
  if (!bookId || !position.cfi) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(keyFor(bookId), JSON.stringify(position));
  } catch {
    // Almost always a quota error. Unlike locations-cache.ts's tables (tens
    // of kilobytes each), this entry is a handful of bytes and unique per
    // book, so there is nothing worth evicting to make room — give up
    // quietly, same as any other best-effort write here.
  }
}
