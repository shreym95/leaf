/**
 * Reader fallback.
 *
 * The reader already says "Opening the book…" once `ReaderShell` mounts — but
 * that is *after* the server has authenticated, read the book row and signed a
 * Storage URL. This covers that earlier gap with the same words on the same
 * surface, so opening a book reads as one continuous wait rather than a blank
 * screen followed by a different screen.
 *
 * No skeleton blocks here: a page of fake text lines under a real book's title
 * would be worse than a quiet line of type.
 */
export default function ReaderLoading() {
  return (
    <main
      aria-label="Reader"
      className="flex min-h-0 flex-1 items-center justify-center"
      style={{
        paddingTop: "var(--leaf-safe-top)",
        paddingBottom: "var(--leaf-safe-bottom)",
      }}
    >
      <p
        role="status"
        className="font-mono uppercase text-faint [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]"
      >
        Opening the book…
      </p>
    </main>
  );
}
