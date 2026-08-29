"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Client sign-in control. Kicks off Supabase Google OAuth; on success the
 * browser is sent to Google and back to `/auth/callback` (see route.ts), which
 * exchanges the code and redirects on to `next` (or `/library`).
 *
 * Degrades gracefully: if the Supabase env is not wired yet (`configured` is
 * false) the button is disabled with an explanatory line instead of crashing.
 */
export function GoogleSignInButton({
  next,
  configured,
  initialError,
}: {
  next?: string;
  configured: boolean;
  initialError?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

  async function signIn() {
    setError(undefined);
    setPending(true);
    try {
      const supabase = createClient();
      const callback = new URL("/auth/callback", window.location.origin);
      const safeNext = safeNextPath(next, "");
      if (safeNext) {
        callback.searchParams.set("next", safeNext);
      }
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.toString() },
      });
      if (oauthError) {
        setError(oauthError.message);
        setPending(false);
      }
      // On success the browser navigates away; no need to clear `pending`.
    } catch {
      setError("Sign-in is not available yet. Check back soon.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        onClick={signIn}
        disabled={!configured || pending}
        aria-disabled={!configured || pending}
        size="md"
      >
        {pending ? "Redirecting…" : "Continue with Google"}
      </Button>

      {!configured && (
        <p
          className="max-w-xs font-ui text-ink-mid [font-size:var(--leaf-text-sm)]"
          role="status"
        >
          Sign-in isn&rsquo;t configured yet — the Supabase connection is still
          being set up.
        </p>
      )}

      {error && (
        <p
          className="max-w-xs font-ui text-accent [font-size:var(--leaf-text-sm)]"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
