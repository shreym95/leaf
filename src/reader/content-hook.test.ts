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
    expect(css).toContain("max-width:40rem");
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
