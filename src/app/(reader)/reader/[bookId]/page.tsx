import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBook, getReaderSettings } from "@/lib/db";
import { signBookUrl } from "@/lib/storage";
import { ReaderShell } from "@/components/reader-ui";
import { READER_SETTINGS_DEFAULTS } from "@/store/reader-settings";

/* Auth-gated + per-user data + a short-lived signed URL: never prerender. */
export const dynamic = "force-dynamic";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;
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

  const initialSettings = settingsRow
    ? {
        fontFamily: settingsRow.font_family,
        fontSize: settingsRow.font_size,
        lineSpacing: settingsRow.line_spacing,
        margins: settingsRow.margins,
        theme: settingsRow.theme,
      }
    : { ...READER_SETTINGS_DEFAULTS };

  return (
    <ReaderShell
      bookId={book.id}
      title={book.title}
      author={book.author}
      fileUrl={fileUrl}
      userId={user.id}
      initialSettings={initialSettings}
    />
  );
}
