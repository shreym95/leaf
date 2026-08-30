import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tokens.css"),
  "utf8",
);

/** The `@media (max-width: 1023px)` block — the reader's small-screen overrides. */
const smallScreen = (() => {
  const i = css.indexOf("@media (max-width: 1023px)");
  if (i === -1) throw new Error("no small-screen block in tokens.css");
  return css.slice(i, css.indexOf("\n}", css.indexOf("}", i)) + 2);
})();

function decl(block: string, name: string): string | undefined {
  return block.match(new RegExp(`--leaf-${name}:\\s*([^;]+);`))?.[1].trim();
}

describe("reader layout tokens", () => {
  it("goes full-bleed below the two-page-spread breakpoint", () => {
    // A phone has no second page for the gutter to divide and no room for a mat
    // around the paper — the framed look cost ~39% of the width at 390px.
    expect(decl(smallScreen, "reader-frame-w")).toBe("100vw");
    expect(decl(smallScreen, "reader-frame-pad-x")).toBe("0px");
    expect(decl(smallScreen, "reader-frame-shadow")).toBe("none");
    expect(decl(smallScreen, "reader-frame-radius")).toBe("0px");
  });

  it("keeps the framed book on wide screens", () => {
    const root = css.slice(0, css.indexOf("@media (max-width: 1023px)"));
    expect(decl(root, "reader-frame-w")).toContain("min(");
    expect(decl(root, "reader-frame-pad-x")).toContain("clamp(");
    expect(decl(root, "reader-frame-shadow")).toBe("var(--leaf-shadow-book)");
  });

  it("hands epub.js an unpadded container on small screens", () => {
    // The viewer element IS epub.js's container — it sizes its columns to that
    // box. Padding it shrank the iframe after the column width was fixed, so the
    // page rendered lopsided (36px inset one side, a clipped edge the other).
    expect(decl(smallScreen, "reader-viewer-pad-x")).toBe("0px");
    expect(decl(smallScreen, "reader-viewer-pad-y")).toBe("0px");
  });

  it("lets the page fill the screen, so no paper shows through", () => {
    // A max-height cap left strips of `--leaf-paper` above and below the
    // `--leaf-page` surface — visible as bands in a full-bleed reader.
    expect(decl(smallScreen, "reader-frame-max-h")).toBe("none");
    expect(decl(smallScreen, "reader-frame-pad-b")).toBe("0px");
  });

  it("tightens the reader chrome on small screens rather than dropping it", () => {
    // The bars stay — they are the only way back to the library — but they get
    // smaller insets so they cost less of a short screen.
    for (const t of ["reader-viewer-pad-x", "reader-viewer-pad-y", "reader-bar-pad-x", "reader-bar-pad-y"]) {
      expect(decl(smallScreen, t), t).toBeDefined();
    }
  });
});
