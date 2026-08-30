"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";

/**
 * CoverBackfill — pull covers out of books added before covers existed.
 *
 * Lives in settings because it is maintenance, not something to meet on the
 * shelf. It runs in bounded batches (the route caps each request so it can't
 * outlast the serverless time limit) and repeats until the server says there is
 * nothing left, reporting what it actually found rather than claiming success.
 */
export function CoverBackfill() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running">("idle");
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setState("running");
    setResult(null);
    let added = 0;
    let scanned = 0;
    try {
      for (;;) {
        const res = await fetch("/api/library/covers", { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Could not fetch covers.");
        }
        const body = (await res.json()) as {
          added: number;
          scanned: number;
          more: boolean;
        };
        added += body.added;
        scanned += body.scanned;
        if (!body.more) break;
      }
      setResult(
        scanned === 0
          ? "Every book already has a cover."
          : added === 0
            ? `Checked ${scanned} ${scanned === 1 ? "book" : "books"} — none of them carry a cover image.`
            : `Added ${added} ${added === 1 ? "cover" : "covers"}.`,
      );
      router.refresh();
    } catch (err) {
      setResult(
        err instanceof Error ? err.message : "Could not fetch covers.",
      );
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]">
        Books added before covers were supported have none. This reads the files
        already in your library and pulls out the cover art each one carries.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={run} disabled={state === "running"}>
          {state === "running" ? "Looking…" : "Find missing covers"}
        </Button>
        {result && (
          <p
            role="status"
            className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]"
          >
            {result}
          </p>
        )}
      </div>
    </div>
  );
}
