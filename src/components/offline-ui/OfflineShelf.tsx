"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/primitives";
import { useIsOffline } from "@/components/ui/useOnlineStatus";
import {
  listCachedBooks,
  type CachedBookSummary,
} from "@/lib/offline/book-store";
import { enforceOfflineOwner, getLocalSessionUserId } from "@/lib/offline/owner";

/**
 * OfflineShelf — the `/offline` route's only content (Stage 4 offline
 * reading, part 1). The server component at `src/app/offline/page.tsx` is
 * intentionally static and knows nothing about what's cached; this is where
 * that data actually gets read — client-side, straight out of IndexedDB, on
 * this exact device, no server round trip at all.
 *
 * `/offline` has no server-side auth check by design (see that page's
 * header), which is exactly why this component cannot just read and list:
 * with no gate, a device that changed hands without an explicit sign-out
 * would show the PREVIOUS user's cached books to whoever opens it next,
 * offline, with no authentication at any step. So before this ever reads
 * `listCachedBooks()`, it:
 *
 *   1. calls `enforceOfflineOwner()` itself, awaited — the root layout
 *      (`src/app/layout.tsx`) already runs this once at boot, but React fires
 *      a *deeper* component's own mount effect before an ancestor layout's,
 *      so relying on that alone would leave a window where this shelf's own
 *      read could land before the boot purge finishes. Calling it again here
 *      is idempotent (see its own header) and closes that race outright
 *      rather than hoping the timing works out.
 *   2. checks whether a local session exists at all. `enforceOfflineOwner`
 *      already purges when it doesn't — after that, `listCachedBooks()` would
 *      correctly return nothing — but a bare empty shelf reads as "you have no
 *      offline books," which isn't the honest reason. A visitor with no
 *      session gets told to sign in instead.
 *
 * Four states, never a blank page: briefly loading (this check plus the
 * IndexedDB read are both async), signed-out, a shelf of cached books, or an
 * honest explanation that nothing is cached yet.
 *
 * ---------------------------------------------------------------------------
 * The way out (offline-polish defect 3)
 * ---------------------------------------------------------------------------
 * `/offline` used to be a dead end: no nav, no header, nothing on the page
 * links anywhere but a cached book's own reader route. Reached via the
 * service worker's redirect from any failed navigation, a reader whose
 * connection has since returned had no way off this page short of editing
 * the URL bar by hand.
 *
 * Signed IN (`state.phase === "ready"`): the cached-book list above already
 * IS the way out — every entry links to `/reader/<id>`, and those work with
 * no network. `GoToLibrary` adds a link to `/library` once online (nothing to
 * offer offline beyond the books already listed: `/library` itself would
 * just redirect right back here).
 *
 * Signed OUT (`state.phase === "signed-out"`): signing in is the ONLY way off
 * this page, so — per the founder's brief — the control for it is ALWAYS
 * visible, online or off, never hidden. `SignInControl` renders:
 *   - ONLINE: a real `<Link href="/login">`.
 *   - OFFLINE: the same-looking control, but disabled and non-navigating,
 *     with a one-line honest reason ("Sign in needs a connection."). A live
 *     `<Link>` here would be dishonest either way it failed: as a soft
 *     (RSC) navigation it just throws in the browser console, and as a hard
 *     navigation it would round-trip through the service worker's own
 *     redirect and land right back on THIS page — see the module comment
 *     above. Rendering it disabled instead of omitting it is the point: the
 *     reader always sees where they're headed, they just can't get there yet.
 *
 * `useIsOffline` (extracted from `OfflineIndicator`, which had the identical
 * `navigator.onLine` / `useSyncExternalStore` need) makes both of the above
 * reactive: a reader sitting on this exact page when the network returns
 * sees the real link appear (and `SignInControl` become clickable) with no
 * refresh, because the connectivity read is live, not a one-time check
 * alongside the session check above.
 */

type State =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "ready"; books: CachedBookSummary[] };

/** `UNREAD` / `NN% READ` / `FINISHED` — mirrors the shelf's own convention
 *  (`src/components/library-ui/BookCard.tsx`) so the offline shelf reads as
 *  the same app, not a stripped-down fallback. */
function progressLabel(percent: number | undefined): string {
  if (percent == null) return "Unread";
  const pct = Math.min(100, Math.max(0, Math.round(percent * 100)));
  if (pct <= 0) return "Unread";
  if (pct >= 100) return "Finished";
  return `${pct}% read`;
}

