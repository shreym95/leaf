// Creating a group read from a member's own book.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidEpubError } from "@/lib/epub/validate";
import { alignCopy } from "@/lib/groups/alignment";
import { buildOutline } from "@/lib/groups/outline";
import type { Outline } from "@/lib/groups/types";
import type { Book, BookSource } from "@/lib/types";
import { isCatalogSource, linkCopy, linkExistingCopies } from "./link-or-import";
import { downloadBookBytes, extractEpubToc } from "./toc";
import { isUuid } from "./membership";
import { parseBoundedText, READ_TITLE_MAX } from "./validate";

/** Shape stored in `group_reads.outline`: labels and structure only, no hrefs. */
export interface StoredOutlineEntry {
  index: number;
  label: string;
  depth: number;
  partIndex: number | null;
  partLabel: string | null;
}

export function toStoredOutline(outline: Outline): StoredOutlineEntry[] {
  return outline.map(({ index, label, depth, partIndex, partLabel }) => ({
    index,
    label,
    depth,
    partIndex,
    partLabel,
  }));
}

export interface NewReadInput {
  title: string;
  author: string;
  source: BookSource;
  sourceRef: string | null;
  bookId: string;
}

const SOURCES: readonly BookSource[] = ["standardebooks", "gutenberg", "upload"];
const SOURCE_REF_MAX = 200;

export function parseReadInput(
  body: Record<string, unknown>,
): { ok: true; input: NewReadInput } | { ok: false; message: string } {
  const title = parseBoundedText(body.title, READ_TITLE_MAX);
  if (!title) return { ok: false, message: "Enter a title." };

  let author = "";
  if (body.author !== undefined && body.author !== null) {
    if (typeof body.author !== "string" || body.author.trim().length > READ_TITLE_MAX) {
      return { ok: false, message: "That author is not valid." };
    }
    author = body.author.trim();
  }

  const source = body.source;
  if (typeof source !== "string" || !SOURCES.includes(source as BookSource)) {
    return { ok: false, message: "Unknown source." };
  }

  let sourceRef: string | null = null;
  if (isCatalogSource(source)) {
    sourceRef = parseBoundedText(body.sourceRef, SOURCE_REF_MAX);
    if (!sourceRef) return { ok: false, message: "Missing book reference." };
  } else if (body.sourceRef !== undefined && body.sourceRef !== null) {
    return { ok: false, message: "An uploaded book has no reference." };
  }

  if (!isUuid(body.bookId)) return { ok: false, message: "Choose a book." };

  return {
    ok: true,
    input: {
      title,
      author,
      source: source as BookSource,
      sourceRef,
      bookId: body.bookId,
    },
  };
}

export type CreateReadResult =
  | {
      ok: true;
      read: { id: string; groupId: string };
      /** Other members whose existing copy was linked. */
      linked: number;
      /** Other members who still need to add their copy. */
      pending: number;
    }
  | { ok: false; status: number; message: string };

/**
 * Build the outline from the caller's own EPUB, store the read and the caller's
 * copy link. The caller is already known to be a member of `groupId`.
 */
export async function createGroupRead(
  admin: SupabaseClient,
  userId: string,
  groupId: string,
  input: NewReadInput,
): Promise<CreateReadResult> {
  // The book must be the caller's own, and must be what the read says it is.
  const { data: bookRow, error: bookError } = await admin
    .from("books")
    .select("*")
    .eq("id", input.bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (bookError) throw bookError;
  const book = bookRow as Book | null;
  if (!book) return { ok: false, status: 404, message: "Book not found." };
  if (
    book.source !== input.source ||
    (book.source_ref ?? null) !== input.sourceRef ||
    !book.storage_path
  ) {
    return {
      ok: false,
      status: 422,
      message: "That book does not match this read.",
    };
  }

  const bytes = await downloadBookBytes(admin, book.storage_path);
  let toc;
  try {
    toc = await extractEpubToc(bytes);
  } catch (err) {
    if (err instanceof InvalidEpubError) {
      return {
        ok: false,
        status: 422,
        message: "This book could not be read.",
      };
    }
    throw err;
  }

  const outline = buildOutline(toc);
  const storedOutline = toStoredOutline(outline);
  if (outline.length === 0) {
    return {
      ok: false,
      status: 422,
      message: "This book has no table of contents.",
    };
  }

  const { data: readRow, error: readError } = await admin
    .from("group_reads")
    .insert({
      group_id: groupId,
      title: input.title,
      author: input.author,
      source: input.source,
      source_ref: input.sourceRef,
      outline: storedOutline,
      schedule: null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (readError) throw readError;
  const readId = (readRow as { id: string }).id;

  try {
    await linkCopy(admin, readId, userId, book.id, {
      contentSha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
      alignment: alignCopy(toc, outline),
    });
  } catch (err) {
    await admin.from("group_reads").delete().eq("id", readId);
    throw err;
  }

  let linked = 0;
  let pending = 0;
  if (isCatalogSource(input.source) && input.sourceRef) {
    try {
      const others = await linkExistingCopies(
        admin,
        {
          id: readId,
          title: input.title,
          source: input.source,
          source_ref: input.sourceRef,
          outline: storedOutline,
        },
        groupId,
        userId,
      );
      linked = others.linked;
      pending = others.pending;
    } catch (err) {
      // The read exists; members can add their copy themselves.
      console.error("[groups] linking member copies failed", {
        readId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true, read: { id: readId, groupId }, linked, pending };
}
