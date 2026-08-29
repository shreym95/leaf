/**
 * EmptyState — shown on the library route when the user has no books yet.
 * Presentational only, token-driven. Copy stays calm and non-salesy (SPEC §10);
 * import + upload are not built until M2, so this renders text, not a dead button.
 */
export function EmptyState() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h2 className="font-display text-ink [font-size:var(--leaf-text-2xl)]">
        Your shelf is empty
      </h2>
      <p className="font-ui text-ink-mid [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-body)]">
        When you add a book — a public-domain classic or your own EPUB — it will
        rest here, ready to open.
      </p>
      <p className="font-mono font-medium uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]">
        Importing and upload arrive in M2
      </p>
    </div>
  );
}
