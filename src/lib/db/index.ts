// Barrel for the typed DB helpers. Server-side only — every helper here calls
// `createClient` from `@/lib/supabase/server`.

export { getProfile, ensureProfile } from "./profiles";
export { listBooks, getBook } from "./books";
