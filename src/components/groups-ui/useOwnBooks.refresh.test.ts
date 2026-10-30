import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ order: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ order: h.order }) }),
      }),
    }),
  }),
}));

import { useOwnBooks } from "./useOwnBooks";

function row(id: string, title: string) {
  return { id, title, author: null, source: "upload", source_ref: null };
}

afterEach(() => {
  cleanup();
  h.order.mockReset();
});

describe("useOwnBooks refreshKey", () => {
  it("fetches the list again when the refresh key changes while enabled", async () => {
    h.order
      .mockResolvedValueOnce({ data: [row("b1", "Dune")], error: null })
      .mockResolvedValueOnce({
        data: [row("b1", "Dune"), row("b9", "New zine")],
        error: null,
      });

    const { result, rerender } = renderHook(
      ({ k }: { k: number }) => useOwnBooks("u2", true, k),
      { initialProps: { k: 0 } },
    );
    await waitFor(() => expect(result.current.kind).toBe("ready"));
    expect(h.order).toHaveBeenCalledTimes(1);

    rerender({ k: 1 });

    await waitFor(() => expect(h.order).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(result.current.kind).toBe("ready");
      if (result.current.kind !== "ready") return;
      expect(result.current.books.map((b) => b.id)).toEqual(["b1", "b9"]);
    });
  });
});
