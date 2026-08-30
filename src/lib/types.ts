// Leaf DB row types — MUST match supabase/migrations/0001_init.sql exactly:
// snake_case columns, nullability, and the CHECK-constraint unions.
//
// Regenerate with: supabase gen types typescript --project-id <ref> > src/lib/types.ts
// (planned for M1 tail / M2, once the Supabase CLI is set up — see supabase/README.md).
// Until then this file is hand-maintained; edit it in lockstep with the migration.

export type ThemeName = "day" | "night";
export type BookSource = "standardebooks" | "gutenberg" | "upload";
export type BookStatus = "reading" | "finished";
export type FontFamily = "serif" | "sans" | "legible";
export type Margins = "narrow" | "normal" | "wide";

/** `public.profiles` — one row per auth user, keyed by `auth.users.id`. */
export interface Profile {
  id: string;
  display_name: string | null;
  default_theme: ThemeName;
  created_at: string;
}

/** `public.books` */
export interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string;
  source: BookSource;
  /** Catalog id / OPDS ref for imported books; null for uploads. */
  source_ref: string | null;
  /** Object key within the private `epubs` Storage bucket. */
  storage_path: string | null;
  /** Storage key for the cover extracted from the EPUB (0002); signed to render. */
  cover_path: string | null;
  cover_url: string | null;
  /** When the reader hid this from the shelf (0003). Null = visible. */
  archived_at: string | null;
  status: BookStatus;
  added_at: string;
}

/** `public.reading_state` — composite PK `(book_id, user_id)`. */
export interface ReadingState {
  book_id: string;
  user_id: string;
  /** epub.js CFI of the current position; null before the book is opened. */
  cfi: string | null;
  /** 0–1 progress through the book. */
  percent: number;
  updated_at: string;
}

/** `public.highlights` */
export interface Highlight {
  id: string;
  book_id: string;
  user_id: string;
  /** epub.js CFI range covering the highlighted text. */
  cfi_range: string;
  text: string;
  /** Token name (e.g. `'copper'`); free text in the DB. */
  color: string;
  note: string | null;
  created_at: string;
}

/**
 * `public.reader_settings` — PK `user_id`. Mirrors the `useReaderSettings`
 * store shape (`src/store/reader-settings.ts`).
 */
export interface ReaderSettings {
  user_id: string;
  font_family: FontFamily;
  /** rem multiplier */
  font_size: number;
  line_spacing: number;
  margins: Margins;
  theme: ThemeName;
}
