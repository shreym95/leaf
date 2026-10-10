// Route protection for the groups pages. They are protected only while the
// groups flag is on; with it off the proxy behaves exactly as before
// (GROUPS_V1_BUILD L1).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
}));

function signedOutRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`https://leaf.test${pathname}`));
}

/** A request carrying a session cookie that Supabase then rejects. */
function expiredSessionRequest(pathname: string): NextRequest {
  const req = signedOutRequest(pathname);
  req.cookies.set("sb-abcdefgh-auth-token", "a-token");
  return req;
}

async function loadUpdateSession(flag: "1" | "0" | undefined) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  if (flag === undefined) {
    vi.stubEnv("NEXT_PUBLIC_LEAF_GROUPS", "");
  } else {
    vi.stubEnv("NEXT_PUBLIC_LEAF_GROUPS", flag);
  }
  return (await import("./middleware")).updateSession;
}

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("updateSession with groups on", () => {
  it.each(["/groups", "/groups/abc", "/groups/abc/reads/r1", "/invite/sometoken"])(
    "redirects a signed-out visitor from %s to /login with next",
    async (path) => {
      const updateSession = await loadUpdateSession("1");
      const res = await updateSession(signedOutRequest(path));
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(path);
    },
  );

  it("redirects when the session cookie is present but not valid", async () => {
    const updateSession = await loadUpdateSession("1");
    const res = await updateSession(expiredSessionRequest("/invite/sometoken"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets a signed-in user through", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const updateSession = await loadUpdateSession("1");
    const res = await updateSession(expiredSessionRequest("/groups"));
    expect(res.status).toBe(200);
  });

  it("does not protect look-alike prefixes", async () => {
    const updateSession = await loadUpdateSession("1");
    expect((await updateSession(signedOutRequest("/groupsy"))).status).toBe(200);
    expect((await updateSession(signedOutRequest("/invited"))).status).toBe(200);
  });

  it("keeps the existing protected routes protected", async () => {
    const updateSession = await loadUpdateSession("1");
    expect((await updateSession(signedOutRequest("/library"))).status).toBe(307);
  });
});

describe("updateSession with groups off", () => {
  it.each([undefined, "0" as const])(
    "does not protect /groups or /invite (flag %s)",
    async (flag) => {
      const updateSession = await loadUpdateSession(flag);
      for (const path of ["/groups", "/groups/abc", "/invite/sometoken"]) {
        const res = await updateSession(signedOutRequest(path));
        expect(res.status).toBe(200);
        expect(res.headers.get("location")).toBeNull();
      }
    },
  );

  it("still protects the existing routes", async () => {
    const updateSession = await loadUpdateSession(undefined);
    for (const path of ["/library", "/settings", "/reader/b1"]) {
      expect((await updateSession(signedOutRequest(path))).status).toBe(307);
    }
  });
});
