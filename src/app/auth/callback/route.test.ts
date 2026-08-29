import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  exchange: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: true,
  createClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: h.exchange },
  })),
}));

import { GET } from "./route";

function req(path: string): NextRequest {
  return new Request(`http://localhost:3000${path}`) as unknown as NextRequest;
}

beforeEach(() => {
  h.exchange.mockReset();
});

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to /library by default", async () => {
    h.exchange.mockResolvedValue({ error: null });
    const res = await GET(req("/auth/callback?code=abc123"));
    expect(h.exchange).toHaveBeenCalledWith("abc123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/library");
  });

  it("honours a safe ?next= path", async () => {
    h.exchange.mockResolvedValue({ error: null });
    const res = await GET(req("/auth/callback?code=abc&next=/settings"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/settings");
  });

  it("ignores an off-site ?next= and falls back to /library", async () => {
    h.exchange.mockResolvedValue({ error: null });
    const res = await GET(req("/auth/callback?code=abc&next=https://evil.test"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/library");
  });

  it("redirects to /login?error=auth when the exchange fails", async () => {
    h.exchange.mockResolvedValue({ error: { message: "bad code" } });
    const res = await GET(req("/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?error=auth",
    );
  });

  it("redirects to /login?error=auth when no code is present", async () => {
    const res = await GET(req("/auth/callback"));
    expect(h.exchange).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?error=auth",
    );
  });

  it("redirects to /login?error=auth when the provider returns an error", async () => {
    const res = await GET(
      req("/auth/callback?error=access_denied&error_description=nope"),
    );
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?error=auth",
    );
  });
});