/**
 * The way out for a SIGNED-IN reader — see the module header. Only ever
 * rendered while online (the caller decides that): offline, the cached-book
 * list above is already the way out, and `/library` itself would just
 * redirect straight back here.
 */
function GoToLibrary() {
  return (
    <Button asChild variant="primary" className="self-start">
      <Link href="/library">Go to your library</Link>
    </Button>
  );
}

/** Offline counterpart to `GoToLibrary`: plain text, no link — a link that
 *  just fails when tapped is worse than none (see the module header). */
function NeedsConnectionNote() {
  return (
    <p className="font-ui text-faint [font-size:var(--leaf-text-xs)]">
      Everything else here needs a connection.
    </p>
  );
}

/**
 * The way out for a SIGNED-OUT reader — see the module header's "signed out"
 * section. Unlike `GoToLibrary`, this is ALWAYS rendered, online or off:
 * signing in is the only way off this page for a signed-out visitor, so it
 * must never disappear. Offline it renders disabled with a short, honest
 * reason instead of a link that would just bounce back to this same page.
 */
function SignInControl({ offline }: { offline: boolean }) {
  if (offline) {
    return (
      <div className="flex flex-col items-start gap-[var(--leaf-space-2)]">
        <Button variant="primary" className="self-start" disabled>
          Sign in
        </Button>
        <p className="font-ui text-faint [font-size:var(--leaf-text-xs)]">
          Sign in needs a connection.
        </p>
      </div>
    );
  }
  return (
    <Button asChild variant="primary" className="self-start">
      <Link href="/login">Sign in</Link>
    </Button>
  );
}

export function OfflineShelf() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const offline = useIsOffline();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Idempotent — see the header above for why this shelf can't just
      // trust that the root layout's own boot-time call already finished.
      await enforceOfflineOwner();
      const userId = await getLocalSessionUserId();
      if (cancelled) return;

      if (!userId) {
        setState({ phase: "signed-out" });
        return;
      }

      const books = await listCachedBooks();
      if (!cancelled) setState({ phase: "ready", books });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") {
    // IndexedDB reads are fast; this exists so a slow device shows something
    // rather than a blank beat, not because it's expected to linger.
    return (
      <p
        aria-hidden
        className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]"
      >
        Checking this device…
      </p>
    );
  }

  if (state.phase === "signed-out") {
    return (
      <div className="flex flex-col items-start gap-[var(--leaf-space-4)]">
        <p className="font-ui text-ink-mid [font-size:var(--leaf-text-base)] [line-height:var(--leaf-leading-body)]">
          Sign in to see the books saved on this device.
        </p>
        <SignInControl offline={offline} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-[var(--leaf-space-5)]">
      {state.books.length === 0 ? (
        <p className="font-ui text-ink-mid [font-size:var(--leaf-text-base)] [line-height:var(--leaf-leading-body)]">
          Nothing is saved on this device yet. Open a book while you have a
          connection, and it will show up here — ready to read with none.
        </p>
      ) : (
        <ul className="flex w-full flex-col gap-[var(--leaf-space-3)]">
          {state.books.map((book) => (
            <li key={book.bookId}>
              <Link
                href={`/reader/${book.bookId}`}
                className="group flex items-center gap-[var(--leaf-space-4)] rounded-sm border border-rule-soft px-[var(--leaf-space-4)] py-[var(--leaf-space-3)] transition-colors [transition-duration:var(--leaf-dur-ui)] hover:bg-edge focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
              >
                {/* No cover art: a signed Storage URL needs a connection this
                    page is built to work without. An initial stands in, same
                    fallback BookCard already uses for a book with no cover. */}
                <span
                  aria-hidden
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-sm border border-rule-soft bg-page font-display text-faint [font-size:var(--leaf-text-lg)]"
                >
                  {book.title.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <span className="flex min-w-0 flex-col gap-[var(--leaf-space-1)]">
                  <span className="truncate font-display text-ink [font-size:var(--leaf-text-base)]">
                    {book.title}
                  </span>
                  <span className="truncate font-ui text-ink-mid [font-size:var(--leaf-text-xs)]">
                    {book.author}
                  </span>
                  <span className="font-mono uppercase text-faint [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)]">
                    {progressLabel(book.percent)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {offline ? <NeedsConnectionNote /> : <GoToLibrary />}
    </div>
  );
}
