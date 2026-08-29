import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { GoogleSignInButton } from "./GoogleSignInButton";

/* Auth-gated screen: reads cookies, never prerendered. */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  const user = await getUser();
  if (user) {
    redirect(safeNextPath(next));
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="font-mono font-medium uppercase text-accent [letter-spacing:var(--leaf-tracking-eyebrow)] [font-size:var(--leaf-text-2xs)]">
          Leaf
        </p>
        <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
          Sign in
        </h1>
        <p className="max-w-sm font-ui text-ink-mid [font-size:var(--leaf-text-lg)] [line-height:var(--leaf-leading-body)]">
          Your library, reading position, and highlights follow you across
          devices.
        </p>
      </div>

      <GoogleSignInButton
        next={next}
        configured={isSupabaseConfigured}
        initialError={error === "auth" ? "Sign-in failed. Please try again." : undefined}
      />
    </main>
  );
}
