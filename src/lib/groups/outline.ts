import type {
  MilestonePoint,
  Outline,
  OutlineEntry,
  OutlinePosition,
  TocInput,
} from "./types";
import type { ScheduleCheckpoint } from "./schedule";

/** A chapter at or past this fraction counts as finished. */
// Must match the `end` rule in supabase/migrations/0009_group_reads.sql (record_read_milestones).
export const END_FRACTION_THRESHOLD = 0.98;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Flatten a TOC depth-first into reading-order chapters.
 *
 * A top-level entry with children is a Part: it is not a chapter itself, its children
 * are, each tagged with the Part's ordinal. Top-level leaves are chapters with no Part.
 * Entries with blank labels are skipped (their children are still visited). A top-level
 * entry whose children all vanish is treated as a plain chapter.
 */
export function buildOutline(toc: readonly TocInput[]): Outline {
  const out: OutlineEntry[] = [];
  let partCount = 0;

  const push = (
    item: TocInput,
    label: string,
    depth: number,
    partIndex: number | null,
    partLabel: string | null,
  ): void => {
    out.push({
      index: out.length,
      label,
      depth,
      partIndex,
      partLabel,
      href: item.href,
    });
  };

  const walk = (
    items: readonly TocInput[],
    depth: number,
    partIndex: number | null,
    partLabel: string | null,
  ): void => {
    for (const item of items) {
      const label = (item.label ?? "").trim();
      if (label) push(item, label, depth, partIndex, partLabel);
      if (item.subitems?.length) walk(item.subitems, depth + 1, partIndex, partLabel);
    }
  };

  for (const item of toc) {
    const label = (item.label ?? "").trim();
    const kids = item.subitems ?? [];
    if (label && kids.length > 0) {
      const before = out.length;
      const partIndex = partCount;
      walk(kids, 1, partIndex, label);
      if (out.length > before) {
        partCount += 1;
      } else {
        push(item, label, 0, null, null);
      }
    } else {
      if (label) push(item, label, 0, null, null);
      if (kids.length > 0) walk(kids, 1, null, null);
    }
  }
  return out;
}

/** `checkpoint:<i>`: a scheduled checkpoint at outline chapter `i` (0-based). */
export type CheckpointPoint = `checkpoint:${number}`;

/** Every point a position can reach: the milestone kinds plus scheduled checkpoints. */
export type AnyMilestonePoint = MilestonePoint | CheckpointPoint;

/** A milestone point definition in outline coordinates, scheduled checkpoints included. */
export interface OutlinePointDef {
  point: AnyMilestonePoint;
  chapterIndex: number;
  chapterFraction: number;
  /** Part label for `part:<n>`; the chapter label for `checkpoint:<i>`; null otherwise. */
  label: string | null;
}

/**
 * The milestone points of an outline, in reading order: one `part:<n>` per Part (at its
 * first chapter), `half` (start of the chapter at the middle of the outline; omitted
 * for a single-chapter book) and `end` (the last chapter at END_FRACTION_THRESHOLD).
 * With a schedule, one `checkpoint:<i>` per checkpoint whose chapter is in the outline,
 * at END_FRACTION_THRESHOLD of that chapter. Without one the result is unchanged.
 */
export function milestonePoints(
  outline: Outline,
  schedule?: readonly ScheduleCheckpoint[] | null,
): OutlinePointDef[] {
  if (outline.length === 0) return [];
  const defs: OutlinePointDef[] = [];

  const seen = new Set<number>();
  for (const e of outline) {
    if (e.partIndex === null || seen.has(e.partIndex)) continue;
    seen.add(e.partIndex);
    defs.push({
      point: `part:${e.partIndex}`,
      chapterIndex: e.index,
      chapterFraction: 0,
      label: e.partLabel,
    });
  }

  if (outline.length >= 2) {
    defs.push({
      point: "half",
      chapterIndex: Math.floor(outline.length / 2),
      chapterFraction: 0,
      label: null,
    });
  }

  defs.push({
    point: "end",
    chapterIndex: outline.length - 1,
    chapterFraction: END_FRACTION_THRESHOLD,
    label: null,
  });

  for (const c of schedule ?? []) {
    if (!Number.isInteger(c.chapter_index)) continue;
    if (c.chapter_index < 0 || c.chapter_index > outline.length - 1) continue;
    const entry = outline[c.chapter_index];
    defs.push({
      point: `checkpoint:${c.chapter_index}`,
      chapterIndex: c.chapter_index,
      chapterFraction: END_FRACTION_THRESHOLD,
      label: entry.label,
    });
  }

  // Stable sort keeps part < half < end when they land on the same spot.
  return defs.sort(
    (a, b) =>
      a.chapterIndex - b.chapterIndex || a.chapterFraction - b.chapterFraction,
  );
}

/** The label a reader sees for a checkpoint: "Through <chapter label>". */
export function checkpointLabel(chapterLabel: string): string {
  return `Through ${chapterLabel}`;
}

/**
 * Which milestone points a position has reached (at or behind it), in reading order.
 *
 * `finished` (the read's `read_progress.finished_at` is set) reaches `end` and every
 * checkpoint, as the trigger does. Part and half are position-only.
 *
 * Mirrors `record_read_milestones()` in supabase/migrations/0010_read_notes.sql.
 * Keep the two in lockstep: the trigger records what this function reports.
 */
export function pointsReached(
  outline: Outline,
  position: OutlinePosition,
  schedule?: readonly ScheduleCheckpoint[] | null,
  finished = false,
): AnyMilestonePoint[] {
  const { chapterIndex } = position;
  const validPosition = Number.isFinite(chapterIndex) && chapterIndex >= 0;
  if (!validPosition && !finished) return [];
  const fraction = clamp01(position.chapterFraction);
  return milestonePoints(outline, schedule)
    .filter(
      (d) =>
        (validPosition &&
          (chapterIndex > d.chapterIndex ||
            (chapterIndex === d.chapterIndex && fraction >= d.chapterFraction))) ||
        (finished && (d.point === "end" || d.point.startsWith("checkpoint:"))),
    )
    .map((d) => d.point);
}
