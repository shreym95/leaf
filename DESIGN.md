# Leaf — Design Language

**Read this first if you are changing how Leaf looks.** It is the single entry point
for a designer or frontend developer working on themes, colour, type, spacing or
motion. You should not need to read `SPEC.md`, `REVISED_PLAN.md` or the 42KB
`CHANGELOG.md` to do visual work — everything binding lives here or is linked from
here.

---

## 1. The thesis

Leaf is a **fine-press book, rendered in a browser**. Not a reading app with a
book skin — the reference is a well-set printed page: generous margins, a real
measure, drop caps, small-caps ledes, hairline rules, folios.

Three consequences that decide most arguments:

- **Paper first, chrome second.** Any pixel spent on interface is a pixel not spent
  on the text. Controls hide, shrink, or move into a sheet.
- **Warm, never clinical.** The neutral is a cream/bone paper, not white or grey.
  Accents are ink-and-press colours — oxblood, copper — not product blues.
- **Calm motion.** Long, soft transitions for the theme (600ms); quick, unfussy
  ones for UI (250ms). Nothing bounces, nothing springs.

We ship **one committed aesthetic** with **three themes the reader picks**. There is
no "style variant" system, no `data-aesthetic`, no A/B test. Themes change the
palette; they never change the layout, type scale, or personality.

---

## 2. The layer rule (non-negotiable)

The UI is a **swappable layer**. A future redesign should touch this layer and
nothing else.

| Layer | Directories | May contain literal colours/sizes/fonts? |
|---|---|---|
| **Design (yours)** | `src/design/`, `src/app/globals.css` | **Yes — only here** |
| **Components (yours)** | `src/components/*-ui/`, `src/components/primitives/`, `src/components/ui/` | No — tokens only |
| **Logic (not yours)** | `src/reader/`, `src/lib/`, `src/store/`, `src/normalizer/` | No, and it may not import from the two rows above |

ESLint enforces the bottom row (`eslint.config.mjs`, core `no-restricted-imports`).
There is exactly **one sanctioned bridge**: `src/reader/content-hook.ts` may import
`buildContentTheme` from the design layer, because a selector→declaration map is
data, not presentation code.

**In components, write tokens, never values.** `bg-page text-ink font-display
rounded-md` — not `bg-[#f1ebdc]`. If the utility you need is missing, map it in
`globals.css`; do not inline the value.

---

## 3. The two-documents problem (read this before touching colour)

Leaf paints **two separate documents**, and they do not share CSS:

1. **The chrome** — the Next.js app. Styled by CSS custom properties in
   `tokens.css`, switched by a `data-theme` attribute on `<html>`.
2. **The book** — an `<iframe>` rendered by epub.js. It is a *different document*.
   It cannot see `var(--leaf-*)`. Its styles are injected as concrete values by
   `content-theme.ts` (page text) and `highlight-theme.ts` (highlight washes).

So **every palette value exists twice**: once as a custom property in `tokens.css`,
once as a literal in `content-theme.ts` / `highlight-theme.ts`. This duplication is
deliberate and load-bearing. Tests keep the copies in lockstep
(`content-theme.test.ts`, `highlight-theme.test.ts`) — change one without the other
and `npm test` fails.

> The single most common bug in this codebase's history: the chrome changed theme
> and the page inside the book did not. If you change a palette, change both files.

---

## 4. The files

| File | Owns |
|---|---|
| `src/design/tokens.css` | **All** custom properties: scales, three palettes, elevation, motion. The only stylesheet with literal values. |
| `src/app/globals.css` | Maps `--leaf-*` → Tailwind utilities via `@theme inline`, plus the base layer (body, `::selection`, `:focus-visible`). |
| `src/design/themes.ts` | Theme **registry** — ids, display labels, display order, `DEFAULT_THEME`, `isThemeId()`. Data, not code. |
| `src/design/content-theme.ts` | Book-iframe typography + palette, as an epub.js style object. |
| `src/design/highlight-theme.ts` | Highlight wash colours, in both forms (iframe literal, chrome `var()`). |
| `src/app/layout.tsx` | `next/font` declarations. The `variable:` names are a contract with `tokens.css`. |

---

## 5. Tokens

### Colour — the palette contract

Every theme block defines **the same token set**. A test asserts this
(`tokens.test.ts` → "defines the exact same token set in every theme block"), so a
missing token in one theme is a failing build, not a visual surprise.

