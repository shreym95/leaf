// Browser localStorage helpers for demo mode (see `./flag.ts`).
//
// In demo mode there is no Supabase to persist to, so the client-side writes
// the real app makes — reader settings and reading position — go here instead,
// keyed per browser. This keeps the demo faithful: pick a theme or a font, turn
// some pages, reload, and your choices and place are still there.
//
// Every access is wrapped: localStorage throws in private windows / when site
// data is blocked, and is simply absent during SSR. A failure is a no-op.

const PREFIX = "leaf:demo:";

/** Reader settings (theme / font / size / spacing / margins), one blob. */
export const DEMO_SETTINGS_KEY = `${PREFIX}reader-settings`;

/** Reading position for one book (`{ cfi, percent }`). */
export function demoPositionKey(bookId: string): string {
  return `${PREFIX}position:${bookId}`;
}

export function readDemoJSON<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeDemoJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private window / storage disabled — the choice still holds for this session
  }
}
