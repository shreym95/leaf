// Domain types for group reads. Pure data, style-agnostic: nothing here imports
// from the reader, the UI or Supabase.

/**
 * Minimal table-of-contents entry. The reader's `ReaderTocEntry` (and epub.js's
 * `NavItem`) satisfy this structurally, so callers can pass them straight in.
 */
export interface TocInput {
  /** Spine href, possibly with a `#fragment`. */
  href: string;
  label: string;
  subitems?: readonly TocInput[];
}

/** One chapter of a group read's outline, in reading order. */
export interface OutlineEntry {
  /** 0-based position in the flattened outline. */
  index: number;
  label: string;
  /** Nesting level in the source TOC: 0 = top level, 1 = inside a Part, ... */
  depth: number;
  /** 0-based ordinal of the Part this chapter belongs to; null when it has none. */
  partIndex: number | null;
  /** Label of that Part (additive to the stored shape; needed to name milestones). */
  partLabel: string | null;
  /** Href in the copy the outline was built from. */
  href: string;
}

export type Outline = OutlineEntry[];

/** `part:<n>` (n = Part ordinal, 0-based), `half`, or `end`. */
export type MilestonePoint = `part:${number}` | "half" | "end";

/** Where a milestone point sits in outline coordinates. */
export interface MilestonePointDef {
  point: MilestonePoint;
  chapterIndex: number;
  chapterFraction: number;
  /** Part label for `part:<n>` points; null for `half` and `end`. */
  label: string | null;
}

/** A position in outline coordinates. */
export interface OutlinePosition {
  chapterIndex: number;
  /** 0..1 */
  chapterFraction: number;
}

/**
 * How one member's copy lines up with a group read's outline.
 * JSON-safe: it is stored in `read_copies.alignment`.
 */
export interface Alignment {
  /** Copy TOC href (fragment included) to outline chapter index. Matched entries only. */
  map: Record<string, number>;
  /**
   * Every chapter href of the copy's TOC in reading order, matched or not. jsonb does
   * not keep key order, so the order lives here.
   */
  copyHrefs: string[];
  /** 0..1: matched entries / outline length. */
  confidence: number;
  /** The copy's TOC is identical to the outline's (same hrefs and labels). */
  identity: boolean;
}

/** A location in a member's own copy. */
export interface CopyLocation {
  /** TOC href, fragment included when the TOC entry had one. */
  copyHref: string;
  /** 0..1 within the section file. */
  fraction: number;
}
