// POST /api/books/register  { path }
//
// Second half of the direct-to-Storage upload flow (SPEC §3.5, §6). The browser
// has already uploaded the EPUB to `path` via a signed URL (/api/upload/sign).
// This route verifies the path belongs to the caller, downloads the object,
// and hands the bytes to the shared ingest pipeline for validate + DRM check +
// metadata + row insert. On any failure the orphaned Storage object is deleted
// and the route returns 422 with a user-facing message. Leaf never strips DRM
// (SPEC §3.5) — protected files are rejected, not unlocked.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  registerUploadedEpub,
  DrmProtectedError,
  InvalidEpubError,
} from "@/lib/books/ingest";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in first." },
      { status: 401 },
    );
  }

  let path: unknown;
  try {
    ({ path } = (await request.json()) as { path?: unknown });
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }
  if (typeof path !== "string" || path.length === 0) {
    return NextResponse.json({ error: "Missing upload path." }, { status: 400 });
  }

  // The object key must be this user's own `${uid}/<uuid>.epub`.
  const prefix = `${user.id}/`;
  const fileName = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  const bookId = fileName.replace(/\.epub$/i, "");
  if (
    !path.startsWith(prefix) ||
    path.includes("..") ||
    !fileName.endsWith(".epub") ||
    !UUID_RE.test(bookId)
  ) {
    return NextResponse.json(
      { error: "That upload path isn't yours." },
      { status: 403 },
    );
  }

  const supabase = await createClient();

  const { data: blob, error: downloadError } = await supabase.storage
    .from("epubs")
    .download(path);
  if (downloadError || !blob) {
    return NextResponse.json(
      { error: "Uploaded file not found. Please upload it again." },
      { status: 404 },
    );
  }

  try {
    const book = await registerUploadedEpub({
      userId: user.id,
      storagePath: path,
      bytes: await blob.arrayBuffer(),
    });
    return NextResponse.json(book, { status: 201 });
  } catch (err) {
    // Roll back the orphaned object (SPEC §3.5) whatever the failure.
    await supabase.storage.from("epubs").remove([path]);
    if (err instanceof DrmProtectedError || err instanceof InvalidEpubError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("register upload failed", err);
    return NextResponse.json(
      { error: "Could not save the book. Please try again." },
      { status: 500 },
    );
  }
}
