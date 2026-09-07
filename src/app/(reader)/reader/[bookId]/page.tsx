import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBook, getReaderSettings } from "@/lib/db";
import { signBookUrl } from "@/lib/storage";
import { ReaderShell, debugRequested } from "@/components/reader-ui";
import { settingsFromRow } from "@/store/reader-settings";

/* Auth-gated + per-user data + a short-lived signed URL: never prerender. */
export const dynamic = "force-dynamic";

export default async function ReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ bookId }, query] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/reader/${bookId}`);

  const [book, settingsRow] = await Promise.all([
    getBook(user.id, bookId),
    getReaderSettings(user.id).catch(() => null),
  ]);

  if (!book || !book.storage_path) {
    notFound();
  }

  // The client fetches the EPUB bytes from this signed URL (keeps the server
  // light; epub.js needs an ArrayBuffer, not a URL — see engine.ts).
  const fileUrl = await signBookUrl(user.id, book.storage_path);

  const initialSettings = settingsFromRow(settingsRow);

  return (
    <ReaderShell
      bookId={book.id}
      title={book.title}
      author={book.author}
      fileUrl={fileUrl}
      userId={user.id}
      initialSettings={initialSettings}
      // TEMPORARY, opt-in only: `/reader/<bookId>?debug=1` paints the D2
      // instrumentation readout (DEFECTS.md D2). Nothing changes without it.
      debug={debugRequested(query)}
    />
  );
}
