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
    // `100%`, not `100vw`: the page sizes to its safe-area-padded parent, so a
    // notch or camera cutout can never sit over the text.
    expect(decl(smallScreen, "reader-frame-w")).toBe("100%");
    expect(decl(smallScreen, "reader-frame-pad-x")).toBe("0px");
    expect(decl(smallScreen, "reader-frame-shadow")).toBe("none");
    expect(decl(smallScreen, "reader-frame-radius")).toBe("0px");
  });

  it("keeps the framed book on wide screens", () => {
    const root = css.slice(0, css.indexOf("\n@media (max-width: 1023px)"));
    expect(decl(root, "reader-frame-w")).toContain("min(");
    expect(decl(root, "reader-frame-pad-x")).toContain("clamp(");
    expect(decl(root, "reader-frame-shadow")).toBe("var(--leaf-shadow-book)");
  });

  it("never pads epub.js's container horizontally, at any width", () => {
    // The viewer element IS epub.js's container, and it sits outside the iframe.
    // Horizontal padding there reaches only the two outer page edges and can
    // never touch the gutter, so on a spread it made the outer margins 113px
    // against 65px at the spine. The page's insets come from epub.js's own body
    // padding (half the column gap, symmetric) plus the Margins setting.
    const root = css.slice(0, css.indexOf('\n@media (max-width: 1023px)'));
    expect(decl(root, "reader-viewer-pad-x")).toBe("0px");
    expect(decl(smallScreen, "reader-viewer-pad-y")).toBe("0px");
  });

  it("lets the page fill the screen, so no paper shows through", () => {
    // A max-height cap left strips of `--leaf-paper` above and below the
    // `--leaf-page` surface — visible as bands in a full-bleed reader.
    expect(decl(smallScreen, "reader-frame-max-h")).toBe("none");
    expect(decl(smallScreen, "reader-frame-pad-b")).toBe("0px");
  });

  it("exposes the system safe-area insets as tokens", () => {
    // `viewport-fit=cover` lets Leaf paint under a notch; these are what keep
    // text out from under it — the web's safe-area layout guide.
    // Slice at the RULE, not the mention of it in the file header comment.
    const root = css.slice(0, css.indexOf('\n[data-theme="day"] {'));
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(decl(root, `safe-${side}`), side).toBe(
        `env(safe-area-inset-${side}, 0px)`,
      );
    }
  });

  it("puts the page surface behind the safe areas when full-bleed", () => {
    // Otherwise the notch strip paints in `--leaf-paper` over a `--leaf-page`
    // book — a band across the top, which is the seam this all started with.
    expect(decl(smallScreen, "reader-surface")).toBe("var(--leaf-page)");
  });

  it("tightens the reader chrome on small screens rather than dropping it", () => {
    // The bars stay — they are the only way back to the library — but they get
    // smaller insets so they cost less of a short screen.
    for (const t of ["reader-viewer-pad-y", "reader-bar-pad-x", "reader-bar-pad-y"]) {
      expect(decl(smallScreen, t), t).toBeDefined();
    }
  });
});
