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

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
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
