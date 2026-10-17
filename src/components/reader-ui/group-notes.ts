// Pure helpers for the Group tab: where the reader is in outline coordinates, how a
// note's position jumps back into my copy, and how notes are sectioned for display.
// No React, no network. The copy-href resolution mirrors `resolveCopyHref` in
// `src/reader/group-progress.ts` (not exported there), so a mark is placed exactly where
// the progress tracker would place the same page.

import { NOTE_MAX, notesByChapter } from "@/lib/db/read-notes";
import { toOutlinePosition } from "@/lib/groups/alignment";
import type { Alignment, Outline, OutlinePosition } from "@/lib/groups/types";
import type { VisibleReadNote } from "@/lib/types";

/** One linked group read, as the Group tab needs it. */
export interface GroupReadContext {
  readId: string;
  groupId: string;
  groupName: string;
  outline: Outline;
  /** My alignment against this outline; null when my copy has no usable TOC. */
  alignment: Alignment | null;
  /** My copy's content hash (`read_copies.content_sha256`). */
  copySha256: string | null;
  /** Display names of the group's current members, by user id. */
  names: ReadonlyMap<string, string>;
}

/** The reader's current place, as `ReaderLocation` reports it. */
export interface PlaceInBook {
  cfi?: string;
  spineHref?: string;
  sectionFraction?: number;
}

/** Where a tap on a note takes me. */
export type NoteJump =
  /** Same copy, same page: the note's CFI. */
  | { kind: "exact"; target: string }
  /** Different copy or no CFI: the start of the note's chapter in my copy. */
  | { kind: "chapter"; target: string };

export interface NoteRow {
  note: VisibleReadNote;
  jump: NoteJump | null;
}

export interface NoteChapterSection {
  chapterIndex: number;
  label: string;
  rows: NoteRow[];
}

export interface NoteReadSection {
  read: GroupReadContext;
  chapters: NoteChapterSection[];
}

/** Length in characters as Postgres counts them (code points), after trimming. */
export function noteLength(text: string): number {
  return Array.from(text.trim()).length;
}

/** True when the text would pass the 1–500 character check. */
export function canSaveNote(text: string): boolean {
  const n = noteLength(text);
  return n >= 1 && n <= NOTE_MAX;
}

/** A TOC href may carry a #fragment; spine hrefs do not. */
function pathOf(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** Same resolution as group-progress.ts: same path, else a unique same-name file. */
function resolveCopyHref(alignment: Alignment, spineHref: string): string | null {
  const mapped = alignment.copyHrefs.filter((h) => alignment.map[h] !== undefined);
  const path = pathOf(spineHref);

  const exact = mapped.find((h) => pathOf(h) === path);
  if (exact !== undefined) return exact;

  const base = lastSegment(path);
  if (!base) return null;
  const sameName = mapped.filter((h) => lastSegment(pathOf(h)) === base);
  if (sameName.length === 0) return null;
  const distinctPaths = new Set(sameName.map(pathOf));
  return distinctPaths.size === 1 ? sameName[0] : null;
}

/** The reader's place in this read's outline coordinates, or null when unmappable. */
export function outlinePositionFor(
  read: GroupReadContext,
  place: PlaceInBook | null,
): OutlinePosition | null {
  if (!place || !read.alignment) return null;
  if (place.spineHref === undefined || place.sectionFraction === undefined) return null;
  const copyHref = resolveCopyHref(read.alignment, place.spineHref);
  if (copyHref === null) return null;
  return toOutlinePosition(read.alignment, read.outline, copyHref, place.sectionFraction);
}

/**
 * My copy's href for an outline chapter, the start of that chapter. Null unless the
 * mapping round-trips: mapping the href back must give the same chapter index.
 */
export function chapterStartHref(read: GroupReadContext, chapterIndex: number): string | null {
  const { alignment, outline } = read;
  if (!alignment) return null;
  const href = alignment.copyHrefs.find((h) => alignment.map[h] === chapterIndex);
  if (href === undefined) return null;
  const back = toOutlinePosition(alignment, outline, href, 0);
  return back.chapterIndex === chapterIndex ? href : null;
}

/** Where tapping a note goes, or null when it cannot be placed in my copy. */
export function noteJump(
  read: GroupReadContext,
  note: Pick<VisibleReadNote, "chapter_index" | "cfi" | "content_sha256">,
): NoteJump | null {
  if (note.cfi && note.content_sha256 && note.content_sha256 === read.copySha256) {
    return { kind: "exact", target: note.cfi };
  }
  const href = chapterStartHref(read, note.chapter_index);
  return href === null ? null : { kind: "chapter", target: href };
}

/** Outline chapter label, with a neutral fallback for an index the outline lacks. */
export function chapterLabelOf(outline: Outline, chapterIndex: number): string {
  const entry = outline[chapterIndex];
  return entry ? entry.label : `Chapter ${chapterIndex + 1}`;
}

/**
 * Sections for display: one per read in the order given, chapters in outline order
 * (ascending index), notes within a chapter in the order the RPC returned them.
 */
export function buildNoteSections(
  reads: readonly GroupReadContext[],
  notesByRead: ReadonlyMap<string, readonly VisibleReadNote[]>,
): NoteReadSection[] {
  return reads.map((read) => {
    const notes = [...(notesByRead.get(read.readId) ?? [])];
    const buckets = [...notesByChapter(notes)].sort(([a], [b]) => a - b);
    return {
      read,
      chapters: buckets.map(([chapterIndex, rows]) => ({
        chapterIndex,
        label: chapterLabelOf(read.outline, chapterIndex),
        rows: rows.map((note) => ({ note, jump: noteJump(read, note) })),
      })),
    };
  });
}
