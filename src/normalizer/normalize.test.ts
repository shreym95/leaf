import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractChapterHeading,
  extractChapterHeadingFromXhtml,
  normalizeChapterDom,
  type NormalizeChapterMeta,
} from "./normalize";

// fileURLToPath rather than `new URL(..., import.meta.url)` directly: under the
// jsdom test env the global URL is jsdom's, which readFileSync won't accept as
// a path source.
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("extractChapterHeading", () => {
  it("Frankenstein: bare <h2> ordinal, no invented title", () => {
    // Fixture markup: <h2><span epub:type="se:label">Chapter</span>
    //                     <span epub:type="z3998:ordinal z3998:roman">V</span></h2>
    // No <hgroup> → the combined heading text is the ordinal.
    const heading = extractChapterHeadingFromXhtml(fixture("frankenstein-chapter.xhtml"));

    expect(heading.ordinal).toBe("Chapter V");
    expect(heading.title).toBeNull();
    expect(heading.hasTitle).toBe(false);
  });

  it("Oz: <hgroup> with ordinal + title", () => {
    // Fixture markup: <hgroup>
    //   <h2 epub:type="z3998:ordinal z3998:roman">I</h2>
    //   <p epub:type="title">The Cyclone</p></hgroup>
    const heading = extractChapterHeadingFromXhtml(fixture("oz-chapter.xhtml"));

    expect(heading.ordinal).toBe("I");
    expect(heading.title).toBe("The Cyclone");
    expect(heading.hasTitle).toBe(true);
  });

  it("synthetic: a titled <h1> with no hgroup is a title, not an ordinal", () => {
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body>
          <section>
            <h1>The Journey Home</h1>
            <p>The road unspooled ahead of them.</p>
          </section>
        </body>
      </html>`;

    const heading = extractChapterHeadingFromXhtml(xhtml);

    expect(heading.title).toBe("The Journey Home");
    expect(heading.ordinal).toBeNull();
    expect(heading.hasTitle).toBe(true);
  });

  it("accepts an already-parsed Document or Element", () => {
    const doc = new DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><section>
         <h2>Chapter III</h2><p>x</p></section></body></html>`,
      "application/xml",
    );

    expect(extractChapterHeading(doc).ordinal).toBe("Chapter III");

    const section = doc.querySelector("section")!;
    expect(extractChapterHeading(section).ordinal).toBe("Chapter III");
  });

  it("graceful fallback: no heading at all → both null", () => {
    const heading = extractChapterHeadingFromXhtml(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><section>
         <p>Just prose, no heading.</p></section></body></html>`,
    );

    expect(heading.ordinal).toBeNull();
    expect(heading.title).toBeNull();
    expect(heading.hasTitle).toBe(false);
  });
});

const META: NormalizeChapterMeta = {
  bookTitle: "Test Book",
  author: "A. Writer",
  index: 4,
  total: 24,
};

function parseXml(xhtml: string): Document {
  // Mirrors the doc epub.js hands the content hook: XHTML, `epub:type` intact.
  return new DOMParser().parseFromString(xhtml, "application/xml");
}

describe("normalizeChapterDom", () => {
  it("Oz (rich): hgroup -> ordinal eyebrow + Fraunces title, body preserved", () => {
    const doc = parseXml(fixture("oz-chapter.xhtml"));
    normalizeChapterDom(doc, META);

    const article = doc.querySelector("article.chapter");
    expect(article).not.toBeNull();
    expect(doc.querySelector("hgroup")).toBeNull();
    expect(doc.querySelector("section")).toBeNull();

    const head = doc.querySelector(".chapter-head")!;
    expect(head.children[0].getAttribute("class")).toBe("chapter-ordinal");
    expect(head.children[0].textContent).toBe("I");
    expect(head.children[1].getAttribute("class")).toBe("chapter-title");
    expect(head.children[1].textContent).toBe("The Cyclone");
    expect(head.children[1].tagName.toLowerCase()).toBe("h1");

    const paras = doc.querySelectorAll("article.chapter > p");
    expect(paras[0].getAttribute("class")).toBe("para first");
    expect(paras[0].textContent).toMatch(/^Dorothy lived in the midst/);
    expect(paras[1].getAttribute("class")).toBe("para");
    // Order kept: the fixture's last paragraph is still last.
    expect(paras[paras.length - 1].textContent).toMatch(/^In spite of the swaying/);
  });

  it("Frankenstein (ordinal-only): eyebrow, NO invented title", () => {
    const doc = parseXml(fixture("frankenstein-chapter.xhtml"));
    normalizeChapterDom(doc, META);

    expect(doc.querySelector(".chapter-ordinal")?.textContent).toBe("Chapter V");
    // A real ordinal must never carry the "§" fallback's suppression class.
    expect(
      doc.querySelector(".chapter-ordinal")?.classList.contains("chapter-ordinal--fallback"),
    ).toBe(false);
    expect(doc.querySelector(".chapter-title")).toBeNull();
    expect(doc.querySelector("h2")).toBeNull();

    const first = doc.querySelector("article.chapter > p");
    expect(first?.getAttribute("class")).toBe("para first");
    expect(first?.textContent).toMatch(/^It was on a dreary night/);

    // Body content kept (the poem blockquote survives the rewrite).
    expect(doc.querySelector("article.chapter blockquote")).not.toBeNull();
  });

  it("strips publisher classes / epub:type off paragraphs, keeps inline emphasis + links", () => {
    const doc = parseXml(fixture("frankenstein-chapter.xhtml"));
    normalizeChapterDom(doc, META);

    const clerval = Array.from(doc.querySelectorAll("article.chapter > p.para")).find(
      (p) => p.querySelector("i"),
    )!;
    const italic = clerval.querySelector("i")!;
    expect(italic.textContent).toBe("The Vicar of Wakefield");
    expect(italic.hasAttribute("epub:type")).toBe(false);

    const link = doc.querySelector("article.chapter a");
    expect(link?.getAttribute("href")).toBe("endnotes.xhtml#note-1");
    expect(link?.hasAttribute("epub:type")).toBe(false);
    expect(link?.hasAttribute("id")).toBe(false);
  });

  it("messy fallback: no section, no heading, loose <p> -> ordinal '§', no title, still wrapped", () => {
    const doc = parseXml(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>
         <p>First loose paragraph.</p>
         <p>Second loose paragraph.</p>
       </body></html>`,
    );
    normalizeChapterDom(doc, META);

    const article = doc.querySelector("article.chapter");
    expect(article).not.toBeNull();
    expect(doc.querySelector(".chapter-ordinal")?.textContent).toBe("§");
    // Marked as the graceful fallback so the design layer can hide it — a
    // bare "§" is never a real chapter number (see content-theme.test.ts).
    expect(
      doc.querySelector(".chapter-ordinal")?.classList.contains("chapter-ordinal--fallback"),
    ).toBe(true);
    expect(doc.querySelector(".chapter-title")).toBeNull();

    const paras = article!.querySelectorAll(":scope > p");
    expect(paras).toHaveLength(2);
    expect(paras[0].getAttribute("class")).toBe("para first");
    expect(paras[1].getAttribute("class")).toBe("para");
  });

  it("is idempotent — running twice does not double-wrap", () => {
    const doc = parseXml(fixture("oz-chapter.xhtml"));
    normalizeChapterDom(doc, META);
    const before = doc.querySelector("article.chapter")!.outerHTML;

    normalizeChapterDom(doc, META);

    expect(doc.querySelectorAll("article.chapter")).toHaveLength(1);
    expect(doc.querySelectorAll(".chapter-ordinal")).toHaveLength(1);
    expect(doc.querySelector("article.chapter")!.outerHTML).toBe(before);
  });
});
