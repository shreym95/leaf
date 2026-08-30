"use client";

import { useCallback, useId, useState } from "react";
import clsx from "clsx";
import { Button, Sheet, SheetContent } from "@/components/primitives";
import type { CatalogSource, SearchResult } from "@/lib/import/types";
import { trackImport } from "@/lib/analytics";

/**
 * ImportSheet — search Standard Ebooks / Project Gutenberg and add a title to
 * the library. Client component; presentational + token-driven (no literal
 * style values — SPEC §3.2 / §10). All third-party bytes are fetched by the
 * server (`/api/import*`), never here (SPEC §6).
 *
 * Contract with Agent A:
 *   GET  /api/import/search?q=&source=  -> { results: SearchResult[] }
 *   POST /api/import { source, ref }    -> { book } | 4xx { error }
 */

export interface ImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a title is successfully added, so the caller can refresh. */
  onImported?: () => void;
}

type RowStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "added" }
  | { state: "error"; message: string };

const SOURCES: { value: CatalogSource; label: string }[] = [
  { value: "standardebooks", label: "Standard Ebooks" },
  { value: "gutenberg", label: "Project Gutenberg" },
];

function rowKey(r: SearchResult): string {
  return `${r.source}:${r.ref}`;
}

export function ImportSheet({
  open,
  onOpenChange,
  onImported,
}: ImportSheetProps) {
  const searchInputId = useId();
  const [source, setSource] = useState<CatalogSource>("standardebooks");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "searching" | "done" | "error"
  >("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowStatus>>({});

  const runSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      setSearchState("searching");
      setSearchError(null);
      setResults([]);
      setRows({});
      try {
        const res = await fetch(
          `/api/import/search?q=${encodeURIComponent(q)}&source=${source}`,
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Search failed. Please try again.");
        }
        const body = (await res.json()) as { results: SearchResult[] };
        setResults(body.results ?? []);
        setSearchState("done");
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "Search failed. Please try again.",
        );
        setSearchState("error");
      }
    },
    [query, source],
  );

  const addBook = useCallback(
    async (result: SearchResult) => {
      const key = rowKey(result);
      setRows((prev) => ({ ...prev, [key]: { state: "pending" } }));
      try {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: result.source, ref: result.ref }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Could not add that book.");
        }
        setRows((prev) => ({ ...prev, [key]: { state: "added" } }));
        // Count the import by source only (SPEC §9 M4) — never the title/ref.
        trackImport({ source: result.source });
        onImported?.();
      } catch (err) {
        setRows((prev) => ({
          ...prev,
          [key]: {
            state: "error",
            message:
              err instanceof Error ? err.message : "Could not add that book.",
          },
        }));
      }
    },
    [onImported],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Add a book" className="max-w-xl">
        {/* Source toggle */}
        <div
          role="group"
          aria-label="Catalogue"
          className="flex gap-2"
        >
          {SOURCES.map((s) => {
            const selected = s.value === source;
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setSource(s.value)}
                className={clsx(
                  "font-mono font-medium uppercase rounded-sm border px-3 py-2",
                  "transition-colors [transition-duration:var(--leaf-dur-ui)]",
                  "[letter-spacing:var(--leaf-tracking-wide)] [font-size:var(--leaf-text-2xs)]",
                  "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]",
                  selected
                    ? "border-accent text-accent"
                    : "border-rule text-ink-mid hover:text-ink",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <form onSubmit={runSearch} className="mt-4 flex flex-col gap-2">
          <label
            htmlFor={searchInputId}
            className="font-mono uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]"
          >
            Search by title or author
          </label>
          <div className="flex gap-2">
            <input
              id={searchInputId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              placeholder="e.g. Middlemarch"
              className={clsx(
                "flex-1 rounded-sm border border-rule bg-paper px-3 py-2",
                "font-ui text-ink [font-size:var(--leaf-text-sm)]",
                "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]",
              )}
            />
            <Button type="submit" disabled={searchState === "searching"}>
              {searchState === "searching" ? "Searching…" : "Search"}
            </Button>
          </div>
        </form>

        {searchError && (
          <p
            role="alert"
            className="mt-3 font-ui text-accent [font-size:var(--leaf-text-sm)]"
          >
            {searchError}
          </p>
        )}

        {/* Results */}
        <div className="mt-4 max-h-96 overflow-y-auto">
          {searchState === "done" && results.length === 0 && (
            <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)]">
              Nothing found. Try another title.
            </p>
          )}
          <ul className="flex list-none flex-col gap-3 p-0">
            {results.map((r) => {
              const status = rows[rowKey(r)] ?? { state: "idle" };
              return (
                <li key={rowKey(r)} className="flex items-start gap-3">
                  <div className="relative aspect-[3/4] w-12 flex-none overflow-hidden rounded-xs border border-rule bg-page">
                    {r.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.coverUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5">
                    <p className="font-display text-ink [font-size:var(--leaf-text-base)] [line-height:var(--leaf-leading-tight)]">
                      {r.title}
                    </p>
                    <p className="font-ui text-ink-mid [font-size:var(--leaf-text-xs)]">
                      {r.author}
                    </p>
                    {status.state === "error" && (
                      <p
                        role="alert"
                        className="font-ui text-accent [font-size:var(--leaf-text-xs)]"
                      >
                        {status.message}
                      </p>
                    )}
                  </div>
                  <div className="flex-none">
                    {status.state === "added" ? (
                      <span className="font-mono uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]">
                        Added
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addBook(r)}
                        disabled={status.state === "pending"}
                      >
                        {status.state === "pending" ? "Adding…" : "Add"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
