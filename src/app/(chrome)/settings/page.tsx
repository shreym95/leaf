import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getProfile, getReaderSettings } from "@/lib/db";
import { settingsFromRow } from "@/store/reader-settings";
import { AccountSection, CoverBackfill, ReadingSection } from "@/components/settings-ui";
import { ScreenView } from "@/components/analytics/ScreenView";

/* Auth-gated + per-user data: never prerender (`requireUser` reads cookies,
   which already forces dynamic). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings — Leaf",
};

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const [profile, settingsRow] = await Promise.all([
    getProfile(user.id).catch(() => null),
    getReaderSettings(user.id).catch(() => null),
  ]);
  const initialSettings = settingsFromRow(settingsRow);

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

      <section className="flex flex-col gap-3">
        <h2 className="font-mono font-medium uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]">
          Reading
        </h2>
        <ReadingSection userId={user.id} initialSettings={initialSettings} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono font-medium uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-2xs)]">
          Library
        </h2>
        <CoverBackfill />
      </section>
    </main>
  );
}
