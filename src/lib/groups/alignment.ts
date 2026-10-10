import { buildOutline } from "./outline";
import type {
  Alignment,
  CopyLocation,
  Outline,
  OutlinePosition,
  TocInput,
} from "./types";

// ── label normalisation ──────────────────────────────────────────────────────

const PREFIXES = new Set(["chapter", "ch", "part", "book", "letter"]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

const ROMAN_VALUES: Record<string, number> = {
  i: 1, v: 5, x: 10, l: 50, c: 100,
};

/** Roman numeral I–C (canonical form only) to a number, else null. */
function romanToInt(token: string): number | null {
  if (!/^[ivxlc]+$/.test(token)) return null;
  let total = 0;
  for (let i = 0; i < token.length; i++) {
    const v = ROMAN_VALUES[token[i]];
    const next = ROMAN_VALUES[token[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  if (total < 1 || total > 100) return null;
  return intToRoman(total) === token ? total : null;
}

function intToRoman(n: number): string {
  const table: Array<[number, string]> = [
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/**
 * Canonical form of a chapter label for comparing copies: lowercase, no accents or
 * punctuation, single spaces, a leading "chapter"/"ch."/"part"/"book"/"letter" removed,
 * Roman numerals (I–C) and number words (one–twenty) turned into digits.
 */
export function normaliseLabel(s: string): string {
  const cleaned = s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!cleaned) return "";
  let tokens = cleaned.split(" ");
  if (tokens.length > 1 && PREFIXES.has(tokens[0])) tokens = tokens.slice(1);
  return tokens
    .map((t) => {
      const w = NUMBER_WORDS[t];
      if (w !== undefined) return String(w);
      const r = romanToInt(t);
      return r !== null ? String(r) : t;
    })
    .join(" ");
}

/** Equal after normalising, or one side is just the other's leading chapter number. */
function labelsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return /^\d+$/.test(short) && long.startsWith(short + " ");
}

// ── hrefs ────────────────────────────────────────────────────────────────────

/** A TOC href may carry a #fragment; spine hrefs do not. */
function hrefPath(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ── alignment ────────────────────────────────────────────────────────────────

/**
 * Line a member's copy up with a group read's outline.
 *
 * Identical hrefs and labels: identity, confidence 1. Otherwise an order-preserving
 * match (longest common subsequence over normalised labels); copy entries with no
 * counterpart (front matter, extras) map to nothing. Confidence is matched entries over
 * outline length. No usable TOC: confidence 0 and an empty map.
 */
export function alignCopy(
  copyToc: readonly TocInput[] | null | undefined,
  outline: Outline,
): Alignment {
  const copy = buildOutline(copyToc ?? []);
  const copyHrefs = copy.map((e) => e.href);
  if (copy.length === 0 || outline.length === 0) {
    return { map: {}, copyHrefs, confidence: 0, identity: false };
  }

  const identity =
    copy.length === outline.length &&
    copy.every((e, i) => e.href === outline[i].href && e.label === outline[i].label);
  if (identity) {
    const map: Record<string, number> = {};
    copy.forEach((e, i) => {
      if (!(e.href in map)) map[e.href] = i;
    });
    return { map, copyHrefs, confidence: 1, identity: true };
  }

  const a = copy.map((e) => normaliseLabel(e.label));
  const b = outline.map((e) => normaliseLabel(e.label));
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = labelsMatch(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const map: Record<string, number> = {};
  let matched = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (labelsMatch(a[i], b[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) {
      if (!(copy[i].href in map)) map[copy[i].href] = j;
      matched += 1;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return {
    map,
    copyHrefs,
    confidence: matched / outline.length,
    identity: false,
  };
}

/**
 * A location in the member's copy to outline coordinates.
 *
 * `copyHref` is a spine or TOC href (fragment ignored). When it is not itself mapped it
 * resolves to the nearest preceding mapped TOC entry, at fraction 1 (it sits after that
 * chapter), or to chapter 0 fraction 0 when nothing precedes it. Pass `spine` (the
 * copy's spine hrefs in order) so a spine item missing from the TOC can be placed;
 * without it such an item resolves to chapter 0.
 *
 * Several TOC entries inside one file cannot be told apart by section fraction: the
 * first mapped one wins.
 */
export function toOutlinePosition(
  alignment: Alignment,
  outline: Outline,
  copyHref: string,
  sectionFraction: number,
  spine?: readonly string[],
): OutlinePosition {
  const fraction = clamp01(sectionFraction);
  const path = hrefPath(copyHref);
  const hrefs = alignment.copyHrefs;
  const last = Math.max(0, outline.length - 1);

  const direct = hrefs.find(
    (h) => hrefPath(h) === path && alignment.map[h] !== undefined,
  );
  if (direct !== undefined) {
    return {
      chapterIndex: Math.min(alignment.map[direct], last),
      chapterFraction: fraction,
    };
  }

  // Latest TOC position at or before the location.
  let start = hrefs.findIndex((h) => hrefPath(h) === path);
  if (start === -1 && spine) {
    const at = spine.findIndex((s) => hrefPath(s) === path);
    if (at !== -1) {
      for (let k = 0; k < hrefs.length; k++) {
        const s = spine.findIndex((x) => hrefPath(x) === hrefPath(hrefs[k]));
        if (s !== -1 && s <= at) start = k;
      }
    }
  }
  for (let k = start; k >= 0; k--) {
    const idx = alignment.map[hrefs[k]];
    if (idx !== undefined) {
      return { chapterIndex: Math.min(idx, last), chapterFraction: 1 };
    }
  }
  return { chapterIndex: 0, chapterFraction: 0 };
}

/**
 * Inverse of toOutlinePosition, for navigation: an outline position to a location in
 * the member's copy. An outline chapter the copy lacks resolves to the nearest
 * preceding matched chapter's end (or the first matched chapter's start). Null when the
 * copy matched nothing.
 */
export function fromOutlinePosition(
  alignment: Alignment,
  outline: Outline,
  position: OutlinePosition,
): CopyLocation | null {
  const fraction = clamp01(position.chapterFraction);
  const wanted = Number.isFinite(position.chapterIndex)
    ? Math.min(Math.max(Math.trunc(position.chapterIndex), 0), Math.max(0, outline.length - 1))
    : 0;

  const hrefFor = (idx: number): string | undefined =>
    alignment.copyHrefs.find((h) => alignment.map[h] === idx);

  const exact = hrefFor(wanted);
  if (exact !== undefined) return { copyHref: exact, fraction };

  for (let idx = wanted - 1; idx >= 0; idx--) {
    const h = hrefFor(idx);
    if (h !== undefined) return { copyHref: h, fraction: 1 };
  }
  for (let idx = wanted + 1; idx < outline.length; idx++) {
    const h = hrefFor(idx);
    if (h !== undefined) return { copyHref: h, fraction: 0 };
  }
  return null;
}
