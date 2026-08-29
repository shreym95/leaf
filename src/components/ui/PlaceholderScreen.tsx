/**
 * PlaceholderScreen — centered title + one line of "coming in M__" copy.
 * Used by the empty routes behind the nav until their milestone lands.
 * Presentational only, token-driven.
 */
export function PlaceholderScreen({
  title,
  milestone,
  note,
}: {
  title: string;
  milestone: string;
  note: string;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-mono uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
        {milestone}
      </p>
      <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
        {title}
      </h1>
      <p className="max-w-md font-body text-ink-mid [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-body)]">
        {note}
      </p>
    </main>
  );
}
