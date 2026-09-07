import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rendition } from "epubjs";
import { createDebugProbe, DEBUG_TURN_LOG_SIZE } from "./debug";

// The probe is the *instrument* for DEFECTS.md D2. If its arithmetic is wrong
// the founder's on-device capture is worthless, so the numbers it derives are
// pinned here against a fake rendition shaped like epub.js's internals.

type Handler = (...args: unknown[]) => void;

function fakeRendition(doc: Document) {
  const handlers = new Map<string, Set<Handler>>();
  const contentHooks: Handler[] = [];

  const container = {
    scrollLeft: 2478,
    offsetWidth: 413,
    scrollWidth: 3304,
    clientWidth: 413,
    offsetHeight: 736,
  };
  const layout = {
    delta: 413,
    pageWidth: 413,
    columnWidth: 413,
    gap: 0,
    height: 736,
    width: 413,
    divisor: 1,
  };
  const view = {
    section: { index: 14, href: "text/part0013.html" },
    iframe: null,
    element: null,
    contents: { document: doc },
    width: () => 3304,
  };

  const rendition = {
    manager: { container, layout, views: { _views: [view] } },
    hooks: {
      content: {
        register: (fn: Handler) => contentHooks.push(fn),
        deregister: () => {},
      },
    },
    on: (type: string, fn: Handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    off: (type: string, fn: Handler) => handlers.get(type)?.delete(fn),
  } as unknown as Rendition;

  return {
    rendition,
    container,
    layout,
    emit(type: string, ...args: unknown[]) {
      for (const fn of handlers.get(type) ?? []) fn(...args);
    },
    triggerContent(contents: unknown) {
      for (const fn of contentHooks) fn(contents);
    },
  };
}

/** An epub.js `relocated` payload. */
function located(section: number, page: number, total: number) {
  return {
    start: {
      index: section,
      href: `text/part00${section - 1}.html`,
      cfi: `epubcfi(/6/${section}!/4/2/2)`,
      displayed: { page, total },
    },
  };
}

let clock = 0;

beforeEach(() => {
  clock = 0;
  vi.useFakeTimers();
  // Driven by hand: whether Vitest fakes `performance` varies, and the
  // late-image test turns on ordering against the layout timestamp.
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function probeFor(doc: Document, measured = { width: 412.57, height: 736 }) {
  const fake = fakeRendition(doc);
  const probe = createDebugProbe({
    rendition: fake.rendition,
    measure: () => measured,
    getSpread: () => "none",
  });
  return { ...fake, probe };
}

describe("debug probe — geometry", () => {
  it("reproduces epub.js's own advance test", () => {
    const doc = document.implementation.createHTMLDocument("c");
    const { probe, container } = probeFor(doc);

    // 2478 + 413 + 413 = 3304 <= 3304 → epub.js scrolls one more page.
    let snap = probe.snapshot();
    expect(snap.advanceLeft).toBe(3304);
    expect(snap.canAdvance).toBe(true);

    // One page further on: 3717 > 3304 → epub.js jumps to the next SECTION.
    container.scrollLeft = 2891;
    snap = probe.snapshot();
    expect(snap.advanceLeft).toBe(3717);
    expect(snap.canAdvance).toBe(false);
  });

  it("reports the layout numbers and the box relayout would pass", () => {
    const doc = document.implementation.createHTMLDocument("c");
    const { probe } = probeFor(doc);
    const snap = probe.snapshot();

    expect(snap.layout).toMatchObject({ delta: 413, pageWidth: 413, gap: 0, height: 736 });
    expect(snap.container).toMatchObject({ scrollLeft: 2478, offsetWidth: 413, scrollWidth: 3304 });
    // The fractional container measurement is the thing D2's first theory was
    // about — it must reach the readout unrounded.
    expect(snap.measuredBox).toEqual({ width: 412.57, height: 736 });
    expect(snap.view?.reportedWidth).toBe(3304);
  });
});

describe("debug probe — turn log", () => {
  it("keeps the before-state and flags a skipped last page", () => {
    const doc = document.implementation.createHTMLDocument("c");
    const { probe, emit } = probeFor(doc);

    emit("relocated", located(14, 7, 8));
    probe.logTurn("next", "tap-next");
    emit("relocated", located(15, 1, 6));

    const [turn] = probe.snapshot().turns;
    expect(turn.source).toBe("tap-next");
    expect(turn.before).toMatchObject({ section: 14, page: 7, total: 8, delta: 413 });
    expect(turn.after).toEqual({ section: 15, page: 1, total: 6 });
    // Left section 14 with a page still in it — the D2 signature.
    expect(turn.skipped).toBe(true);
  });

  it("does not flag a normal section change from the last page", () => {
    const doc = document.implementation.createHTMLDocument("c");
    const { probe, emit } = probeFor(doc);

    emit("relocated", located(14, 8, 8));
    probe.logTurn("next", "tap-next");
    emit("relocated", located(15, 1, 6));

    expect(probe.snapshot().turns[0].skipped).toBe(false);
  });

  it("records a turn that produced no relocation at all", () => {
    const doc = document.implementation.createHTMLDocument("c");
    const { probe, emit } = probeFor(doc);

    emit("relocated", located(14, 7, 8));
    probe.logTurn("next", "bar-next");
    vi.advanceTimersByTime(1000);

    const [turn] = probe.snapshot().turns;
    expect(turn.after).toBeNull();
    expect(turn.skipped).toBe(false);
  });

  it("rolls at the log size, newest first", () => {
    const doc = document.implementation.createHTMLDocument("c");
    const { probe, emit } = probeFor(doc);

    for (let i = 0; i < DEBUG_TURN_LOG_SIZE + 4; i += 1) {
      probe.logTurn("next", `t${i}`);
      emit("relocated", located(14, 2, 8));
    }
    const { turns } = probe.snapshot();
    expect(turns).toHaveLength(DEBUG_TURN_LOG_SIZE);
    expect(turns[0].source).toBe(`t${DEBUG_TURN_LOG_SIZE + 3}`);
  });
});

describe("debug probe — image timing (the D2 lead)", () => {
  function docWithImage() {
    const doc = document.implementation.createHTMLDocument("chapter");
    const img = doc.createElement("img");
    img.setAttribute("src", "images/peaches.jpg");
    doc.body.appendChild(img);
    return { doc, img };
  }

  it("counts an image that finished loading after the section was laid out", () => {
    const { doc, img } = docWithImage();
    const { probe, emit, container, triggerContent } = probeFor(doc);
    emit("relocated", located(14, 1, 8));

    triggerContent({ document: doc, sectionIndex: 14 });
    clock = 100;
    emit("rendered", { index: 14 }); // section measured here — scrollWidth 3304

    // The image arrives 412ms later, over the network, and grows the section.
    clock = 512;
    container.scrollWidth = 3717;
    img.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(100);

    const { images } = probe.snapshot();
    expect(images.total).toBe(1);
    expect(images.loadedAfterLayout).toBe(1);
    expect(images.lastLateMs).toBe(412);
    expect(images.scrollWidthAtLayout).toBe(3304);
    expect(images.scrollWidthAfterImages).toBe(3717);
  });

  it("does not call an image late when it loaded before layout", () => {
    const { doc, img } = docWithImage();
    const { probe, emit, triggerContent } = probeFor(doc);
    emit("relocated", located(14, 1, 8));

    triggerContent({ document: doc, sectionIndex: 14 });
    clock = 40;
    img.dispatchEvent(new Event("load"));
    clock = 100;
    emit("rendered", { index: 14 });
    vi.advanceTimersByTime(100);

    expect(probe.snapshot().images.loadedAfterLayout).toBe(0);
  });

  it("never takes over img.onload — epub.js owns it for its own re-flow", () => {
    // `epubjs/src/contents.js` does `img.onload = this.expand.bind(this)`.
    // Assigning it here would delete epub.js's re-layout and CAUSE the defect
    // this probe exists to observe.
    const { doc, img } = docWithImage();
    const { triggerContent } = probeFor(doc);
    triggerContent({ document: doc, sectionIndex: 14 });
    expect(img.onload).toBeNull();
  });

  it("stops observing after destroy", () => {
    const { doc, img } = docWithImage();
    const { probe, emit, triggerContent } = probeFor(doc);
    emit("relocated", located(14, 1, 8));
    triggerContent({ document: doc, sectionIndex: 14 });
    clock = 100;
    emit("rendered", { index: 14 });

    const seen: number[] = [];
    probe.onChange((s) => seen.push(s.images.loadedAfterLayout));
    probe.destroy();

    clock = 500;
    img.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(200);
    expect(seen).toHaveLength(0);
  });
});
