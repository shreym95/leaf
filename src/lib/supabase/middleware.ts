// updateSession — the proxy (formerly "middleware") helper that refreshes the
// Supabase auth session on every request and enforces route protection.
//
// Why this exists: Server Components cannot write cookies, so a refreshed access
// token would be lost without a layer that runs before rendering and writes
// Set-Cookie on the response. @supabase/ssr's createServerClient JSDoc is
// explicit that this layer is mandatory.
//
// Route protection lives HERE (single enforcement point) — see PROTECTED_PREFIXES.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const isSupabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** Route trees that require a signed-in user (SPEC §9 M1). */
const PROTECTED_PREFIXES = ["/library", "/settings", "/reader"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  // No env yet (founder wiring Supabase in parallel): don't touch auth, don't
  // redirect — just let every request through so SSR keeps working.
  if (!isSupabaseConfigured) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: no logic between createServerClient and getUser() — getUser()
  // triggers the token refresh whose cookies must land on `response`.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isProtected(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
