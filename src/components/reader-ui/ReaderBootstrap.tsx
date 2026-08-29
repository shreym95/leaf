"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/primitives";
import { openBook, type BookController } from "@/reader/bootstrap";

/**
 * ReaderBootstrap — M2 smoke screen: proves a stored EPUB opens and paginates
 * with epub.js. Presentational + token-driven; the logic lives in
 * `src/reader/bootstrap.ts`.
 *
 * M2: replaced by the designed reader (rendition.themes + normalizer + settings
 * + CFI sync) in M3. Keep the styling minimal — this is not the fine-press
 * reader.
 */

export interface ReaderBootstrapProps {
  fileUrl: string;
  title: string;
}

type LoadState =
  | { state: "loading" }
  | { state: "ready"; chapters: number }
  | { state: "error"; message: string };

export function ReaderBootstrap({ fileUrl, title }: ReaderBootstrapProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<BookController | null>(null);
  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    let controller: BookController | undefined;

    (async () => {
      try {
        controller = await openBook(fileUrl);
        if (cancelled || !viewerRef.current) return;
        controllerRef.current = controller;
        await controller.renderTo(viewerRef.current);
        if (cancelled) return;
        setLoad({ state: "ready", chapters: controller.chapterCount() });
      } catch (err) {
        if (cancelled) return;
        setLoad({
          state: "error",
          message:
            err instanceof Error ? err.message : "This book could not be opened.",
        });
      }
    })();

    return () => {
      cancelled = true;
      controller?.destroy();
      controllerRef.current = null;
    };
  }, [fileUrl]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-8">
      <h1 className="font-display text-ink [font-size:var(--leaf-text-xl)]">
        {title}
      </h1>

      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md border border-rule bg-page sm:aspect-[4/3]">
        <div ref={viewerRef} className="h-full w-full" />

        {load.state === "loading" && (
          <p className="absolute inset-0 flex items-center justify-center font-ui text-ink-mid [font-size:var(--leaf-text-sm)]">
            Opening…
          </p>
        )}
        {load.state === "error" && (
          <p
            role="alert"
            className="absolute inset-0 flex items-center justify-center px-6 text-center font-ui text-accent [font-size:var(--leaf-text-sm)]"
          >
            {load.message}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <Button
          variant="ghost"
          onClick={() => controllerRef.current?.prev()}
          disabled={load.state !== "ready"}
        >
          Previous
        </Button>

        <p
          aria-live="polite"
          className="font-mono uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]"
        >
          {load.state === "ready"
            ? `${load.chapters} ${load.chapters === 1 ? "section" : "sections"} · loaded ✓`
            : " "}
        </p>

        <Button
          variant="ghost"
          onClick={() => controllerRef.current?.next()}
          disabled={load.state !== "ready"}
        >
          Next
        </Button>
      </div>
    </main>
  );
}
