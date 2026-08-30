import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.refresh, push: vi.fn() }),
}));

vi.mock("@/lib/upload-client", () => ({
  uploadEpub: vi.fn(),
  UploadError: class UploadError extends Error {},
}));

import { EmptyState } from "./EmptyState";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmptyState", () => {
  it("renders a calm headline", () => {
    render(<EmptyState />);
    expect(
      screen.getByRole("heading", { name: /your shelf is empty/i }),
    ).toBeInTheDocument();
  });

  it("offers real CTAs: starter books, search, and upload", () => {
    render(<EmptyState />);
    expect(
      screen.getByRole("button", { name: /add starter books/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /find a book/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload epub/i }),
    ).toBeInTheDocument();
  });

  it("POSTs to the seed route and refreshes on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ added: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<EmptyState />);
    await userEvent.click(
      screen.getByRole("button", { name: /add starter books/i }),
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/library/seed", {
      method: "POST",
    });
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());

    vi.unstubAllGlobals();
  });
});
