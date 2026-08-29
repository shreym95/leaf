// Sign-out (SPEC §3.3, a11y: POST, never a GET link).
// Clears the Supabase session cookies and returns to /login.

import { NextResponse, type NextRequest } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (isSupabaseConfigured) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      // best-effort: still send the user to /login
    }
  }
  // 303 so the browser issues a GET for /login after this POST.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
