// Title comparison for the book picker: a display-only nudge, never a gate.
//
// Pure functions only: no I/O, no imports. The server does not use this file and
// never refuses or changes a link because of it. The UI may show a hint when the
// titles differ; that hint must not block the member's choice.

/**
 * Decompose, lowercase, and drop combining marks that follow a Latin, Greek or
 * Cyrillic letter, so "Émile" → "emile", "Αντιγόνη" → "αντιγονη" and "Ёжик" → "ежик".
 * Marks after other scripts are kept: in Devanagari they are vowel signs and
 * virama, and removing them changes the word.
 */
function fold(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/(\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic})\p{M}+/gu, "$1");
}

/** Reduce to single-space-separated letters, numbers and marks. */
function words(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Title key: subtitle and leading article removed, so "The Time Machine: A Novel" → "time machine"
 * and "Frankenstein; Or, The Modern Prometheus" → "frankenstein". The subtitle starts at the
 * first ":", ";" or " - ".
 */
export function normalizeTitle(s: string | null | undefined): string {
  let text = fold(s);
  const cuts = [text.indexOf(":"), text.indexOf(";"), text.indexOf(" - ")].filter((i) => i >= 0);
  if (cuts.length > 0) text = text.slice(0, Math.min(...cuts));
  return words(text).replace(/^(the|a|an) /, "");
}

/** True when both titles have a key and the keys are equal. */
export function titlesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  return na !== "" && na === nb;
}
