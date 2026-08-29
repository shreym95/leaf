import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractChapterHeading,
  extractChapterHeadingFromXhtml,
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