| Token | Role |
|---|---|
| `--leaf-paper` | The mat — what sits *behind* the page. Body background. |
| `--leaf-page` | The reading surface itself. |
| `--leaf-edge` | Page edge / hairline under the book block. |
| `--leaf-ink` | Body text. |
| `--leaf-ink-mid` | Secondary text, ledes. |
| `--leaf-faint` | Tertiary text — captions, folios, metadata. **AA floor applies.** |
| `--leaf-accent` | Drop caps, ordinals, links, active state. One per theme. |
| `--leaf-rule` | Hairline dividers. **1.4.11 floor applies.** |
| `--leaf-gutter` | The spread's centre fold shading. |
| `--leaf-focus` | Focus ring colour. |
| `--leaf-selection` | Text-selection wash. |
| `--leaf-hl-{copper,sage,sky,rose}` | The four highlight washes. |

Three themes, in registry (display) order — **light → dark**:

| | Day | Sepia | Night |
|---|---|---|---|
| page | `#f1ebdc` | `#ede2cb` | `#1a1611` |
| paper | `#e7dfcc` | `#e4d8be` | `#100d09` |
| ink | `#26200f` | `#2b2218` | `#e0d5bd` |
| accent | `#8a2b1e` oxblood | `#9e472a` terracotta | `#c58a52` copper |

`DEFAULT_THEME` is **`night`**. Themes are driven **only** by the `data-theme`
attribute — never by `prefers-color-scheme`. A reader who picked Day keeps Day at
midnight.

### Type

Five families, all via `next/font`:

- `--leaf-font-ui` — **Source Sans** — app chrome, buttons, captions.
- `--leaf-font-body` — **EB Garamond** — long-form host text and book excerpts.
- `--leaf-font-display` — **Fraunces** — titles, drop caps, chapter ordinals.
- `--leaf-font-mono` — **JetBrains Mono** — folios, eyebrows, technical labels.
- `--leaf-font-reader-legible` — **Atkinson Hyperlegible** — the reader's
  accessibility font choice.

Scale: `3xs 0.64` · `2xs 0.68` · `xs 0.74` · `sm 0.84` · `base 1` · `lg 1.15` ·
`xl 1.4` · `2xl 1.9` · `3xl 2.6` rem, plus `display: clamp(2.4rem, 5vw, 3.6rem)`.

Tracking: `tight .02` · `wide .08` · `label .16` · `eyebrow .34` em. The eyebrow
value is what makes small-caps ordinals read as press typography — do not reduce it
casually.

Leading: `tight 1.2` · `body 1.62` · `loose 1.85`.

### Spacing

`1: .25` · `2: .5` · `3: .75` · `4: 1` · `5: 1.5` · `6: 2` · `7: 3` · `8: 4.5` rem.

**Deliberately NOT mapped into Tailwind's numeric scale** — the ramp is non-linear
and would silently shadow `p-5` / `gap-6`. Write `var(--leaf-space-5)` or the
arbitrary form `p-(--leaf-space-5)`.

### Radii

`xs 2px` · `sm 3px` · `md 6px` · `lg 12px` · `pill 999px`. Small on purpose — a
book block has a crisp edge, not a rounded card corner.

### Motion

`--leaf-dur-theme .6s` (palette crossfade) · `--leaf-dur-turn .32s` (page turn) ·
`--leaf-dur-ui .25s`. Easing `--leaf-ease` = `cubic-bezier(.22,.61,.36,1)`.

Under `prefers-reduced-motion: reduce`, **all three durations become `0s` and both
easings become `linear`** at the token level. Anything referencing a motion token is
therefore reduced-motion-correct for free. Use the tokens and you cannot get this
wrong.

### Elevation

`--leaf-shadow-book` · `-sheet` · `-focus` · `-card` · `-card-hover` · `-spine`.

Declared on `:root` **after** the palette blocks so they compose the live palette
vars. **Night overrides them** under `:root[data-theme="night"]`: a black drop
shadow is invisible against a `#100d09` mat, so night rebuilds the same elevations
from deeper blacks plus a faint white catchlight. If you add a shadow token, check
it in night before calling it done.

---

## 6. Layout: the book frame

Desktop is a **framed two-page spread** on a mat. Below `1024px` the frame is
dropped entirely and the page goes **full-bleed** — at 390px the framed layout gave
text only 61% of the width.

