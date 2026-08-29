import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBook } from "@/lib/db";
import { signBookUrl } from "@/lib/storage";
import { ReaderBootstrap } from "@/components/reader-ui/ReaderBootstrap";

/* Auth-gated + per-user data + a short-lived signed URL: never prerender. */
export const dynamic = "force-dynamic";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;
  const user = await requireUser(`/reader/${bookId}`);

  const book = await getBook(user.id, bookId);
  if (!book || !book.storage_path) {
    notFound();
  }

  const fileUrl = await signBookUrl(user.id, book.storage_path);

  return <ReaderBootstrap fileUrl={fileUrl} title={book.title} />;
}
