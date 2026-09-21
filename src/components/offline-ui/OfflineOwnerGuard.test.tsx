import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/offline/owner", () => ({
  enforceOfflineOwner: vi.fn(async () => {}),
}));

import { enforceOfflineOwner } from "@/lib/offline/owner";
import { OfflineOwnerGuard } from "./OfflineOwnerGuard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OfflineOwnerGuard", () => {
  it("runs the owner check once on mount and renders nothing", () => {
    const { container } = render(<OfflineOwnerGuard />);

    expect(enforceOfflineOwner).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });
});
