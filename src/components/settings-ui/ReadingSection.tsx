"use client";

import { useEffect, useId, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useReaderSettings,
  type FontFamily,
  type Margins,
  type ReaderSettingsValues,
} from "@/store/reader-settings";

/**
 * ReadingSection — the "Reading" block on `/settings`.
 *
 * Home for the three reader preferences a person sets up once and then
 * forgets about: typeface, line spacing and margins. Font size and theme are
 * touched mid-book, repeatedly, so they stay in the reader's own dock — this
 * section is deliberately only the "set once" half of the old settings sheet
 * (founder decision: split by how often a setting is touched, not by
 * category).
 *
 * `/settings` is a server component with no reader-settings seed of its own,
 * so this client component takes the server-loaded row as `initialSettings`
 * (the same `settingsFromRow(getReaderSettings(...))` shape the reader route
 * hands to `ReaderShell`) and hydrates the store with it on mount. Without
 * this the controls below would render the store's hard-coded defaults
 * instead of the account's actual saved values.
 */
export interface ReadingSectionProps {
  userId: string;
  initialSettings: ReaderSettingsValues;
}

// ── Typeface ────────────────────────────────────────────────────────────
//
// Three options, but not three peers: Serif and Sans are taste, Legible
// (Atkinson Hyperlegible) is an accessibility aid for low vision and
// dyslexia. It is labelled as such in its own caption rather than presented
// as a plain third font choice — burying an accessibility option in a list of
// flavours is worse than burying a preference.

const TYPEFACE_OPTIONS: {
  value: FontFamily;
  label: string;
  caption: string;
  fontClass: string;
}[] = [
  { value: "serif", label: "Serif", caption: "EB Garamond", fontClass: "font-reader-serif" },
  { value: "sans", label: "Sans", caption: "Source Sans", fontClass: "font-reader-sans" },
  {
    value: "legible",
    label: "Legible",
    caption: "Atkinson Hyperlegible — a low-vision and dyslexia-friendly typeface",
    fontClass: "font-reader-legible",
  },
];

// ── Density ─────────────────────────────────────────────────────────────
//
// Line spacing and margins are meaningless picked separately (nobody thinks
// "I want 1.7 leading"; they think "denser" or "airier") and meaningful
// picked together, so they collapse into one three-stop preset — the same
// move Kindle's redesigned Aa menu made when it replaced loose sliders with
// named presets. There is no fourth "Custom" stop: once these two values only
// move together, there is no way left to reach a value off this list.

interface DensityPreset {
  id: "compact" | "standard" | "spacious";
  label: string;
  caption: string;
  lineSpacing: number;
  margins: Margins;
}

const DENSITY_PRESETS: DensityPreset[] = [
  { id: "compact", label: "Compact", caption: "Denser lines, narrower margins", lineSpacing: 1.45, margins: "narrow" },
  { id: "standard", label: "Standard", caption: "The default balance", lineSpacing: 1.62, margins: "normal" },
  { id: "spacious", label: "Spacious", caption: "Airier lines, wider margins", lineSpacing: 1.8, margins: "wide" },
];

/** `reader_settings.line_spacing` is a Postgres `real` — allow a hair of
 *  float round-trip slop without letting the three presets (0.17+ apart)
 *  blur into each other. */
const LINE_SPACING_EPSILON = 0.005;

/**
 * Derive the selected preset from the stored pair. A value written by the
 * retired continuous sheet (or any pair that isn't one of the three rows
 * above) matches none of them — this deliberately returns `null` rather than
 * snapping to Standard, so the group renders with nothing checked until the
 * reader picks one.
 */
function findDensityPreset(lineSpacing: number, margins: Margins): DensityPreset | null {
  return (
    DENSITY_PRESETS.find(
      (p) => p.margins === margins && Math.abs(p.lineSpacing - lineSpacing) < LINE_SPACING_EPSILON,
    ) ?? null
  );
}

// ── Shared field chrome ───────────────────────────────────────────────────

const fieldLabelClass =
  "font-mono uppercase text-faint [letter-spacing:var(--leaf-tracking-label)] [font-size:var(--leaf-text-3xs)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className={fieldLabelClass}>{label}</span>
      {children}
    </div>
  );
}

/**
 * RadioCardGroup — WAI-ARIA "radio group" pattern (APG), the same mechanics
 * as the reader's retired `Segmented` control and `ThemePicker`: the group is
 * one Tab stop, arrow / Home / End keys move between options and select as
 * they go (roving tabindex). Rendered as stacked labelled cards rather than a
 * segmented pill row because every option here carries a caption — a
 * typeface sample or what a density preset means — that a compact pill has
 * no room for.
 *
 * `value` may be `null` (no option matches the stored data): every card then
 * renders unchecked rather than one being guessed as selected.
 */
