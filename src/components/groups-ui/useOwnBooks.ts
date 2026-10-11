"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BookSource } from "@/lib/types";

export interface OwnBook {
  id: string;
  title: string;
  author: string;
  source: BookSource;
  sourceRef: string | null;
}

export type OwnBooksState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; books: OwnBook[] }
  | { kind: "error" };

interface Row {
  id: string;
  title: string;
  author: string | null;
  source: BookSource;
  source_ref: string | null;
}

/**
 * The caller's visible books (title, author, source), fetched once each time
 * `enabled` turns on. Idle until then, so a closed dialog costs nothing.
 */
export function useOwnBooks(userId: string, enabled: boolean): OwnBooksState {
  const [state, setState] = useState<OwnBooksState>({ kind: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await createClient()
          .from("books")
          .select("id, title, author, source, source_ref")
          .eq("user_id", userId)
          .is("archived_at", null)
          .order("title", { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        setState({
          kind: "ready",
          books: ((data as Row[] | null) ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            author: r.author ?? "",
            source: r.source,
            sourceRef: r.source_ref,
          })),
        });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, enabled]);

  return state;
}
