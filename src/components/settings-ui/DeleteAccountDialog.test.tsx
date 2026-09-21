import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { purgeAllOfflineData } from "@/lib/offline/purge";

vi.mock("@/lib/offline/purge", () => ({
  purgeAllOfflineData: vi.fn(),
}));

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

async function confirmDelete() {
  const user = userEvent.setup();
  render(<DeleteAccountDialog />);

  await user.click(screen.getByRole("button", { name: "Delete account…" }));
  await user.type(await screen.findByLabelText(/type delete to confirm/i), "DELETE");
  await user.click(screen.getByRole("button", { name: /permanently delete/i }));
}

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  vi.mocked(purgeAllOfflineData).mockReset();
  vi.mocked(purgeAllOfflineData).mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }),
  );
});

describe("DeleteAccountDialog", () => {
  it("purges offline data, then navigates away, once the server confirms deletion", async () => {
    const order: string[] = [];
    vi.mocked(purgeAllOfflineData).mockImplementation(async () => {
      order.push("purge");
    });
    replace.mockImplementation(() => order.push("replace"));

    await confirmDelete();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(purgeAllOfflineData).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The purge must be under way (and awaited) before the navigation away,
    // matching the sign-out ordering: fire-then-immediately-navigate would
    // risk the SPA transition cutting the purge off mid-flight.
    expect(order).toEqual(["purge", "replace"]);
  });

  it("still navigates away if the purge rejects — deletion must not get stuck on a purge problem", async () => {
    vi.mocked(purgeAllOfflineData).mockRejectedValue(new Error("storage blocked"));

    await confirmDelete();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not purge when the server rejects the deletion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "nope" }),
      }),
    );

    await confirmDelete();

    await screen.findByRole("alert");
    expect(purgeAllOfflineData).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
