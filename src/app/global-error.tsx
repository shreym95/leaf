"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Global error boundary (SPEC §9 M4 crash reporting). Catches errors thrown by
 * the root layout itself, so it must render its own <html>/<body> and it does
 * NOT inherit the root layout's ThemeProvider, fonts, or `data-theme`.
 *
 * To stay token-driven we import globals.css here and set `data-theme`
 * ourselves — statically to the default, then upgraded to the viewer's saved
 * theme by the same dependency-free pre-paint script the root layout uses.
 *
 * Reporting: `console.error` is what Vercel captures — no third-party SDK.
 */

const themeScript = `!function(){try{var t=localStorage.getItem("leaf-theme")||"night";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="night"}}()`;

export default function GlobalError({
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
    <html lang="en" data-theme="night">
      <head>
        <title>Something went wrong — Leaf</title>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-paper text-ink">
        <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
            Leaf
          </p>
          <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
            Something went wrong
          </h1>
          <p className="max-w-md font-ui text-ink-mid [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-body)]">
            The app hit an unexpected error. Reloading usually clears it — your
            library and reading position are saved.
          </p>
          {error.digest ? (
            <p className="font-mono text-faint [font-size:var(--leaf-text-2xs)]">
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex h-10 items-center justify-center rounded-sm px-4 font-ui [background:var(--leaf-accent)] [color:var(--leaf-page)] [font-size:var(--leaf-text-sm)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
