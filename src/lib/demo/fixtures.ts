// In-memory fixtures for demo mode (see `./flag.ts`). Plain data — no Supabase,
// no network, nothing user-specific. Lives in the logic layer and imports no
// design/component code (ESLint seam).
//
// Three of the books are the public-domain EPUBs already bundled in
// `public/bundled/`, wired so they actually open and paginate. The rest are
// metadata-only shelf entries — varied cover ratios, title lengths, progress
// values and sources — so the shelf design can be judged at a realistic length.
// A metadata-only book has no `storage_path`; opening it 404s (acceptable), it
// never crashes.

import type { User } from "@supabase/supabase-js";
import type { Book, BookSource } from "@/lib/types";
import type { LibraryBook } from "@/lib/db/books";

export const DEMO_USER_ID = "demo-designer";

/** The fixed "signed-in" user in demo mode. Shape trimmed to what the app reads
 *  (`id`, `email`, `user_metadata.full_name` / `.name`). */
export const DEMO_USER = {
  id: DEMO_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "designer@leaf.local",
  app_metadata: { provider: "demo", providers: ["demo"] },
  user_metadata: { full_name: "Design Preview", name: "Design Preview" },
  created_at: "2026-01-01T00:00:00.000Z",
} as unknown as User;

interface DemoSpec {
  id: string;
  title: string;
  author: string;
  source: BookSource;
  /** Filename in `public/bundled/` — set only for the books that actually open. */
  file?: string;
  /** Filename under `public/demo/covers/` — omit for the title-initial fallback. */
  cover?: string;
  /** 0–1, or omitted for "never opened". */
  percent?: number;
  /** Days before the fixed "now" the book was last read — omit if never opened. */
  lastReadDaysAgo?: number;
  /** Hidden from the shelf (the `?hidden=1` view). */
  archived?: boolean;
}

const SPECS: DemoSpec[] = [
  // ── The three that open ───────────────────────────────────────────────
  { id: "frankenstein", title: "Frankenstein", author: "Mary Shelley", source: "standardebooks", file: "frankenstein.epub", cover: "frankenstein.jpg", percent: 0.34, lastReadDaysAgo: 1 },
  { id: "wizard-of-oz", title: "The Wonderful Wizard of Oz", author: "L. Frank Baum", source: "standardebooks", file: "wizard-of-oz.epub", cover: "wizard-of-oz.jpg", percent: 0.08, lastReadDaysAgo: 4 },
  { id: "time-machine", title: "The Time Machine", author: "H. G. Wells", source: "standardebooks", file: "time-machine.epub", cover: "time-machine.jpg", percent: 1, lastReadDaysAgo: 18 },

  // ── A fourth that opens: the chapter-head-from-TOC shape ────────────
  // Synthetic, licence-clean fixture (public-domain Frankenstein prose)
  // reproducing a real founder book's shape: every chapter's <h1> is only an
  // <img> (the chapter number as a JPEG), so the normalizer finds no text and
  // falls back to "§" — the real numbering lives only in the EPUB's own TOC,
  // as bare numbers ("1", "2", "3"). Covers `content-hook.ts`'s TOC-fallback
  // path end-to-end in the actual reader, not just in a unit test.
  { id: "chapter-image-heading", title: "Frankenstein (Chapter-Image Fixture)", author: "Mary Shelley", source: "gutenberg", file: "chapter-image-heading.epub", percent: 0, lastReadDaysAgo: 30 },

  // ── Metadata-only, with a cover ─────────────────────────────────────
  { id: "middlemarch", title: "Middlemarch", author: "George Eliot", source: "standardebooks", cover: "middlemarch.png", percent: 0.61, lastReadDaysAgo: 2 },
  { id: "dubliners", title: "Dubliners", author: "James Joyce", source: "standardebooks", cover: "dubliners.png", percent: 0.88, lastReadDaysAgo: 9 },
  { id: "leaves-of-grass", title: "Leaves of Grass", author: "Walt Whitman", source: "gutenberg", cover: "leaves-of-grass.png", percent: 0.47, lastReadDaysAgo: 13 },
  { id: "walden", title: "Walden", author: "Henry David Thoreau", source: "standardebooks", cover: "walden.png", percent: 0.12, lastReadDaysAgo: 27 },
  { id: "souls-of-black-folk", title: "The Souls of Black Folk", author: "W. E. B. Du Bois", source: "gutenberg", cover: "the-souls-of-black-folk.png", percent: 0.22, lastReadDaysAgo: 41 },
  { id: "pride-and-prejudice", title: "Pride and Prejudice", author: "Jane Austen", source: "standardebooks", cover: "pride-and-prejudice.png", percent: 0.03, lastReadDaysAgo: 55 },
  { id: "the-odyssey", title: "The Odyssey", author: "Homer", source: "gutenberg", cover: "the-odyssey.png" },
  { id: "meditations", title: "Meditations", author: "Marcus Aurelius", source: "standardebooks", cover: "meditations.png" },
  { id: "dorian-gray", title: "The Picture of Dorian Gray", author: "Oscar Wilde", source: "standardebooks", cover: "the-picture-of-dorian-gray.png" },
  { id: "a-room-with-a-view", title: "A Room with a View", author: "E. M. Forster", source: "gutenberg", cover: "a-room-with-a-view.png" },

  // ── Metadata-only, no cover — the title-initial fallback ────────────
  { id: "crime-and-punishment", title: "Crime and Punishment", author: "Fyodor Dostoevsky", source: "gutenberg", percent: 0.05, lastReadDaysAgo: 6 },
  { id: "the-count-of-monte-cristo", title: "The Count of Monte Cristo", author: "Alexandre Dumas", source: "upload" },
  { id: "brothers-karamazov", title: "The Brothers Karamazov", author: "Fyodor Dostoevsky", source: "upload" },
  { id: "ulysses", title: "Ulysses", author: "James Joyce", source: "upload", archived: true },
  { id: "war-and-peace", title: "War and Peace", author: "Leo Tolstoy", source: "gutenberg", percent: 0.01, lastReadDaysAgo: 63, archived: true },
];

