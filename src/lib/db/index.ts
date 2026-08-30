// Barrel for the typed DB helpers. `profiles` / `books` helpers are server-side
// only (they create a server `createClient` internally). The `reading-state`
// helpers accept an explicit client and also run in the browser — import them
// from `@/lib/db/reading-state` directly in client code rather than via this
// barrel, so the server-only helpers above aren't pulled into a client bundle.

export { getProfile, ensureProfile } from "./profiles";
export { listBooks, getBook } from "./books";
export {
  getReaderSettings,
  upsertReaderSettings,
  type ReaderSettingsPatch,
} from "./reader-settings";
export { getReadingState, upsertReadingState } from "./reading-state";
export {
  listHighlights,
  createHighlight,
  updateHighlightNote,
  deleteHighlight,
  type CreateHighlightInput,
} from "./highlights";
