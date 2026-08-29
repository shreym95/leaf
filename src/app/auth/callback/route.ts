// OAuth callback (SPEC §3.3). Google redirects here with `?code=…`; we exchange
// it for a session (the @supabase/ssr server client writes the auth cookies via
// setAll — cookie writes are allowed in Route Handlers), then forward the user
// on to `next` (or `/library`).

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  // Supabase can also redirect back with an explicit error.
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");

  if (code && !oauthError) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        // Respect the proxy/CDN in front of the app when building the absolute URL.
        const forwardedHost = request.headers.get("x-forwarded-host");
        const forwardedProto = request.headers.get("x-forwarded-proto");
        const base =
          forwardedHost && process.env.NODE_ENV === "production"
            ? `${forwardedProto ?? "https"}://${forwardedHost}`
            : origin;
        return NextResponse.redirect(`${base}${next}`);
      }
    } catch {
      // fall through to the error redirect
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
