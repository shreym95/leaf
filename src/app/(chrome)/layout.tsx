import { NavBar } from "@/components/ui/NavBar";
import { ThemeSync } from "@/components/theme/ThemeSync";
import { getUser } from "@/lib/auth";
import { getReaderSettings } from "@/lib/db";
import { settingsFromRow } from "@/store/reader-settings";

/**
 * Chrome layout — the standard app shell (slim top NavBar + page body) for
 * every route EXCEPT the reader. The reader route group ((reader)/) has its own
 * minimal layout with no NavBar so it can go fully immersive (SPEC §8).
 *
 * This is a plain nested layout under the root layout (which owns <html>/<body>
 * / ThemeProvider) — no second root layout, so navigation between chrome pages
 * and the reader is a normal client transition.
 *
 * It also seeds the reader-settings store, so the chrome and the reader share
 * one persisted theme (see ThemeSync). `getUser` is request-cached, so this
 * costs one settings query and no extra auth round trip.
 */
export default async function ChromeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  const settingsRow = user
    ? await getReaderSettings(user.id).catch(() => null)
    : null;

  return (
    <>
      {user && (
        <ThemeSync userId={user.id} settings={settingsFromRow(settingsRow)} />
      )}
      <NavBar />
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
