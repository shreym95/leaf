/**
 * Reader layout (SPEC §8) — deliberately minimal. No app NavBar: the reader
 * renders its own token-driven top/bottom bars and hides them in immersive
 * mode. The root layout still provides <html>/<body> + ThemeProvider, so the
 * Day/Night toggle works here exactly as elsewhere.
 *
 * Full-viewport, no page scroll — the book paginates inside the spread frame
 * (recreates the prototype's `html,body{height:100%;overflow:hidden}`).
 *
 * `relative`: in immersive mode the bars are taken OUT of the flex flow and
 * positioned against this container, so the page reclaims their height instead
 * of merely painting over it.
 */
export default function ReaderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-paper text-ink">
      {children}
    </div>
  );
}
