// Pure helpers for the Notes list (`AnnotationList`): item accessors, chapter
// grouping, the note draft check and the share caveat. No React, no network.
// Length and share limits come from the owning modules, not redefined here.

import { ANNOTATION_NOTE_MAX } from "@/lib/db/annotations";
import { QUOTE_SHARE_MAX } from "@/lib/db/read-notes";
import type { Annotation, VisibleReadNote } from "@/lib/types";
import { noteLength } from "./group-notes";

/** One group read, as the list needs it: its id and display name. */
export interface AnnotationGroupRead {
  id: string;
  groupName: string;
}

/** The Group side of the list. Passing it adds the Mine / Group filter. */
export interface AnnotationGroupContext {
  reads: readonly AnnotationGroupRead[];
  /** Visible notes for every linked read (`visible_notes`), any read. */
  notes: readonly VisibleReadNote[];
  /** Display names of group members, by user id. */
  names: Record<string, string>;
  meId: string;
}

/** A row in the list: one of my personal items, or one visible group note. */
export type AnnotationListItem =
  | { source: "mine"; annotation: Annotation }
  | { source: "group"; note: VisibleReadNote };

const TITLE_CHARS = 40;

export function itemId(item: AnnotationListItem): string {
  return item.source === "mine" ? item.annotation.id : item.note.id;
}

/** The quoted text for a highlight; null for a page mark. */
export function itemQuote(item: AnnotationListItem): string | null {
  if (item.source === "mine") {
    return item.annotation.kind === "range" ? item.annotation.quote : null;
  }
  return item.note.quote_exact ?? null;
}

/** True for a page mark (no quote, no range). */
export function itemIsMark(item: AnnotationListItem): boolean {
  return item.source === "mine"
    ? item.annotation.kind === "page"
    : item.note.kind === "mark";
}

/** The note text, or null when the item has no note. */
export function itemNote(item: AnnotationListItem): string | null {
  return item.source === "mine" ? item.annotation.note : item.note.note;
}

/** Progress for my item as a whole percent, or null when unknown. */
export function itemPercent(item: AnnotationListItem): number | null {
  if (item.source !== "mine" || item.annotation.percent === null) return null;
  return Math.round(item.annotation.percent * 100);
}

/** A short line for a row, used in accessible names: the quote or "Marked page". */
export function itemTitle(item: AnnotationListItem): string {
  const quote = itemQuote(item);
  if (quote === null) return "Marked page";
  const chars = Array.from(quote);
  return chars.length > TITLE_CHARS
    ? `${chars.slice(0, TITLE_CHARS).join("")}…`
    : quote;
}

/**
 * Buckets items by their section label, keeping first-seen order. Input is already
 * in position order, so each chapter forms one run.
 */
export function groupByLabel<T>(
  items: readonly T[],
  labelOf: (item: T) => string,
): { label: string; items: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const label = labelOf(item);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(item);
    else buckets.set(label, [item]);
  }
  return [...buckets].map(([label, rows]) => ({ label, items: rows }));
}

/** The group notes that belong to one read. */
export function notesForRead(
  notes: readonly VisibleReadNote[],
  readId: string,
): VisibleReadNote[] {
  return notes.filter((note) => note.read_id === readId);
}

/** "You" for me, the member's display name when known, else "Member". */
export function authorName(
  userId: string,
  group: Pick<AnnotationGroupContext, "meId" | "names">,
): string {
  if (userId === group.meId) return "You";
  return group.names[userId] ?? "Member";
}

/** True when a highlight quote is longer than what a share sends. */
export function isQuoteTruncated(quote: string | null): boolean {
  return quote !== null && Array.from(quote).length > QUOTE_SHARE_MAX;
}

/** Read names an item is shared with, in the group's read order. */
export function sharedGroupNames(
  readIds: readonly string[],
  reads: readonly AnnotationGroupRead[],
): string[] {
  return reads.filter((r) => readIds.includes(r.id)).map((r) => r.groupName);
}

export interface NoteDraft {
  /** Characters as Postgres counts them, after trimming. */
  length: number;
  overLimit: boolean;
  /** What Save sends: the trimmed text, or null (remove the note) when empty. */
  value: string | null;
}

/** Checks a note draft against the 1–500 rule. Empty means remove the note. */
export function noteDraft(draft: string): NoteDraft {
  const length = noteLength(draft);
  return {
    length,
    overLimit: length > ANNOTATION_NOTE_MAX,
    value: length === 0 ? null : draft.trim(),
  };
}
