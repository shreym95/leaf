// The reader dock's colours are `color-mix(in oklab, …)` expressions over each
// theme's own palette, so their real values only exist once a browser resolves
// them. That is exactly how night's muted dock text sat at 3.90:1 — below AA —
// from the day the dock was built until it was measured by hand.
//
// This test resolves the mixes the way a browser does (oklab interpolation) and
// asserts the floors, so a palette change or a re-tuned percentage fails here
// instead of shipping. The oklab maths below is checked against Chrome: the
// ratios it produces match a canvas-rasterised measurement of the running app
// to two decimal places.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tokens.css"),
  "utf8",
);

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const fromLinear = (l: number) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
};

/** sRGB -> Oklab (Björn Ottosson's matrices). */
function toOklab([r, g, b]: RGB): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, bb]: [number, number, number]): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** `color-mix(in oklab, base, other <pct>%)` — linear interpolation in Oklab. */
function mix(base: RGB, other: RGB, pct: number): RGB {
  const A = toOklab(base);
  const B = toOklab(other);
  const t = pct / 100;
  return fromOklab([
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t,
  ]);
}

const relLuminance = ([r, g, b]: RGB) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read a palette hex out of a `[data-theme="…"]` block. */
function palette(theme: string, name: string): RGB {
  const block = css.slice(css.indexOf(`[data-theme="${theme}"] {`));
  const value = block
    .slice(0, block.indexOf("\n}"))
    .match(new RegExp(`--leaf-${name}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
  if (!value) throw new Error(`no --leaf-${name} in ${theme}`);
  return hexToRgb(value);
}

/** The mix percentage a dock token uses, read from the theme's own block. */
function dockMix(theme: string, token: string): number {
  const block = css.slice(css.indexOf(`[data-theme="${theme}"] {`));
  const line = block
    .slice(0, block.indexOf("\n}"))
    .match(new RegExp(`--leaf-dock-${token}:\\s*color-mix\\([^;]*?(\\d+)%\\)`))?.[1];
  if (!line) throw new Error(`no --leaf-dock-${token} mix in ${theme}`);
  return Number(line);
}

describe.each(["day", "night"])("reader dock contrast — %s", (theme) => {
  const page = palette(theme, "page");
  const ink = palette(theme, "ink");
  const bg = mix(page, ink, dockMix(theme, "bg"));

  it("dock text clears WCAG AA on the dock surface", () => {
    // `--leaf-dock-text` is the palette's ink, not a mix.
    expect(contrast(ink, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("muted dock text clears WCAG AA on the dock surface", () => {
    // The one that silently failed: night sat at 3.90 until it was measured.
    const muted = mix(ink, page, dockMix(theme, "text-muted"));
    expect(contrast(muted, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("the dock's border clears 3:1 against the page it sits on", () => {
    // WCAG 1.4.11: the boundary identifying the control. The dock's fill is a
    // deliberately quiet lift, so the border is what does this job.
    const border = mix(page, ink, dockMix(theme, "border"));
    expect(contrast(border, page)).toBeGreaterThanOrEqual(3);
  });

  it("the dock surface is perceptibly lifted off the page", () => {
    // Not a WCAG floor — a design one. Below ~1.25 the dock stops reading as an
    // object and becomes a slightly different patch of paper.
    expect(contrast(bg, page)).toBeGreaterThanOrEqual(1.25);
  });
});
