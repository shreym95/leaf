// Hand-written DB row types from SPEC §5. One row = one interface, snake_case
// columns to match Postgres.
//
// M1: replace with `supabase gen types typescript` output

/** `profiles (id = auth uid, display_name, default_theme, created_at)` */
export interface Profile {
  id: string;
  display_name: string | null;
  default_theme: "day" | "night";
  created_at: string;
}

export type BookSource = "standardebooks" | "gutenberg" | "upload";
export type BookStatus = "reading" | "finished";

/**
 * `books (id, user_id, title, author, source, source_ref, storage_path,
 * cover_url?, added_at, status)`
 */
export interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string;
  source: BookSource;
  /** Catalog id / OPDS ref for imported books; null for uploads. */
  source_ref: string | null;
  /** Path within the per-user Supabase Storage bucket. */
  storage_path: string | null;
  cover_url?: string | null;
  added_at: string;
  status: BookStatus;
}

/** `reading_state (book_id, user_id, cfi, percent, updated_at)` */
export interface ReadingState {
  book_id: string;
  user_id: string;
  /** epub.js CFI of the current position. */
  cfi: string | null;
  /** 0–1 progress through the book. */
  percent: number;
  updated_at: string;
}

/** `highlights (id, book_id, user_id, cfi_range, text, color, note?, created_at)` */
export interface Highlight {
  id: string;
  book_id: string;
  user_id: string;
  /** epub.js CFI range covering the highlighted text. */
  cfi_range: string;
  text: string;
  color: string;
  note?: string | null;
  created_at: string;
}

/**
 * `reader_settings (user_id, font_family, font_size, line_spacing, margins,
 * theme)`. Mirrors the `useReaderSettings` store shape (src/store).
 */
export interface ReaderSettings {
  user_id: string;
  font_family: "serif" | "sans" | "legible";
  /** rem */
  font_size: number;
  line_spacing: number;
  margins: "narrow" | "normal" | "wide";
  theme: "day" | "night";
}
