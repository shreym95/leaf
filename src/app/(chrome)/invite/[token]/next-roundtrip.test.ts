import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("invite sign-in round trip", () => {
  it("the login next param keeps an invite path", () => {
    // The proxy sets next=/invite/<token>; searchParams decodes it for login
    // and the auth callback, which both pass it through safeNextPath.
    const next = new URLSearchParams(
      `next=${encodeURIComponent("/invite/AbC_123-xyz")}`,
    ).get("next");
    expect(safeNextPath(next)).toBe("/invite/AbC_123-xyz");
  });
});
