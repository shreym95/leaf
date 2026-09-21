import type { Metadata } from "next";
import { OfflineShelf } from "@/components/offline-ui";

/**
 * /offline — the way back in when Leaf has no network (Stage 4 offline
 * reading, part 1).
 *
 * `src/app/manifest.ts` sets `start_url: "/library"`, so an installed PWA
 * opened with no connection lands there first. `/library` is authenticated,
 * per-user, `force-dynamic` content (`src/app/(chrome)/library/page.tsx`)
 * that must NEVER be cached: caching it would risk leaving one person's
 * shelf — or stale auth state — on a shared device for the next person. So
 * rather than cache `/library` itself, the service worker
 * (`src/lib/offline/service-worker.ts`) falls back to this route on a
 * network failure, and this route is built to need nothing `/library` needs:
 *
 *   - no `requireUser` / `getUser`, no cookies, no Supabase call of any kind
 *     — nothing here can read a session even if it wanted to;
 *   - the book list comes entirely from the client (`OfflineShelf`), which
 *     reads `listCachedBooks()` — IndexedDB data that already lives on this
 *     device, no server round trip involved.
 *
 * That makes this a plain static Server Component: it reads no dynamic API
 * (no `cookies()`, `headers()`, `searchParams`, nothing marked
 * `force-dynamic`), so Next prerenders it once at build time — verified with
 * `next build`'s route list, which marks it `○ (Static)` rather than `ƒ
 * (Dynamic)` — and the service worker can precache and later serve that
 * exact HTML with no session, no server, and no user in the loop at all.
 */

export const metadata: Metadata = {
  title: "Offline — Leaf",
  description: "The books available on this device without a connection.",
};

export default function OfflinePage() {
  return (
    <main
      aria-label="Available offline"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10 sm:py-14"
    >
      <header className="flex flex-col gap-2">
        <p className="font-mono font-medium uppercase text-accent [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-eyebrow)]">
          Available offline
        </p>
        <h1 className="font-display text-ink [font-size:var(--leaf-text-2xl)]">
          What&rsquo;s on this device
        </h1>
        {/* Honest about what this is (brief, part 1): these are the books
            already opened here, not the library. */}
        <p className="font-ui text-ink-mid [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-body)]">
          These are the books you&rsquo;ve already opened on this device —
          they work with no connection. Your full library needs one.
        </p>
      </header>

      <OfflineShelf />
    </main>
  );
}
