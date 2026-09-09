// Root proxy (Next.js 16 renamed the `middleware` file convention to `proxy`;
// same semantics, runs before every matched route). See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
//
// Delegates to updateSession, which:
//   1. refreshes the Supabase auth session and writes rotated cookies, and
//   2. redirects unauthenticated users away from protected routes
//      (/library, /settings, /reader/*) to /login?next=…
//
// /login, /auth/*, /styleguide and the root redirect stay public.

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { IS_DEMO } from "@/lib/demo/flag";

export async function proxy(request: NextRequest) {
  // Demo mode has no Supabase and no session, so `updateSession` would bounce
  // every protected route to /login — including /library and /reader/*, which
  // are the two routes demo mode exists to serve (docs/DESIGN-LOCAL.md). Skip
  // it entirely; `requireUser` returns the fixture user from here on.
  //
  // Safe in production by construction: `IS_DEMO` is false whenever Supabase is
  // configured and `LEAF_DEMO` is unset, which is exactly the deployed state.
  // See `src/lib/demo/flag.ts` and its test.
  if (IS_DEMO) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every request path except:
     * - _next/static, _next/image  (build assets)
     * - favicon.ico, /icon, /apple-icon, robots.txt, sitemap.xml
     * - common static file extensions
     * Auth cookies must still be refreshable on real navigations, so pages are
     * included.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
