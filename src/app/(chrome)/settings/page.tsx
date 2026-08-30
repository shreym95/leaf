import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getProfile } from "@/lib/db";
import { AccountSection } from "@/components/settings-ui";
import { ScreenView } from "@/components/analytics/ScreenView";

/* Auth-gated + per-user data: never prerender (`requireUser` reads cookies,
   which already forces dynamic). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings — Leaf",
};

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const profile = await getProfile(user.id).catch(() => null);

  const displayName =
    profile?.display_name ??
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <ScreenView name="settings" />
      <header className="flex flex-col gap-2">
        <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
          Settings
        </p>
        <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
          Your account
        </h1>
      </header>

      <AccountSection email={user.email ?? null} displayName={displayName} />
    </main>
  );
}
