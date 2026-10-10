// Group progress reporting (GROUPS_V1_BUILD.md L1, L5, L6). The db layer, outbox
// and Supabase client are mocked; the engine's `relocated` stream is driven
// through a fake controller.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/groups/flag", () => ({
  get GROUPS_ENABLED() {
    return h.enabled;
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
    },
  })),
}));

vi.mock("@/lib/db/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/groups")>();
  return {
    ...actual,
    findReadForBook: vi.fn(async () => []),
    setGroupProgress: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/offline/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/outbox")>();
  return {
    ...actual,
    enqueueGroupProgress: vi.fn(async () => {}),
    enqueueReadingState: vi.fn(async () => {}),
    resolveUserId: vi.fn(async () => "u1"),
  };
});

import { createClient } from "@/lib/supabase/client";
import { findReadForBook, setGroupProgress, type BookRead } from "@/lib/db/groups";
import { enqueueGroupProgress, resolveUserId } from "@/lib/offline/outbox";
import type { Alignment, Outline } from "@/lib/groups/types";
import type { ReaderController, ReaderLocation } from "./engine";
import { trackGroupProgress } from "./group-progress";

type RelocatedCb = (loc: ReaderLocation) => void;

function makeController(): ReaderController & {
  _emit: RelocatedCb;
  _subs: Set<RelocatedCb>;
} {
  const subs = new Set<RelocatedCb>();
  return {
    onRelocated: vi.fn((cb: RelocatedCb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    _emit: (l: ReaderLocation) => subs.forEach((cb) => cb(l)),
    _subs: subs,
  } as unknown as ReaderController & { _emit: RelocatedCb; _subs: Set<RelocatedCb> };
}

function loc(over: Partial<ReaderLocation>): ReaderLocation {
  return { cfi: "epubcfi(/6/2)", percent: 0.1, ...over };
}

const outline: Outline = [0, 1, 2, 3].map((i) => ({
  index: i,
  label: `Chapter ${i + 1}`,
  depth: 0,
  partIndex: null,
  partLabel: null,
  href: `text/ch${i + 1}.xhtml`,
}));

function alignmentFor(prefix: string): Alignment {
  const hrefs = [1, 2, 3, 4].map((n) => `${prefix}ch${n}.xhtml#top`);
  return {
    map: Object.fromEntries(hrefs.map((x, i) => [x, i])),
    copyHrefs: hrefs,
    confidence: 1,
    identity: false,
  };
}

function bookRead(alignment: Alignment | null, id = "r1"): BookRead {
  return {
    read: { id, outline } as unknown as BookRead["read"],
    copy: { readId: id, bookId: "b1", contentSha256: null, alignment },
  };
}

const DEBOUNCE = 1500;

const transportError = () => new TypeError("Failed to fetch");
const rlsError = () => Object.assign(new Error("denied"), { code: "42501" });

function expectNothingSent(): void {
  expect(setGroupProgress).not.toHaveBeenCalled();
  expect(enqueueGroupProgress).not.toHaveBeenCalled();
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  h.enabled = true;
  vi.mocked(findReadForBook).mockReset().mockResolvedValue([]);
  vi.mocked(setGroupProgress).mockReset().mockResolvedValue(undefined);
  vi.mocked(enqueueGroupProgress).mockReset().mockResolvedValue(undefined);
  vi.mocked(resolveUserId).mockReset().mockResolvedValue("u1");
  vi.mocked(createClient).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trackGroupProgress", () => {
  it("flag off: no client, no query, no listeners, no enqueue", async () => {
    h.enabled = false;
    const addDoc = vi.spyOn(document, "addEventListener");
    const addWin = vi.spyOn(window, "addEventListener");
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    expect(c.onRelocated).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(resolveUserId).not.toHaveBeenCalled();
    expect(findReadForBook).not.toHaveBeenCalled();
    expect(addDoc).not.toHaveBeenCalled();
    expect(addWin).not.toHaveBeenCalled();
    t.stop();
    expectNothingSent();
    addDoc.mockRestore();
    addWin.mockRestore();
  });

  it("looks the book up once and enqueues nothing when it has no links", async () => {
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch1.xhtml", sectionFraction: 0.5 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    t.stop();
    expect(findReadForBook).toHaveBeenCalledTimes(1);
    expect(findReadForBook).toHaveBeenCalledWith("u1", "b1", expect.anything());
    expectNothingSent();
  });

  it("maps a relocation to outline coordinates and writes directly after the debounce", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch3.xhtml", sectionFraction: 0.5 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    expectNothingSent();
    await vi.advanceTimersByTimeAsync(1);
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    expect(setGroupProgress).toHaveBeenCalledWith(
      {
        userId: "u1",
        readId: "r1",
        chapterIndex: 2,
        chapterFraction: 0.5,
        percent: 0.625,
        finishedAt: null,
      },
      expect.anything(),
    );
    expect(enqueueGroupProgress).not.toHaveBeenCalled();
    t.stop();
  });

  it("debounces: only the latest of several quick relocations is sent", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch1.xhtml", sectionFraction: 0.1 }));
    await vi.advanceTimersByTimeAsync(500);
    c._emit(loc({ spineHref: "text/ch2.xhtml", sectionFraction: 0.2 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    expect(setGroupProgress).toHaveBeenCalledWith(
      expect.objectContaining({ chapterIndex: 1, chapterFraction: 0.2 }),
      expect.anything(),
    );
    t.stop();
  });

  it("skips locations without a spine href or section fraction", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch2.xhtml" }));
    c._emit(loc({ sectionFraction: 0.4 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    t.stop();
    expectNothingSent();
  });

  it("an href that is not in the TOC enqueues nothing (never chapter 0)", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/colophon.xhtml", sectionFraction: 0.3 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    t.stop();
    expectNothingSent();
  });

  it("skips a read whose copy has no alignment", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(null)]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch1.xhtml", sectionFraction: 0.3 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    t.stop();
    expectNothingSent();
  });

  it("falls back to a unique final-segment match when directories differ", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("OEBPS/text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch2.xhtml", sectionFraction: 0.25 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    t.stop();
    expect(setGroupProgress).toHaveBeenCalledWith(
      expect.objectContaining({ chapterIndex: 1, chapterFraction: 0.25 }),
      expect.anything(),
    );
  });

  it("does not guess when the final segment is ambiguous", async () => {
    const hrefs = ["a/ch1.xhtml", "b/ch1.xhtml"];
    const alignment: Alignment = {
      map: { [hrefs[0]]: 0, [hrefs[1]]: 1 },
      copyHrefs: hrefs,
      confidence: 1,
      identity: false,
    };
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignment)]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "c/ch1.xhtml", sectionFraction: 0.5 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    t.stop();
    expectNothingSent();
  });

  it("a page turn that lands before the lookup resolves is still reported", async () => {
    let resolveLookup!: (v: BookRead[]) => void;
    vi.mocked(findReadForBook).mockReturnValue(
      new Promise<BookRead[]>((r) => {
        resolveLookup = r;
      }),
    );
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch1.xhtml", sectionFraction: 0.5 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expectNothingSent();
    resolveLookup([bookRead(alignmentFor("text/"))]);
    await settle();
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it("signed out: no query, no enqueue", async () => {
    vi.mocked(resolveUserId).mockResolvedValue(null);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch1.xhtml", sectionFraction: 0.5 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    t.stop();
    expect(findReadForBook).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it("offline at start: no query for this session", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    t.stop();
    expect(findReadForBook).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("stop() flushes the pending position once and unsubscribes", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch2.xhtml", sectionFraction: 0.5 }));
    t.stop();
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    expect(c._subs.size).toBe(0);
    t.stop();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    expect(enqueueGroupProgress).not.toHaveBeenCalled();
  });

  it("page hide flushes the pending position to the outbox, not the network", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch2.xhtml", sectionFraction: 0.5 }));
    window.dispatchEvent(new Event("pagehide"));
    expect(enqueueGroupProgress).toHaveBeenCalledTimes(1);
    expect(enqueueGroupProgress).toHaveBeenCalledWith(
      expect.objectContaining({ readId: "r1", chapterIndex: 1, chapterFraction: 0.5 }),
    );
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(enqueueGroupProgress).toHaveBeenCalledTimes(1);
    expect(setGroupProgress).not.toHaveBeenCalled();
    t.stop();
  });

  it("visibility hidden flushes to the outbox, not the network", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref: "text/ch2.xhtml", sectionFraction: 0.5 }));
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();
    expect(enqueueGroupProgress).toHaveBeenCalledTimes(1);
    expect(setGroupProgress).not.toHaveBeenCalled();
    t.stop();
  });

  it("a throwing lookup never throws and leaves a sibling tracker working (L6)", async () => {
    vi.mocked(findReadForBook).mockRejectedValue(new Error("boom"));
    const c = makeController();
    const sibling = vi.fn();
    c.onRelocated(sibling);
    let t!: ReturnType<typeof trackGroupProgress>;
    expect(() => {
      t = trackGroupProgress(c, { bookId: "b1" });
    }).not.toThrow();
    await settle();
    expect(() => {
      c._emit(loc({ spineHref: "text/ch1.xhtml", sectionFraction: 0.5 }));
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(sibling).toHaveBeenCalledTimes(1);
    expect(() => t.stop()).not.toThrow();
    expectNothingSent();
  });

  it("a failing write or enqueue never throws and leaves a sibling tracker working (L6)", async () => {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const sibling = vi.fn();
    c.onRelocated(sibling);
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();

    // Transport failure whose fallback enqueue rejects.
    vi.mocked(setGroupProgress).mockRejectedValueOnce(transportError());
    vi.mocked(enqueueGroupProgress).mockRejectedValueOnce(new Error("idb"));
    c._emit(loc({ spineHref: "text/ch1.xhtml", sectionFraction: 0.1 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    // Transport failure whose fallback enqueue throws synchronously.
    vi.mocked(setGroupProgress).mockRejectedValueOnce(transportError());
    vi.mocked(enqueueGroupProgress).mockImplementationOnce(() => {
      throw new Error("sync");
    });
    expect(() => {
      c._emit(loc({ spineHref: "text/ch2.xhtml", sectionFraction: 0.2 }));
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    // The write itself throws synchronously.
    vi.mocked(setGroupProgress).mockImplementationOnce(() => {
      throw new Error("sync write");
    });
    c._emit(loc({ spineHref: "text/ch3.xhtml", sectionFraction: 0.3 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(sibling).toHaveBeenCalledTimes(3);
    expect(setGroupProgress).toHaveBeenCalledTimes(3);
    expect(enqueueGroupProgress).toHaveBeenCalledTimes(3);
    expect(() => t.stop()).not.toThrow();
  });
});

describe("trackGroupProgress delivery", () => {
  async function readingAt(spineHref = "text/ch2.xhtml", sectionFraction = 0.5) {
    vi.mocked(findReadForBook).mockResolvedValue([bookRead(alignmentFor("text/"))]);
    const c = makeController();
    const t = trackGroupProgress(c, { bookId: "b1" });
    await settle();
    c._emit(loc({ spineHref, sectionFraction }));
    return { c, t };
  }

  it("direct write succeeds: nothing is queued", async () => {
    const { t } = await readingAt();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    expect(enqueueGroupProgress).not.toHaveBeenCalled();
    t.stop();
  });

  it("transport failure: the same payload is queued once", async () => {
    vi.mocked(setGroupProgress).mockRejectedValue(transportError());
    const { t } = await readingAt();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    expect(enqueueGroupProgress).toHaveBeenCalledTimes(1);
    expect(enqueueGroupProgress).toHaveBeenCalledWith(
      vi.mocked(setGroupProgress).mock.calls[0][0],
    );
    t.stop();
  });

  it("rejection (RLS): neither retried nor queued", async () => {
    vi.mocked(setGroupProgress).mockRejectedValue(rlsError());
    const { t } = await readingAt();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);
    t.stop();
    await settle();
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    expect(enqueueGroupProgress).not.toHaveBeenCalled();
  });

  it("offline: queued without a network attempt", async () => {
    const { t } = await readingAt();
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    spy.mockRestore();
    expect(setGroupProgress).not.toHaveBeenCalled();
    expect(enqueueGroupProgress).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it("a slow failure does not queue a position a newer write superseded", async () => {
    let failFirst!: (e: unknown) => void;
    vi.mocked(setGroupProgress)
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            failFirst = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const { c, t } = await readingAt("text/ch1.xhtml", 0.1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    c._emit(loc({ spineHref: "text/ch2.xhtml", sectionFraction: 0.2 }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(setGroupProgress).toHaveBeenCalledTimes(2);
    failFirst(transportError());
    await settle();
    expect(enqueueGroupProgress).not.toHaveBeenCalled();
    t.stop();
  });

  it("stop() sends the last position directly", async () => {
    const { t } = await readingAt();
    t.stop();
    expect(setGroupProgress).toHaveBeenCalledTimes(1);
    expect(enqueueGroupProgress).not.toHaveBeenCalled();
  });
});

describe("trackGroupProgress in demo mode", () => {
  it("makes no calls (the real flag is off when IS_DEMO)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/demo/flag", () => ({ IS_DEMO: true }));
    vi.doUnmock("@/lib/groups/flag");
    vi.stubEnv("NEXT_PUBLIC_LEAF_GROUPS", "1");
    try {
      const mod = await import("./group-progress");
      const db = await import("@/lib/db/groups");
      const c = makeController();
      const t = mod.trackGroupProgress(c, { bookId: "b1" });
      await settle();
      expect(c.onRelocated).not.toHaveBeenCalled();
      expect(db.findReadForBook).not.toHaveBeenCalled();
      t.stop();
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock("@/lib/demo/flag");
      vi.doMock("@/lib/groups/flag", () => ({
        get GROUPS_ENABLED() {
          return h.enabled;
        },
      }));
    }
  });
});
