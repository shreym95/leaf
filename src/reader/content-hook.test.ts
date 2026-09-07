// content-hook tests — epub.js is replaced by a hand-rolled mock rendition. We
// assert the three things the pipeline guarantees: the content hook is
// registered, each rendered chapter is normalized + gets the fine-press
// stylesheet, and settings changes flow through `refresh()` / teardown works.

import type { Rendition } from "epubjs";
import { describe, expect, it, vi } from "vitest";

import {
  registerContentPipeline,
  type ReaderContentSettings,
} from "./content-hook";
import { DEFAULT_THEME, THEME_IDS } from "@/design/themes";

const OZ = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>I: The Cyclone</title></head>
  <body>
    <section epub:type="chapter">
      <hgroup>
        <h2 epub:type="z3998:ordinal z3998:roman">I</h2>
        <p epub:type="title">The Cyclone</p>
      </hgroup>
      <p class="publisher-first">Dorothy lived in the midst of the great Kansas prairies.</p>
      <p>When Dorothy stood in the doorway she could see nothing but gray.</p>
    </section>
  </body>
</html>`;

const DAY: ReaderContentSettings = {
  fontFamily: "serif",
  fontSize: 1.06,
  lineSpacing: 1.62,
  margins: "normal",
  theme: "day",
};

type Handler = (a: unknown, b?: unknown) => void;

function makeRendition() {
  const handlers: Handler[] = [];
  const doc = new DOMParser().parseFromString(OZ, "application/xml");
  const contents = { document: doc, sectionIndex: 0 };

  const themes = {
    register: vi.fn(),
    select: vi.fn(),
    default: vi.fn(),
    override: vi.fn(),
    font: vi.fn(),
    fontSize: vi.fn(),
  };

  const rendition = {
    themes,
    hooks: {
      content: {
        register: vi.fn((fn: Handler) => handlers.push(fn)),
        deregister: vi.fn((fn: Handler) => {
          const i = handlers.indexOf(fn);
          if (i >= 0) handlers.splice(i, 1);
        }),
      },
    },
    getContents: () => [contents],
    book: {
      packaging: {
        metadata: { title: "The Wonderful Wizard of Oz", creator: "L. Frank Baum" },
      },
      spine: { length: 24 },
    },
  };

  return { rendition: rendition as unknown as Rendition, themes, handlers, contents, doc };
}

describe("registerContentPipeline", () => {
  it("registers exactly one content hook", () => {
    const { rendition, handlers } = makeRendition();
    registerContentPipeline(rendition, () => DAY);
    expect(handlers).toHaveLength(1);
  });

  it("normalizes each rendered chapter and injects the fine-press stylesheet", () => {
    const { rendition, handlers, contents, doc } = makeRendition();
    registerContentPipeline(rendition, () => DAY);

    handlers[0](contents, rendition);

    // Normalizer ran over contents.document.
    expect(doc.querySelector(".chapter-ordinal")?.textContent).toBe("I");
    expect(doc.querySelector(".chapter-title")?.textContent).toBe("The Cyclone");
    expect(doc.querySelector("p.para.first")).not.toBeNull();
    expect(doc.querySelector("hgroup")).toBeNull();

    // Fine-press + settings stylesheet injected once, into the chapter doc.
    const styles = doc.querySelectorAll('style[id="leaf-content-pipeline"]');
    expect(styles).toHaveLength(1);
    const css = styles[0].textContent ?? "";
    expect(css).toContain(".para.first::first-letter");
    expect(css).toContain(".chapter-ordinal");
    expect(css).toContain("font-size:1.06rem");
    expect(css).toContain("max-width:34rem");
  });

  it("is idempotent across re-triggers — no duplicate <style>, no double-wrap", () => {
    const { rendition, handlers, contents, doc } = makeRendition();
    registerContentPipeline(rendition, () => DAY);

    handlers[0](contents, rendition);
    handlers[0](contents, rendition);

    expect(doc.querySelectorAll('style[id="leaf-content-pipeline"]')).toHaveLength(1);
    expect(doc.querySelectorAll("article.chapter")).toHaveLength(1);
  });

  it("refresh() re-injects the stylesheet for the new settings", () => {
    const { rendition, handlers, contents, doc } = makeRendition();
    let settings = DAY;
    const pipeline = registerContentPipeline(rendition, () => settings);

    handlers[0](contents, rendition);
    const before =
      doc.querySelector('style[id="leaf-content-pipeline"]')?.textContent ?? "";
    expect(before).toContain("font-size:1.06rem");
    expect(before).toContain("#f1ebdc"); // day paper

    settings = { ...DAY, theme: "night", fontSize: 1.25, margins: "wide" };
    pipeline.refresh();

    const style = doc.querySelector('style[id="leaf-content-pipeline"]');
    const css = style?.textContent ?? "";
    expect(css).toContain("font-size:1.25rem");
    // "wide" margins = more side padding and a tighter measure
    expect(css).toContain("padding-left:2.75rem");
    expect(css).toContain("max-width:30rem");
    expect(css).toContain("#1a1611"); // night page — theme actually flipped
    expect(css).not.toContain("#f1ebdc");
    expect(css).toContain("!important"); // hard palette override present
    // still exactly one <style>, and it is the last child of its host
    const all = doc.querySelectorAll('style[id="leaf-content-pipeline"]');
    expect(all).toHaveLength(1);
    expect(style?.parentElement?.lastElementChild).toBe(style);
  });


  it("pins the reading size against publisher CSS that inflates a container", () => {
    // Real-world failure (an uploaded retail EPUB): the file set `font-size:2em`
    // on a container, our wrapper inherited it, and every paragraph rendered at
    // 2x. The stylesheet must reset containers AND pin `.chapter` itself.
    const { rendition, handlers, contents, doc } = makeRendition();
    registerContentPipeline(rendition, () => ({ ...DAY, fontSize: 1.26 }));
    handlers[0](contents, rendition);

    const css = doc.querySelector('style[id="leaf-content-pipeline"]')
      ?.textContent as string;

    // the wrapper is the size anchor, in absolute units
    expect(css).toMatch(/\.chapter\{[^}]*font-size:1\.26rem !important/);
    // every container a publisher could inflate is reset
    for (const sel of ["div", "section", "article", "main"]) {
      expect(css).toMatch(new RegExp(`(^|,)${sel}(,|\\{)`, "m"));
    }
    expect(css).toContain("font-size:1em !important");
    // …but our own eyebrow and title keep their own sizing
    expect(css).toContain("p:not(.chapter-ordinal):not(.chapter-title)");
  });


  it("normalises publisher weight, style and insets so files render alike", () => {
    // Same real-world class of failure as the size: an uploaded retail EPUB set
    // `font-weight:bold` on a container (every paragraph rendered bold), and
    // Gutenberg wraps content in divs with `margin:10%` plus hanging indents,
    // which stacked on top of the margins setting.
    const { rendition, handlers, contents, doc } = makeRendition();
    registerContentPipeline(rendition, () => ({ ...DAY, margins: "wide" }));
    handlers[0](contents, rendition);
    const css = doc.querySelector('style[id="leaf-content-pipeline"]')
      ?.textContent as string;

    expect(css).toContain("font-weight:400 !important");
    expect(css).toContain("font-style:normal !important");
    expect(css).toContain("margin-left:0 !important");
    expect(css).toContain("padding-left:0 !important");
    // real emphasis is markup and must survive the reset
    expect(css).toContain("strong,b{font-weight:700 !important}");
    expect(css).toContain("em,i{font-style:italic !important}");
    // paragraph indentation is ours, not the file's
    expect(css).toContain(".chapter .para{text-indent:1.35em !important}");
  });

  it("margins change the text column, not just a max-width", () => {
    // `max-width` alone is a no-op on a phone, where the column is far narrower
    // than any sane measure — the padding is what actually moves the text.
    const pad = (m: ReaderContentSettings["margins"]) => {
      const { rendition, handlers, contents, doc } = makeRendition();
      registerContentPipeline(rendition, () => ({ ...DAY, margins: m }));
      handlers[0](contents, rendition);
      const css = doc.querySelector('style[id="leaf-content-pipeline"]')
        ?.textContent as string;
      return /\.chapter\{[^}]*padding-left:([^ ;!]+)/.exec(css)?.[1];
    };

    const [narrow, normal, wide] = [pad("narrow"), pad("normal"), pad("wide")];
    expect(new Set([narrow, normal, wide]).size).toBe(3);
    expect(parseFloat(narrow!)).toBeLessThan(parseFloat(normal!));
    expect(parseFloat(normal!)).toBeLessThan(parseFloat(wide!));
  });

  it("degrades safely on a chapter with no structure (no throw, § fallback)", () => {
    const { rendition, handlers } = makeRendition();
    registerContentPipeline(rendition, () => DAY);

    const messy = new DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>Loose prose.</p></body></html>`,
      "application/xml",
    );

    expect(() =>
      handlers[0]({ document: messy, sectionIndex: 2 }, rendition),
    ).not.toThrow();
    expect(messy.querySelector(".chapter-ordinal")?.textContent).toBe("§");
    expect(messy.querySelector('style[id="leaf-content-pipeline"]')).not.toBeNull();
  });

  it("paints every registered theme distinctly, not just day and night", () => {
    // Regression: `themeId` was `s.theme === "night" ? "night" : "day"`, so any
    // theme the reader did not know about was painted as Day. Adding Sepia
    // would have turned the app chrome sepia and left the page white — the same
    // "the theme changed on its own" class of bug reported twice before.
    const css = (theme: ReaderContentSettings["theme"]) => {
      const { rendition, handlers, doc } = makeRendition();
      registerContentPipeline(rendition, () => ({ ...DAY, theme }));
      handlers[0]({ document: doc, sectionIndex: 0 });
      return doc.querySelector('style[id="leaf-content-pipeline"]')?.textContent ?? "";
    };

    const seen = new Map<string, string>();
    for (const id of THEME_IDS) seen.set(id, css(id));

    // Every theme must produce its own palette — no two identical stylesheets.
    expect(new Set(seen.values()).size).toBe(THEME_IDS.length);
    for (const [id, sheet] of seen) {
      expect(sheet, `${id} produced no CSS`).not.toBe("");
    }
  });

  it("falls back to the default theme, never silently to day", () => {
    // An unrecognised persisted value (an old row, a hand-edited setting) should
    // land on the registry default so it is visibly "the default", not a theme
    // the user never chose.
    const { rendition, handlers, doc } = makeRendition();
    registerContentPipeline(rendition, () => ({
      ...DAY,
      theme: "chartreuse" as ReaderContentSettings["theme"],
    }));
    handlers[0]({ document: doc, sectionIndex: 0 });
    const unknown =
      doc.querySelector('style[id="leaf-content-pipeline"]')?.textContent ?? "";

    const fresh = makeRendition();
    registerContentPipeline(fresh.rendition, () => ({ ...DAY, theme: DEFAULT_THEME }));
    fresh.handlers[0]({ document: fresh.doc, sectionIndex: 0 });
    const fallback =
      fresh.doc.querySelector('style[id="leaf-content-pipeline"]')?.textContent ?? "";

    expect(unknown).toBe(fallback);
  });

  // ── D5: the chapter is re-measured before epub.js restores a position ──
  //
  // epub.js sizes the chapter iframe inside `view.render()` — BEFORE this hook
  // runs — so it measures the chapter as the publisher wrote it. Our stylesheet
  // then changes the measure, size and leading, and the text needs materially
  // more columns than the iframe epub.js sized. While the view is still stale,
  // `managers/default/index.js moveTo()` clamps any restore past that width:
  //
  //     distX = Math.floor(offset.left / this.layout.delta) * this.layout.delta;
  //     if (distX + this.layout.delta > this.container.scrollWidth) {
  //       distX = this.container.scrollWidth - this.layout.delta;
  //     }
  //
  // …which silently drops the reader back to the last column that fitted. The
  // model below is that arithmetic, with the real numbers measured on a phone
  // for "Peaches in Combat" (3010px as the publisher wrote it -> 5160px once
  // our stylesheet lands, 430px columns, a restore targeting x = 4767).

  const PUBLISHER_WIDTH = 3010;
  const STYLED_WIDTH = 5160;
  const DELTA = 430;
  const RESTORE_AT = 4767; // where the saved CFI resolves once we have restyled

  /** A stand-in for the epub.js view + container the restore scrolls. */
  function makeView(doc: Document) {
    // What the text actually occupies: our stylesheet is what grows it.
    const contentWidth = () =>
      doc.querySelector('style[id="leaf-content-pipeline"]')
        ? STYLED_WIDTH
        : PUBLISHER_WIDTH;
    // What epub.js has measured. Sized once during render, then only on "expand".
    let scrollWidth = contentWidth();
    return {
      expand: () => {
        scrollWidth = contentWidth();
      },
      /** managers/default/index.js moveTo(), paginated + ltr. */
      moveTo: (left: number) => {
        let distX = Math.floor(left / DELTA) * DELTA;
        if (distX + DELTA > scrollWidth) distX = scrollWidth - DELTA;
        return distX;
      },
      scrollWidth: () => scrollWidth,
    };
  }

  it("tells epub.js to re-measure the chapter after restyling it (D5)", () => {
    const { rendition, handlers, contents, doc } = makeRendition();
    const view = makeView(doc);
    // epub.js's Contents is an EventEmitter and the view listens for "expand".
    const emit = vi.fn((name: string) => {
      if (name === "expand") view.expand();
    });

    registerContentPipeline(rendition, () => DAY);
    handlers[0]({ ...contents, emit }, rendition);

    expect(emit).toHaveBeenCalledWith("expand");
    // The re-measure has to see the restyled chapter, so it must come after the
    // stylesheet — re-measuring first would just re-read the publisher's width.
    expect(view.scrollWidth()).toBe(STYLED_WIDTH);
    // …and the restore therefore lands on the reader's column, not on the last
    // column that fitted the stale width.
    expect(view.moveTo(RESTORE_AT)).toBe(4730);
  });

  it("without the re-measure, a restore near a chapter end is clamped backwards", () => {
    // Guards the assertion above: prove the model can actually fail, so the
    // test cannot pass for the wrong reason. This is the shipped behaviour
    // before the fix — the reader lands 5 pages back inside the same chapter.
    const { rendition, handlers, contents, doc } = makeRendition();
    const view = makeView(doc);

    registerContentPipeline(rendition, () => DAY);
    handlers[0]({ ...contents, emit: undefined }, rendition); // no re-measure

    expect(view.scrollWidth()).toBe(PUBLISHER_WIDTH);
    expect(view.moveTo(RESTORE_AT)).toBe(2580); // 6 columns in, not 11
  });

  it("refresh() re-measures too — a size change re-flows the chapter", () => {
    const { rendition, handlers, contents } = makeRendition();
    const emit = vi.fn();
    const withEmit = { ...contents, emit };
    (rendition as unknown as { getContents: () => unknown[] }).getContents =
      () => [withEmit];

    const pipeline = registerContentPipeline(rendition, () => DAY);
    handlers[0](withEmit, rendition);
    emit.mockClear();

    pipeline.refresh();
    expect(emit).toHaveBeenCalledWith("expand");
  });

  it("survives a contents object with no emit (never breaks rendering)", () => {
    const { rendition, handlers, contents, doc } = makeRendition();
    registerContentPipeline(rendition, () => DAY);

    // A plain `{ document }` holder — what older epub.js hands the hook.
    expect(() => handlers[0]({ document: doc, sectionIndex: 0 }, rendition)).not.toThrow();
    // …and one whose emit throws.
    expect(() =>
      handlers[0](
        {
          ...contents,
          emit: () => {
            throw new Error("detached");
          },
        },
        rendition,
      ),
    ).not.toThrow();
    expect(doc.querySelectorAll('style[id="leaf-content-pipeline"]')).toHaveLength(1);
  });

  it("destroy() deregisters the hook; the handle is also callable as teardown", () => {
    const { rendition, handlers } = makeRendition();
    const pipeline = registerContentPipeline(rendition, () => DAY);
    expect(handlers).toHaveLength(1);

    pipeline.destroy();
    expect(handlers).toHaveLength(0);

    // Callable form is equivalent to destroy() and safe to call again.
    const again = registerContentPipeline(rendition, () => DAY);
    expect(handlers).toHaveLength(1);
    again();
    expect(handlers).toHaveLength(0);
  });
});
