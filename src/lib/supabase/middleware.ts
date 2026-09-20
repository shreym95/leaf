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
import type { User } from "@supabase/supabase-js";
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

  // A signed-out visitor carries no Supabase auth cookie, so there is nothing to
  // validate or refresh — skip the round trip to the auth server entirely and
  // just apply route protection. Every page is server-rendered, so this saves a
  // full network hop on each public page view.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  if (!hasAuthCookie) {
    const { pathname, search } = request.nextUrl;
    if (isProtected(pathname)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }
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
  //
  // Wrapped, because this is a live call to Supabase's auth server on every
  // request that carries a session cookie. If it throws — Supabase down, DNS
  // failure, a timeout — an unwrapped await here rejects the proxy and every
  // protected route answers 500. `src/lib/auth.ts` already catches the same
  // call and degrades to "signed out"; this did not, and the asymmetry was the
  // bug: the app went from "sign in again" to "completely broken" for a
  // transient upstream failure.
  //
  // A thrown call tells us nothing about the session, so treat it as unknown
  // rather than as signed out: let the request through with the cookies it
  // arrived with. The page's own `requireUser` still guards the data — it makes
  // the same call server-side and redirects to /login if it also fails — so
  // this cannot leak a protected page to someone without a session. It only
  // avoids turning a blip into a 500 at the edge.
  let user: User | null = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch {
    return response;
  }

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
