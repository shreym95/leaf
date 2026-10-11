// Aligning a member's own copy with a group read's stored outline.
//
// Runs wherever a copy is linked or imported. It never throws for a bad or
// unreadable EPUB: the copy is then linked with `alignment: null` and the
// member can still read and set progress by hand.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alignCopy } from "@/lib/groups/alignment";
import type { Alignment, Outline } from "@/lib/groups/types";
import { downloadBookBytes, extractEpubToc } from "./toc";

/**
 * Rebuild an `Outline` from the stored, label-only shape (`group_reads.outline`).
 * Stored entries carry no href, so alignment against it is by label only.
 */
export function outlineFromStored(raw: unknown): Outline {
  if (!Array.isArray(raw)) return [];
  const out: Outline = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== "object" || typeof entry.label !== "string") {
      continue;
    }
    out.push({
      index: out.length,
      label: entry.label,
      depth: typeof entry.depth === "number" ? entry.depth : 0,
      partIndex: typeof entry.partIndex === "number" ? entry.partIndex : null,
      partLabel: typeof entry.partLabel === "string" ? entry.partLabel : null,
      href: "",
    });
  }
  return out;
}

export interface AlignedCopy {
  contentSha256: string | null;
  alignment: Alignment | null;
}

/**
 * Download the member's EPUB, read its table of contents and align it with the
 * stored outline. `bookId` is looked up under `userId`, so another user's book
 * is never read.
 */
export async function alignMemberCopy(
  admin: SupabaseClient,
  userId: string,
  bookId: string,
  storedOutline: unknown,
): Promise<AlignedCopy> {
  const result: AlignedCopy = { contentSha256: null, alignment: null };
  try {
    const { data, error } = await admin
      .from("books")
      .select("storage_path")
      .eq("id", bookId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    const path = (data as { storage_path: string | null } | null)?.storage_path;
    if (!path) return result;

    const bytes = await downloadBookBytes(admin, path);
    result.contentSha256 = createHash("sha256")
      .update(new Uint8Array(bytes))
      .digest("hex");

    const outline = outlineFromStored(storedOutline);
    if (outline.length === 0) return result;
    const toc = await extractEpubToc(bytes);
    if (toc.length === 0) return result;
    result.alignment = alignCopy(toc, outline);
  } catch (err) {
    console.error("[groups] aligning a copy failed", {
      bookId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return result;
}
