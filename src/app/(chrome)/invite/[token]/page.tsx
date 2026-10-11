import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import { InviteScreen } from "@/components/groups-ui";

/* Auth-gated and spends a single-use link: never prerender. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join group — Leaf",
  // Invite links are private; keep them out of search indexes.
  robots: { index: false, follow: false },
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!GROUPS_ENABLED) notFound();
  const { token } = await params;
  // The proxy sends signed-out visitors to /login?next=/invite/<token>; this
  // guards the page itself.
  await requireUser(`/invite/${token}`);
  return <InviteScreen token={token} />;
}
