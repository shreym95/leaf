// Cached epub.js locations (DEFECTS.md D7). LOGIC ONLY — no design/component
// imports.
//
// `book.locations.generate(n)` walks every section of the book to build the
// CFI table that `percentageFromCfi` needs. On a full-length EPUB that takes
// seconds, and until it finishes the reader honestly reports 0% — which reads
// as "the progress bar is broken" (D7). The table is deterministic for a given
// book + `chars` granularity, so it only has to be built once per device.
//
// Storage is `localStorage`, deliberately:
//   - it is synchronous, so a cache hit is ready before the first `relocated`
//     event rather than a tick later;
//   - a book's bytes never change after upload (a re-upload mints a new row and
//     a new `bookId`), so the id alone is a sound cache key;
//   - it needs no migration and no server round-trip.
// Phase 3 moves book bytes into IndexedDB (`docs/REVISED_PLAN.md` §5); the
// locations table belongs beside them when that lands, and this module is the
// only thing that has to change.
//
// Everything here is best-effort. A miss, a quota error, a browser with storage
// disabled, or a corrupt entry must all degrade to "generate it again", never
// to a broken reader.

/** Bumped when the stored shape changes, which orphans every older entry. */
const SCHEMA = 1;
const PREFIX = `leaf:locations:v${SCHEMA}:`;

function keyFor(bookId: string, chars: number): string {
  return `${PREFIX}${bookId}:${chars}`;
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

/**
 * The locations JSON for this book, or `undefined` on any kind of miss.
 * The value is handed straight to `book.locations.load()`, which parses it.
 */
export function readCachedLocations(
  bookId: string,
  chars: number,
): string | undefined {
  if (!bookId) return undefined;
  const store = storage();
  if (!store) return undefined;
  try {
    const raw = store.getItem(keyFor(bookId, chars));
    // A truncated or empty entry would make `load()` throw and leave
    // `locations.total` at -1, which is worse than no cache at all.
    if (!raw || !raw.startsWith("[") || !raw.endsWith("]")) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

/** Store the locations JSON. Silent on failure — this is a nicety, not state. */
export function writeCachedLocations(
  bookId: string,
  chars: number,
  json: string,
): void {
  if (!bookId || !json) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(keyFor(bookId, chars), json);
  } catch {
    // Almost always a quota error: these entries are tens of kilobytes and a
    // reader accumulates one per book. Drop every other book's table and try
    // once more, so the book actually open right now is the one that stays
    // cached. If that still fails, give up quietly.
    try {
      for (const k of Object.keys(store)) {
        if (k.startsWith(PREFIX)) store.removeItem(k);
      }
      store.setItem(keyFor(bookId, chars), json);
    } catch {
      // Storage is unusable. Locations will be regenerated next open.
    }
  }
}