const DAY_MS = 86_400_000;
// A fixed "now" so fixtures are deterministic across renders and test runs.
const NOW = Date.parse("2026-09-07T12:00:00.000Z");

function toLibraryBook(spec: DemoSpec, index: number): LibraryBook {
  const lastReadAt =
    spec.lastReadDaysAgo === undefined
      ? null
      : new Date(NOW - spec.lastReadDaysAgo * DAY_MS).toISOString();
  // Never-opened books fall back to newest-added first — space them a day apart.
  const addedAt = new Date(NOW - (index + 1) * DAY_MS).toISOString();
  const book: Book = {
    id: spec.id,
    user_id: DEMO_USER_ID,
    title: spec.title,
    author: spec.author,
    source: spec.source,
    source_ref: null,
    storage_path: spec.file ? `bundled/${spec.file}` : null,
    cover_path: spec.cover ? `demo/covers/${spec.cover}` : null,
    cover_url: null,
    archived_at: spec.archived ? new Date(NOW - 90 * DAY_MS).toISOString() : null,
    status: spec.percent != null && spec.percent >= 1 ? "finished" : "reading",
    added_at: addedAt,
  };
  return {
    ...book,
    percent: spec.percent ?? null,
    lastReadAt,
    coverUrl: spec.cover ? `/demo/covers/${spec.cover}` : null,
  };
}

const ALL_BOOKS: LibraryBook[] = SPECS.map(toLibraryBook);

/** Same ordering rule as the real `listBooks` (last-read, then started, then
 *  newest-added), filtered by archived state. */
export function demoListBooks({
  archived = false,
}: { archived?: boolean } = {}): LibraryBook[] {
  return ALL_BOOKS.filter((b) =>
    archived ? b.archived_at != null : b.archived_at == null,
  ).sort((a, b) => {
    if (a.lastReadAt && b.lastReadAt) return b.lastReadAt.localeCompare(a.lastReadAt);
    if (a.lastReadAt) return -1;
    if (b.lastReadAt) return 1;
    return b.added_at.localeCompare(a.added_at);
  });
}

export function demoCountArchivedBooks(): number {
  return ALL_BOOKS.filter((b) => b.archived_at != null).length;
}

/** A single book by id (visible or hidden), or `null`. Returns the plain `Book`
 *  the reader route expects. */
export function demoGetBook(bookId: string): Book | null {
  const found = ALL_BOOKS.find((b) => b.id === bookId);
  if (!found) return null;
  const { percent: _p, lastReadAt: _l, coverUrl: _c, ...book } = found;
  return book;
}

/** Map a demo `storage_path` (`bundled/<file>`) to the static public URL the
 *  reader fetches. */
export function demoBookFileUrl(storagePath: string): string {
  return `/${storagePath.replace(/^\/+/, "")}`;
}
