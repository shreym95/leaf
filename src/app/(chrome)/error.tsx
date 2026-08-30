"use client";

import { useEffect } from "react";
import { Button } from "@/components/primitives";

/**
 * Route-level error boundary for every screen under the app chrome (library,
 * login, settings, styleguide). Renders a calm, token-driven fallback and
 * reports the error.
 *
 * Crash reporting (SPEC §9 M4): `console.error` is what Vercel captures in its
 * runtime logs / observability — no third-party SDK. For this client boundary
 * we just log + render; server-thrown errors are already logged server-side and
 * arrive here only as a `digest`.
 */
export default function ChromeError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
        Something went wrong
      </p>
      <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
        This page didn&rsquo;t load
      </h1>
      <p className="max-w-md font-ui text-ink-mid [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-body)]">
        A hiccup on our side, not yours. Try again — your library and reading
        position are safe.
      </p>
      {error.digest ? (
        <p className="font-mono text-faint [font-size:var(--leaf-text-2xs)]">
          Reference: {error.digest}
        </p>
      ) : null}
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
