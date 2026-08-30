// Minimal product analytics (SPEC §9 M4: "minimal analytics — screen views,
// import events — never log reading content").
//
// Style-agnostic (ESLint seam): no imports from `@/design` or `@/components`.
//
// ── HARD PRIVACY RULE ──────────────────────────────────────────────────────
// This module is the ONLY place `track()` is called, and it is built so that
// no free-form content can physically reach the analytics vendor:
//
//   * The four exported functions are the entire surface. There is no generic
//     `track(name, props)` re-export.
//   * Every payload is CONSTRUCTED HERE from a frozen enum. Caller input is
//     never spread, never forwarded key-for-key — each value is re-validated
//     against an allow-list and dropped if it is not an exact match.
//   * The property value types are closed unions of literal strings. There is
//     no `string`, no `Record<string, unknown>`, nowhere to put a book title,
//     author, file name, CFI, highlight/note text, email or user id.
//
// Net effect: the bytes that leave the browser are limited to the literal
// event names below plus one of a handful of enum values. Passing anything
// else is a type error at compile time and a no-op at runtime.

import { track } from "@vercel/analytics";

/* -------------------------------------------------------------------------- */
/*  Closed vocabularies — the ONLY strings that can ever reach the vendor.     */
/* -------------------------------------------------------------------------- */

/** App screens we count views of. */
const SCREENS = ["library", "reader", "settings"] as const;
export type ScreenName = (typeof SCREENS)[number];

/** Catalogue sources an import can come from (mirrors `CatalogSource`, kept
 *  as its own frozen list so analytics has an independent, auditable vocab). */
const IMPORT_SOURCES = ["standardebooks", "gutenberg"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** Event names. Literal, defined here, never derived from input. */
const EVENT = {
  screen: "screen_view",
  import: "book_import",
  upload: "book_upload",
  highlight: "highlight_created",
} as const;

/* -------------------------------------------------------------------------- */
/*  Emit — the single choke point.                                            */
/* -------------------------------------------------------------------------- */

/**
 * Forward a fully-formed, sanitised event. `props` may only be a flat map of
 * literal enum strings (see the call sites — never caller data). Wrapped in
 * try/catch so a telemetry failure can never break a user flow.
 */
function emit(
  name: (typeof EVENT)[keyof typeof EVENT],
  props?: Record<string, string>,
): void {
  try {
    track(name, props);
  } catch {
    /* analytics is best-effort and must never throw into the UI */
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API — four functions, nothing else.                                */
/* -------------------------------------------------------------------------- */

/** A screen was shown. No route params, no ids — just which screen. */
export function trackScreen(name: ScreenName): void {
  if (!SCREENS.includes(name)) return; // guards an `as any` caller
  emit(EVENT.screen, { screen: name });
}

/** A catalogue title was imported. Records the source only. */
export function trackImport(input: { source: ImportSource }): void {
  const source = input?.source;
  if (!IMPORT_SOURCES.includes(source)) return;
  emit(EVENT.import, { source });
}

/** A user-supplied EPUB was uploaded. No file name, no metadata — a bare count. */
export function trackUpload(): void {
  emit(EVENT.upload);
}

/** A highlight was created. No CFI, no selected text, no note — a bare count. */
export function trackHighlightCreated(): void {
  emit(EVENT.highlight);
}
