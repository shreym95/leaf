import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Book } from "@/lib/types";

const h = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: h.uploadToSignedUrl }) },
  }),
}));

import { uploadEpub, UploadError } from "./upload-client";

const BOOK: Book = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "user-1",
  title: "Test Book",
  author: "A. Writer",
  source: "upload",
  source_ref: null,
  storage_path: "user-1/11111111-1111-4111-8111-111111111111.epub",
  cover_path: null,
  cover_url: null,
  status: "reading",
  added_at: "2026-08-29T00:00:00Z",
};

function epubFile(name = "book.epub", type = "application/epub+zip"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, { type });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** fetch stub that answers per-URL. */
function stubFetch(handlers: {
  sign?: () => Response;
  register?: () => Response;
}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/upload/sign")) {
      return Promise.resolve(
        handlers.sign?.() ??
          jsonResponse({ path: BOOK.storage_path, token: "tok", bookId: BOOK.id }),
      );
    }
    if (url.includes("/api/books/register")) {
      return Promise.resolve(
        handlers.register?.() ?? jsonResponse(BOOK, { status: 201 }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  h.uploadToSignedUrl.mockReset().mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadEpub", () => {
  it("rejects a non-.epub file before any network call", async () => {
    const fetchMock = stubFetch({});
    await expect(uploadEpub(epubFile("book.pdf", "application/pdf"))).rejects.toThrow(
      UploadError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects an obviously wrong mime type before any network call", async () => {
    const fetchMock = stubFetch({});
    await expect(
      uploadEpub(epubFile("book.epub", "text/html")),
    ).rejects.toThrow(/EPUB/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs, uploads to Storage, registers, and returns the Book", async () => {
    const fetchMock = stubFetch({});
    const progress: number[] = [];

    const book = await uploadEpub(epubFile(), {
      onProgress: (p) => progress.push(p),
    });

    expect(book).toEqual(BOOK);
    expect(h.uploadToSignedUrl).toHaveBeenCalledWith(
      BOOK.storage_path,
      "tok",
      expect.any(File),
      expect.objectContaining({ contentType: "application/epub+zip" }),
    );
    // register was called with the signed path
    const registerCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/books/register"),
    );
    expect(JSON.parse((registerCall![1] as RequestInit).body as string)).toEqual({
      path: BOOK.storage_path,
    });
    expect(progress.at(-1)).toBe(100);
  });

  it("surfaces the server's error message when signing fails (401)", async () => {
    stubFetch({
      sign: () =>
        jsonResponse({ error: "You need to sign in first." }, { status: 401 }),
    });
    await expect(uploadEpub(epubFile())).rejects.toThrow("You need to sign in first.");
    expect(h.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("surfaces the server's DRM message when register returns 422", async () => {
    stubFetch({
      register: () =>
        jsonResponse(
          { error: "This EPUB is protected by DRM." },
          { status: 422 },
        ),
    });
    await expect(uploadEpub(epubFile())).rejects.toThrow(
      "This EPUB is protected by DRM.",
    );
  });

  it("surfaces a Storage upload failure", async () => {
    stubFetch({});
    h.uploadToSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "signature expired" },
    });
    await expect(uploadEpub(epubFile())).rejects.toThrow("signature expired");
  });
});
