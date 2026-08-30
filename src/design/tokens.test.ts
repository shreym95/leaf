import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_IDS } from "./themes";

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

/** Body text of a `[data-theme="<id>"]` palette block. */
function themeBlock(id: string): string {
  const m = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no [data-theme="${id}"] block in tokens.css`);
  return m[1];
}

/** Every `--leaf-*` custom property name declared in a block. */
function tokenNames(block: string): string[] {
  return [...block.matchAll(/(--leaf-[\w-]+):/g)].map((m) => m[1]).sort();
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme palettes", () => {
  it("has a [data-theme] block in tokens.css for every registered theme id", () => {
    // Guards every future theme, not just the ones shipped today: a theme in
    // the registry with no palette block renders unstyled.
    for (const id of THEME_IDS) {
      expect(css, id).toContain(`[data-theme="${id}"]`);
    }
  });

  it("defines the exact same token set in every theme block", () => {
    // A theme silently missing a token falls back to whatever cascaded in —
    // usually the wrong colour, sometimes nothing.
    const reference = tokenNames(themeBlock(THEME_IDS[0]));
    for (const id of THEME_IDS.slice(1)) {
      expect(tokenNames(themeBlock(id)), id).toEqual(reference);
    }
  });

  it("meets WCAG 1.4.11 (3:1) for --leaf-rule against --leaf-page in every theme", () => {
    // The hairline rule is a non-text UI boundary; below 3:1 it is invisible.
    // This was ~1.5:1 in day and sepia and ~1.4:1 in night before the fix.
    for (const id of THEME_IDS) {
      const block = themeBlock(id);
      const rule = decl(block, "rule");
      const page = decl(block, "page");
      expect(rule, `${id} --leaf-rule`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(page, `${id} --leaf-page`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(rule!, page!), `${id} rule/page`).toBeGreaterThanOrEqual(3);
    }
  });
});
