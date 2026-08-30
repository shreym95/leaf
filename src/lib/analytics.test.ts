import { beforeEach, describe, expect, it, vi } from "vitest";

// The vendor's `track` is the only thing this module talks to — mock it and
// assert exactly what gets forwarded.
const track = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track }));

import {
  trackScreen,
  trackImport,
  trackUpload,
  trackHighlightCreated,
} from "./analytics";

beforeEach(() => {
  track.mockClear();
});

describe("analytics wrapper — forwards the right events", () => {
  it("trackScreen sends screen_view with just the screen name", () => {
    trackScreen("library");
    expect(track).toHaveBeenCalledWith("screen_view", { screen: "library" });
  });

  it("trackImport sends book_import with just the source", () => {
    trackImport({ source: "gutenberg" });
    expect(track).toHaveBeenCalledWith("book_import", { source: "gutenberg" });
  });

  it("trackUpload sends a bare book_upload", () => {
    trackUpload();
    expect(track).toHaveBeenCalledWith("book_upload", undefined);
  });

  it("trackHighlightCreated sends a bare highlight_created", () => {
    trackHighlightCreated();
    expect(track).toHaveBeenCalledWith("highlight_created", undefined);
  });
});

describe("analytics wrapper — cannot carry free-form content", () => {
  it("drops unexpected keys on an import payload (no title/cfi/etc. forwarded)", () => {
    trackImport({
      source: "standardebooks",
      // caller tries to smuggle content through — must not appear
      title: "Frankenstein; or, The Modern Prometheus",
      author: "Mary Shelley",
      cfi: "epubcfi(/6/4!/4/2/2)",
    } as unknown as { source: "standardebooks" });

    expect(track).toHaveBeenCalledTimes(1);
    const [, props] = track.mock.calls[0]!;
    expect(props).toEqual({ source: "standardebooks" });
    expect(Object.keys(props as object)).toEqual(["source"]);
  });

  it("drops an import event whose source is not an allow-listed value", () => {
    trackImport({ source: "user@example.com" } as unknown as {
      source: "gutenberg";
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("drops a screen event whose name is not an allow-listed screen", () => {
    trackScreen("Frankenstein by Mary Shelley" as unknown as "library");
    expect(track).not.toHaveBeenCalled();
  });

  it("never forwards a positional payload beyond the constructed props object", () => {
    // Even if a caller passes extra arguments, the wrapper's fixed arity means
    // they are ignored entirely.
    (trackScreen as (...a: unknown[]) => void)("reader", {
      bookId: "abc-123",
      email: "user@example.com",
    });
    expect(track).toHaveBeenCalledWith("screen_view", { screen: "reader" });
  });
});
