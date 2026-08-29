// POST /api/upload/sign — mint a one-time signed upload URL so the browser can
// PUT an EPUB straight into Supabase Storage (SPEC §6). Direct-to-Storage is
// required: Vercel caps serverless request bodies at 4.5MB and illustrated
// EPUBs routinely exceed that, so the bytes must never pass through a Route
// Handler.
//
// Auth is enforced here (the proxy only guards page routes, not /api). The
// object key is `${userId}/${uuid}.epub` — the first path segment is the owner,
// which is exactly what the `epubs` bucket RLS checks
// (supabase/migrations/0001_init.sql). `userId` is taken from the verified
// session, never from the client.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "You need to sign in first." }, { status: 401 });
  }

  const bookId = crypto.randomUUID();
  const path = `${user.id}/${bookId}.epub`;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("epubs")
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json(
      { error: "Could not start the upload. Please try again." },
      { status: 502 },
    );
  }

  // `data.path` is the same relative key we passed in; echo it back so the
  // client uploads and registers against one canonical value.
  return NextResponse.json({ path: data.path, token: data.token, bookId });
}
