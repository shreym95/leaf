// The proxy had no tests at all until this file. It matters more than its size
// suggests: it runs before every protected route, and an unhandled rejection
// here answers 500 for the whole app rather than degrading.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
}));

/** A request carrying a Supabase session cookie, so the auth path is taken. */
function signedInRequest(pathname: string): NextRequest {
  const req = new NextRequest(new URL(`https://leaf.test${pathname}`));
  req.cookies.set("sb-abcdefgh-auth-token", "a-token");
  return req;
}

describe("updateSession", () => {
  beforeEach(() => {
    vi.resetModules();
    getUser.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  it("lets a signed-in request through", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const { updateSession } = await import("./middleware");
    const res = await updateSession(signedInRequest("/library"));
    expect(res.status).toBe(200);
  });

  it("redirects to /login when the session is not valid", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { updateSession } = await import("./middleware");
    const res = await updateSession(signedInRequest("/reader/b1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Freader%2Fb1");
  });

  it("does not 500 the whole app when the auth server is unreachable", async () => {
    // The bug this file was written for. `getUser()` is a live network call on
    // every request carrying a session cookie; unwrapped, a Supabase outage or
    // a DNS blip rejected the proxy and every protected route answered 500.
    // `src/lib/auth.ts` already caught the same call — the asymmetry was the bug.
    getUser.mockRejectedValue(new Error("fetch failed"));
    const { updateSession } = await import("./middleware");

    const res = await updateSession(signedInRequest("/reader/b1"));

    expect(res.status).toBe(200);
    // Deliberately NOT a redirect: a thrown call says nothing about the session,
    // so treat it as unknown rather than as signed out. The page's own
    // `requireUser` still guards the data and redirects if it also fails.
    expect(res.headers.get("location")).toBeNull();
  });

  it("skips the network entirely when no auth cookie is present", async () => {
    const { updateSession } = await import("./middleware");
    const req = new NextRequest(new URL("https://leaf.test/library"));
    const res = await updateSession(req);
    expect(getUser).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
