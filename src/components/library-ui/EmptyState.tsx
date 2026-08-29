"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { AddBooksBar } from "./AddBooksBar";

/**
 * EmptyState — shown on the library route when the user has no books yet.
 * Presentational + token-driven; copy stays calm and non-salesy (SPEC §10).
 *
 * M2: the CTAs are real. "Add starter books" seeds the bundled classics
 * (`POST /api/library/seed`); search + upload come from <AddBooksBar>.
 */

type SeedState =
  | { state: "idle" }
  | { state: "seeding" }
  | { state: "error"; message: string };

export function EmptyState() {
  const router = useRouter();
  const [seed, setSeed] = useState<SeedState>({ state: "idle" });

  const addStarterBooks = useCallback(async () => {
    setSeed({ state: "seeding" });
    try {
      const res = await fetch("/api/library/seed", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not add the starter books.");
      }
      setSeed({ state: "idle" });
      router.refresh();
    } catch (err) {
      setSeed({
        state: "error",
        message:
          err instanceof Error
            ? err.message
            : "Could not add the starter books.",
      });
    }
  }, [router]);

  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <h2 className="font-display text-ink [font-size:var(--leaf-text-2xl)]">
        Your shelf is empty
      </h2>
      <p className="font-ui text-ink-mid [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-body)]">
        Add a book — a public-domain classic or your own EPUB — and it will rest
        here, ready to open.
      </p>

      <div className="flex flex-col items-center gap-3">
        <Button
          onClick={addStarterBooks}
          disabled={seed.state === "seeding"}
        >
          {seed.state === "seeding" ? "Adding…" : "Add starter books"}
        </Button>
        <AddBooksBar />
      </div>

      {seed.state === "error" && (
        <p
          role="alert"
          className="font-ui text-accent [font-size:var(--leaf-text-sm)]"
        >
          {seed.message}
        </p>
      )}
    </div>
  );
}