**The one rule you must not break:** `--leaf-reader-viewer-pad-x` is `0px` at every
width, and it stays that way. That element *is* epub.js's container; epub.js
measures it to size its columns. Padding it shrinks the iframe after the column
width is fixed, so the last column overhangs and the page looks lopsided. Breathing
room comes from `--leaf-reader-frame-pad-x`, which pads the mat. A test enforces
this (`tokens.test.ts` → "never pads epub.js's container horizontally, at any
width").

Safe-area insets (`--leaf-safe-*`) are exposed as tokens; `viewport-fit=cover` means
the app paints under notches, and `--leaf-reader-surface` becomes the *page* colour
when full-bleed so the cutout area does not read as a band above the book.

---

## 7. Accessibility floor (hard requirements)

- **WCAG AA 4.5:1** for all text against its own background — including
  `--leaf-faint`, which is the one people get wrong. Every theme's `faint` has
  already been darkened/lightened once for this reason.
- **WCAG 1.4.11, 3:1** for non-text boundaries — this is why `--leaf-rule` is far
  darker than a designer's instinct for a hairline. A test computes the ratio for
  every theme and fails below 3:1.
- **Reduced motion always**, via the motion tokens.
- Focus is visible everywhere: `:focus-visible` gets a 2px `--leaf-focus` outline at
  2px offset, globally in `globals.css`.
- Interactive groups follow WAI-ARIA APG patterns (the theme picker is a proper
  radiogroup with roving tabindex, not three buttons).

Check contrast **before** proposing a colour. A value that fails is not a taste
disagreement, it is a bug.

---

## 8. How to add a theme

A theme id is **persisted data** — it is written to `profiles.default_theme` and
`reader_settings.theme`, both guarded by a Postgres CHECK constraint. So adding one
is five files plus a migration, and the compiler will walk you through most of it.

1. **`src/lib/types.ts`** — widen `ThemeName`. This is the canonical union and it
   lives in the logic layer, not the design layer. Everything else keys off it.
2. **`src/design/tokens.css`** — add a `[data-theme="<id>"]` block defining **every**
   token the other blocks define. Add a `:root[data-theme="<id>"]` elevation
   override if it is a dark theme.
3. **`src/design/themes.ts`** — add the registry entry (id + label). Position in the
   object is display order.
4. **`src/design/content-theme.ts`** — add the `PALETTES` entry (the book iframe
   cannot read your CSS vars).
5. **`src/design/highlight-theme.ts`** — add the `WASH` entry, four colours.
6. **`supabase/migrations/000N_<name>.sql`** — widen both CHECK constraints. Pattern
   to copy: `supabase/migrations/0004_sepia_theme.sql`.

Steps 3–5 are `Record<ThemeName, …>`, so `npm run typecheck` fails until each is
done. Step 2 is covered by a test. **Step 6 is the one nothing catches at build
time** — skip it and the app will look right locally and refuse to save the theme in
production.

The theme picker, the reader's "Aa" settings sheet, and the content pipeline are all
registry-driven — they need no edit.

---

## 9. What the tests already enforce

Run `npm test`. These will catch you:

- every registered theme has a `[data-theme]` block in `tokens.css`
- every theme block defines the identical token set
- `--leaf-rule` clears 3:1 against `--leaf-page` in every theme
- `content-theme.ts` palettes match `tokens.css` exactly
- `highlight-theme.ts` washes match `tokens.css` exactly, in every theme
- the content pipeline paints **every** registered theme distinctly, and falls back
  to `DEFAULT_THEME` — never silently to Day — for an unknown value
- the reader goes full-bleed below `1024px` and never pads epub.js's container

Also: `npm run lint` (the layer seam) and `npm run typecheck`.

---

## 10. Don't

- Don't put a literal colour, size, font or easing outside `src/design/`.
- Don't add `prefers-color-scheme` theme switching. `data-theme` is the only source.
- Don't pad `--leaf-reader-viewer-pad-x`. See §6.
- Don't change a palette in `tokens.css` without changing `content-theme.ts` /
  `highlight-theme.ts`. See §3.
- Don't map Leaf's spacing ramp into Tailwind's numeric scale. See §5.
- Don't reach into `src/reader`, `src/lib`, `src/store` or `src/normalizer` for a
  visual change. If a visual change seems to require it, that is a seam leak worth
  reporting — log it in `CHANGELOG.md`.
- Don't add AI features. Not this version.

---

## 11. Where the rest lives

- `SPEC.md` — full build spec, data model, architecture.
- `REVISED_PLAN.md` — the UI/UX roadmap; §2 is theme architecture, §6 the phasing.
- `BACKLOG.md` — known open items, including visual debt.
- `CHANGELOG.md` — why each deviation from the v0.1 prototype was made. Search it
  before re-litigating a colour; several were changed once already, with reasons.
- `CLAUDE.md` — the hard rules, in short form.
