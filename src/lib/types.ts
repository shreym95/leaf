// Leaf DB row types — MUST match supabase/migrations/0001_init.sql exactly:
// snake_case columns, nullability, and the CHECK-constraint unions.
//
// Regenerate with: supabase gen types typescript --project-id <ref> > src/lib/types.ts
// (planned for M1 tail / M2, once the Supabase CLI is set up — see supabase/README.md).
// Until then this file is hand-maintained; edit it in lockstep with the migration.

import type { ScheduleCheckpoint } from "@/lib/groups/schedule";

// The canonical set of theme ids. A theme id is persisted data — it is written
// to `profiles.default_theme` and `reader_settings.theme`, both guarded by a
// CHECK constraint — so it is declared here, in the logic layer, and NOT in the
// design layer. `src/design/themes.ts` keys its registry off this type, so a new
// id here is a compile error until every palette exists.
//
// Changing this union means changing the CHECK constraints too: see
// `supabase/migrations/0006_two_themes.sql` for the pattern (it narrows the set
// back to {day, night}, and migrates rows before tightening the constraint).
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
  /**
   * When the reader reached the end (0007). Null = not finished. Always set
   * together with `status = 'finished'` — the DB enforces it
   * (`books_finished_consistent`), so a write sets both or neither.
   */
  finished_at: string | null;
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

/** `public.bookmarks` (0005) — many per (book, user), unlike `reading_state`. */
export interface Bookmark {
  id: string;
  book_id: string;
  user_id: string;
  /** epub.js CFI of the bookmarked page's start (same kind of value as
   *  `reading_state.cfi`). */
  cfi: string;
  /** Chapter title captured at save time, from the book's TOC. Null when the
   *  TOC has no entry for the section. Denormalised — see 0005. */
  label: string | null;
  /** 0–1 progress at save time. Null when `book.locations` was not ready yet.
   *  Denormalised — see 0005. */
  percent: number | null;
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

/** Role of a group member; guarded by a CHECK constraint (0008). */
export type GroupRole = "owner" | "member";

/** `public.groups` (0008). The owner is the `group_members` row with role `'owner'`. */
export interface Group {
  id: string;
  /** 1–60 characters (CHECK in 0008). */
  name: string;
  created_at: string;
}

/** `public.group_members` (0008) — PK `(group_id, user_id)`; one `'owner'` row per group. */
export interface GroupMember {
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
}

/** `public.group_invites` (0008) — service-role only; no client policies. */
export interface GroupInvite {
  /** URL-safe token from at least 32 random bytes. Primary key. */
  token: string;
  group_id: string;
  created_by: string;
  expires_at: string;
  max_uses: number;
  uses: number;
}

/** Row returned by `public.group_member_names(gid)` (0008). */
export interface GroupMemberName {
  user_id: string;
  display_name: string | null;
  role: GroupRole;
  joined_at: string;
}

/**
 * One entry of `group_reads.outline` (0009): labels only, in reading order.
 * The milestone trigger reads `index` and `partIndex`.
 */
export interface OutlineJsonEntry {
  index: number;
  label: string;
  depth: number;
  /** Part this chapter belongs to, or null (front matter, books without Parts). */
  partIndex: number | null;
  href: string;
}

/** `public.group_reads` (0009). Created and deleted through Route Handlers only. */
export interface GroupRead {
  id: string;
  group_id: string;
  /** 1–300 characters (CHECK in 0009). */
  title: string;
  author: string;
  source: BookSource;
  source_ref: string | null;
  /** Non-empty array (CHECK in 0009). */
  outline: OutlineJsonEntry[];
  /**
   * Optional dated checkpoints (0010 types it as jsonb). Null = no schedule. Stored
   * raw; read it through `parseSchedule`, which drops malformed items.
   */
  schedule: ScheduleCheckpoint[] | null;
  /** Null once the creator's account is deleted. */
  created_by: string | null;
  created_at: string;
}

/** `public.read_copies` (0009) — PK `(read_id, user_id)`; owner-only. */
export interface ReadCopy {
  read_id: string;
  user_id: string;
  book_id: string;
  content_sha256: string | null;
  alignment: unknown | null;
}

/** `public.read_progress` (0009) — PK `(read_id, user_id)`; position in outline coordinates. */
export interface ReadProgress {
  read_id: string;
  user_id: string;
  chapter_index: number;
  /** 0–1 within the chapter. */
  chapter_fraction: number;
  /** 0–1 across the whole book. */
  percent: number;
  finished_at: string | null;
  /** True when the member set their position by hand rather than from a copy. */
  manual: boolean;
  updated_at: string;
}

/** Kind of a `read_notes` row (0010): a bare page mark, a note, or a highlight (v2). */
export type ReadNoteKind = "mark" | "note" | "highlight";

/**
 * `public.read_notes` (0010). Owner-only on direct select; other members read through
 * `visible_notes`. The quote columns are v2 only and are always null in v1.
 */
export interface ReadNote {
  id: string;
  read_id: string;
  user_id: string;
  /** 0-based outline chapter index. */
  chapter_index: number;
  /** 0..1 within the chapter. */
  chapter_fraction: number;
  kind: ReadNoteKind;
  /** 1–500 characters; required for `note`, null for `mark`. */
  note: string | null;
  quote_exact: string | null;
  quote_prefix: string | null;
  quote_suffix: string | null;
  /** epub.js CFI of the position, when the writer's copy has one. */
  cfi: string | null;
  /** Hash of the copy the position was taken from (for re-anchoring). */
  content_sha256: string | null;
  created_at: string;
}

/**
 * A row from `visible_notes(rid)` (0010): the `ReadNote` columns without the v2
 * quote anchors. Own notes, plus other members' notes at or behind the caller.
 */
export type VisibleReadNote = Omit<ReadNote, "quote_exact" | "quote_prefix" | "quote_suffix">;

/**
 * `public.read_milestones` (0009) — PK `(read_id, user_id, point)`. Trigger-written,
 * append-only. `point` is `part:<n>`, `half`, `end` or `checkpoint:<n>`.
 */
export interface ReadMilestone {
  read_id: string;
  user_id: string;
  point: string;
  reached_at: string;
}
