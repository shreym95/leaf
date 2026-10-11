import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  flag: { enabled: true },
  requireUser: vi.fn(),
}));

vi.mock("@/lib/groups/flag", () => ({
  get GROUPS_ENABLED() {
    return h.flag.enabled;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({
  requireUser: (...args: unknown[]) => h.requireUser(...args),
}));

import InvitePage from "./page";

beforeEach(() => {
  h.flag.enabled = true;
  h.requireUser.mockReset();
  h.requireUser.mockResolvedValue({ id: "u1" });
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});

describe("invite page", () => {
  it("calls notFound when the flag is off, without checking the user", async () => {
    h.flag.enabled = false;
    await expect(
      InvitePage({ params: Promise.resolve({ token: "abc" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.requireUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a user, returning to the invite after sign-in", async () => {
    render(await InvitePage({ params: Promise.resolve({ token: "abc" }) }));
    expect(h.requireUser).toHaveBeenCalledWith("/invite/abc");
    expect(screen.getByRole("status")).toHaveTextContent("Joining…");
  });
});
