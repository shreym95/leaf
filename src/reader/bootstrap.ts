// Reader bootstrap — LOGIC ONLY (SPEC §3.1, §4). Style-agnostic: no imports
// from `src/design` or `src/components` (enforced by the ESLint seam rule).
//
// This is the deliberately thin M2 smoke test that a stored EPUB opens and
// paginates with epub.js. It is NOT the designed reader.
//
// M3: replaced by the designed reader (rendition.themes + normalizer + settings
// + CFI sync). Keep this minimal.

import type { Book, Rendition } from "epubjs";

export interface BookController {
  /** Mount the paginated rendition into `el` and display the first page. */
  renderTo(el: HTMLElement): Promise<void>;
  /** Advance one page (no-op before `renderTo`). */
  next(): Promise<void>;
  /** Go back one page (no-op before `renderTo`). */
  prev(): Promise<void>;
  /** Number of spine sections ("chapters"), or 0 if unknown. */
  chapterCount(): number;
  /** Tear down the rendition + book (call on unmount). */
  destroy(): void;
}

/**
 * Open `fileUrl` with epub.js and return a small controller.
 *
 * epub.js is browser-only (needs the DOM), so `epubjs` is pulled in with a
 * dynamic `import()` here rather than a static import — this module can be
 * evaluated during SSR without touching `window`. Callers still invoke
 * `openBook` from a client effect.
 */
export async function openBook(fileUrl: string): Promise<BookController> {
  const { default: ePub } = await import("epubjs");

  // Fetch the bytes ourselves rather than handing epub.js the URL: a Supabase
  // signed URL ends in `.epub?token=…`, which epub.js misreads as an *unpacked*
  // EPUB directory and then hangs. An ArrayBuffer is unambiguously an archive,
  // and a bad URL surfaces here as a real error instead of a silent hang.
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Couldn't download the book (HTTP ${res.status}).`);
  }
  const bytes = await res.arrayBuffer();

  const book: Book = ePub(bytes);
  await book.ready;

  let sectionCount = 0;
  try {
    const spine = await book.loaded.spine;
    // `spine` is an array-like of spine items.
    sectionCount = Array.isArray(spine)
      ? spine.length
      : ((spine as { length?: number })?.length ?? 0);
  } catch {
    sectionCount = 0;
  }

  let rendition: Rendition | undefined;

  return {
    async renderTo(el: HTMLElement) {
      rendition = book.renderTo(el, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "none",
      });
      await rendition.display();
    },
    async next() {
      await rendition?.next();
    },
    async prev() {
      await rendition?.prev();
    },
    chapterCount() {
      return sectionCount;
    },
    destroy() {
      rendition?.destroy();
      book.destroy();
    },
  };
}
