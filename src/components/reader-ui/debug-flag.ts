// The debug opt-in gate. Deliberately its own module, with NO "use client":
// the reader route is a Server Component and must be able to call this during
// rendering. Importing a plain function out of a "use client" file would make it
// a client reference and blow up on the server.
//
// The reader's debug overlay (DEFECTS.md D2 instrumentation) is a live
// production build, so it must never appear for a normal reader — it shows only
// when the URL carries an explicit, exact `?debug=1`. Anything else ("true",
// "yes", "0", a bare `?debug`) is off: an unusual value is far more likely to be
// an accident than an intent.

/** The one opt-in token. `/reader/<bookId>?debug=1` and nothing else. */
export const DEBUG_PARAM = "debug";
const DEBUG_VALUE = "1";

/**
 * Is the debug readout explicitly requested by this URL's search params?
 *
 * @param searchParams the resolved `searchParams` of the reader route.
 */
export function debugRequested(
  searchParams?: Record<string, string | string[] | undefined> | null,
): boolean {
  const value = searchParams?.[DEBUG_PARAM];
  if (Array.isArray(value)) return value.includes(DEBUG_VALUE);
  return value === DEBUG_VALUE;
}
