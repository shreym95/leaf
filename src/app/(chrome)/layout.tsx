import { NavBar } from "@/components/ui/NavBar";

/**
 * Chrome layout — the standard app shell (slim top NavBar + page body) for
 * every route EXCEPT the reader. The reader route group ((reader)/) has its own
 * minimal layout with no NavBar so it can go fully immersive (SPEC §8).
 *
 * This is a plain nested layout under the root layout (which owns <html>/<body>
 * / ThemeProvider) — no second root layout, so navigation between chrome pages
 * and the reader is a normal client transition.
 */
export default function ChromeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <NavBar />
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