function RadioCardGroup<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: { value: T; label: string; caption?: string; fontClass?: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const groupId = useId();
  const foundIndex = value === null ? -1 : options.findIndex((o) => o.value === value);
  const activeIndex = foundIndex === -1 ? 0 : foundIndex;

  function selectAt(i: number) {
    const n = options.length;
    const idx = ((i % n) + n) % n;
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.value);
    btnRefs.current[idx]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        selectAt(activeIndex + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        selectAt(activeIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        selectAt(0);
        break;
      case "End":
        e.preventDefault();
        selectAt(options.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown} className="flex flex-col gap-2">
      {options.map((opt, i) => {
        const checked = opt.value === value;
        const captionId = opt.caption ? `${groupId}-caption-${i}` : undefined;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Explicit name: without it, "name from content" would fold the
            // caption below into the accessible name (e.g. "Legible Atkinson
            // Hyperlegible — a low-vision..."). The caption is exposed
            // separately as a description instead, so it is still announced
            // but doesn't run into the label.
            aria-label={opt.label}
            aria-describedby={captionId}
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={
              "flex items-start gap-3 rounded-md border p-3 text-left transition-colors " +
              "[transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none " +
              "focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
              (checked ? "border-accent" : "border-rule hover:border-ink-mid")
            }
          >
            <span
              aria-hidden
              className={
                "mt-0.5 h-4 w-4 flex-none rounded-pill border " +
                (checked ? "border-accent bg-accent" : "border-rule")
              }
            />
            <span className="flex flex-col gap-0.5">
              <span
                className={
                  "font-ui [font-size:var(--leaf-text-sm)] " +
                  (opt.fontClass ?? "") +
                  " " +
                  (checked ? "text-ink" : "text-ink-mid")
                }
              >
                {opt.label}
              </span>
              {opt.caption ? (
                <span
                  id={captionId}
                  className="font-ui text-faint [font-size:var(--leaf-text-xs)]"
                >
                  {opt.caption}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Live preview ──────────────────────────────────────────────────────────

const PREVIEW_TEXT =
  "It is a truth universally acknowledged, that a single man in possession " +
  "of a good fortune must be in want of a wife. However little known the " +
  "feelings or views of such a man may be on his first entering a " +
  "neighbourhood, this truth is so well fixed in the minds of the " +
  "surrounding families, that he is considered the rightful property of " +
  "some one or other of their daughters.";

const PREVIEW_FONT_CLASS: Record<FontFamily, string> = {
  serif: "font-reader-serif",
  sans: "font-reader-sans",
  legible: "font-reader-legible",
};

/** Chrome-only approximation of margins as inset — narrower inset reads as
 *  "narrow margins", wider inset as "wide". Deliberately not a copy of
 *  `MARGIN_STYLE` in `src/reader/content-hook.ts` (that file builds the
 *  epub.js iframe stylesheet and must not be imported into a chrome
 *  component — see the honesty note on `ReadingPreview` below). */
const PREVIEW_PADDING: Record<Margins, string> = {
  narrow: "p-3",
  normal: "p-5",
  wide: "p-8",
};

/**
 * ReadingPreview — a short passage of public-domain prose rendered with the
 * current typeface and density, so a choice is visible without opening a
 * book.
 *
 * Honesty, not a promise of pixel accuracy: the real prose renders inside the
 * epub.js `<iframe>`, a separate document styled by
 * `src/design/content-theme.ts` that cannot see this page's `--leaf-*`
 * custom properties (the "two-documents problem", `docs/DESIGN.md` §3). This
 * preview is host-document chrome — it reuses the same reader font tokens
 * (`--leaf-font-reader-*`) and the exact stored `lineSpacing` number, which is
 * as close as chrome can get, but it is an approximation of the book, not the
 * book.
 */
function ReadingPreview({
  fontFamily,
  lineSpacing,
  margins,
}: {
  fontFamily: FontFamily;
  lineSpacing: number;
  margins: Margins;
}) {
  return (
    <div className={`rounded-md border border-rule bg-page ${PREVIEW_PADDING[margins]}`}>
      <p
        className={`text-ink ${PREVIEW_FONT_CLASS[fontFamily]}`}
        style={{ lineHeight: lineSpacing, fontSize: "var(--leaf-text-sm)" }}
      >
        {PREVIEW_TEXT}
      </p>
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────

export function ReadingSection({ userId, initialSettings }: ReadingSectionProps) {
  // Seed the store once from the server-loaded row, exactly as the reader
  // route does (`ReaderShell` -> `useReaderSettings.getState().hydrate(...)`).
  // `hydrate` itself is idempotent per user (see the store's `seededFor`
  // guard), so this is safe to fire on every mount.
  useEffect(() => {
    useReaderSettings.getState().hydrate(initialSettings, userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { fontFamily, lineSpacing, margins, setFontFamily, setLineSpacing, setMargins } = useReaderSettings(
    useShallow((s) => ({
      fontFamily: s.fontFamily,
      lineSpacing: s.lineSpacing,
      margins: s.margins,
      setFontFamily: s.setFontFamily,
      setLineSpacing: s.setLineSpacing,
      setMargins: s.setMargins,
    })),
  );

  const densityId = findDensityPreset(lineSpacing, margins)?.id ?? null;

  function chooseDensity(id: DensityPreset["id"]) {
    const preset = DENSITY_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setLineSpacing(preset.lineSpacing);
    setMargins(preset.margins);
  }

  return (
    <div className="flex flex-col gap-6">
      <Field label="Typeface">
        <RadioCardGroup ariaLabel="Typeface" options={TYPEFACE_OPTIONS} value={fontFamily} onChange={setFontFamily} />
      </Field>

      <Field label="Density">
        <RadioCardGroup
          ariaLabel="Density"
          options={DENSITY_PRESETS.map((p) => ({ value: p.id, label: p.label, caption: p.caption }))}
          value={densityId}
          onChange={chooseDensity}
        />
      </Field>

      <Field label="Preview">
        <ReadingPreview fontFamily={fontFamily} lineSpacing={lineSpacing} margins={margins} />
      </Field>
    </div>
  );
}
