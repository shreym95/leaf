"use client";

import { useShallow } from "zustand/react/shallow";
import { Sheet, SheetContent } from "@/components/primitives";
import {
  useReaderSettings,
  type FontFamily,
  type Margins,
  type ReaderTheme,
} from "@/store/reader-settings";

/**
 * ReaderSettingsSheet — the reading-settings panel (SPEC §8): font size, body
 * font, line spacing, margins, theme. Built on the `Sheet` primitive (Radix
 * dialog → focus trap, Esc, scroll lock). Presentational + token-driven.
 *
 * Every change goes through a `useReaderSettings` setter, which (a) persists to
 * `reader_settings` debounced and (b) is observed by ReaderShell, which calls
 * `controller.applySettings(...)`. This component holds no engine reference.
 */

export interface ReaderSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Theme needs a dual write (chrome + persisted setting) — ReaderShell owns it. */
  onSetTheme: (theme: ReaderTheme) => void;
}

/** 100% reference size (matches the store default / `--leaf-reader-font-size`). */
const READER_BASE_SIZE = 1.06;

/**
 * Discrete text sizes, in rem. Each step is ~10% — a continuous 0.04rem step
 * moved the text by well under a pixel, which read as "the button does nothing".
 * Keep the base size in the list so 100% is always reachable.
 */
const FONT_SIZE_STEPS = [0.82, 0.9, 0.98, 1.06, 1.16, 1.28, 1.4, 1.54, 1.7];
const FONT_SIZE_MIN = FONT_SIZE_STEPS[0];
const FONT_SIZE_MAX = FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1];

/** Index of the step nearest `size` (settings may hold any persisted value). */
function sizeStepIndex(size: number): number {
  let best = 0;
  for (let i = 1; i < FONT_SIZE_STEPS.length; i++) {
    if (
      Math.abs(FONT_SIZE_STEPS[i] - size) <
      Math.abs(FONT_SIZE_STEPS[best] - size)
    ) {
      best = i;
    }
  }
  return best;
}

function stepSize(size: number, direction: 1 | -1): number {
  const next = sizeStepIndex(size) + direction;
  return FONT_SIZE_STEPS[Math.min(FONT_SIZE_STEPS.length - 1, Math.max(0, next))];
}

const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Humanist Sans" },
  { value: "legible", label: "Hyperlegible" },
];

const SPACING_OPTIONS: { value: number; label: string }[] = [
  { value: 1.45, label: "Tight" },
  { value: 1.62, label: "Cozy" },
  { value: 1.85, label: "Roomy" },
];

const MARGIN_OPTIONS: { value: Margins; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
];

const THEME_OPTIONS: { value: ReaderTheme; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
];

const rowLabelClass =
  "font-mono uppercase text-faint [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-label)]";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={rowLabelClass}>{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-2 rounded-sm border border-rule p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={
              "flex-1 rounded-xs px-3 py-2 font-ui transition-colors [font-size:var(--leaf-text-xs)] [transition-duration:var(--leaf-dur-ui)] " +
              "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
              (active
                ? "[background:var(--leaf-accent)] [color:var(--leaf-page)]"
                : "text-ink-mid hover:text-ink")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function StepButton({
  label,
  glyph,
  onClick,
  disabled,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="h-9 w-9 rounded-sm border border-rule font-mono text-ink transition-colors hover:bg-edge disabled:pointer-events-none disabled:opacity-40 [font-size:var(--leaf-text-lg)] [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
    >
      {glyph}
    </button>
  );
}

export function ReaderSettingsSheet({
  open,
  onOpenChange,
  onSetTheme,
}: ReaderSettingsSheetProps) {
  const {
    fontFamily,
    fontSize,
    lineSpacing,
    margins,
    theme,
    setFontFamily,
    setFontSize,
    setLineSpacing,
    setMargins,
  } = useReaderSettings(
    useShallow((s) => ({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineSpacing: s.lineSpacing,
      margins: s.margins,
      theme: s.theme,
      setFontFamily: s.setFontFamily,
      setFontSize: s.setFontSize,
      setLineSpacing: s.setLineSpacing,
      setMargins: s.setMargins,
    })),
  );

  const sizePct = Math.round((fontSize / READER_BASE_SIZE) * 100);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Reading settings">
        <div className="flex flex-col gap-6">
          <Field label="Text size">
            <div className="flex items-center gap-3">
              <StepButton
                label="Smaller text"
                glyph="−"
                disabled={fontSize <= FONT_SIZE_MIN}
                onClick={() => setFontSize(stepSize(fontSize, -1))}
              />
              <span className="min-w-[5ch] text-center font-mono text-ink-mid [font-size:var(--leaf-text-sm)]">
                {sizePct}%
              </span>
              <StepButton
                label="Larger text"
                glyph="+"
                disabled={fontSize >= FONT_SIZE_MAX}
                onClick={() => setFontSize(stepSize(fontSize, 1))}
              />
            </div>
          </Field>

          <Field label="Body font">
            <Segmented
              ariaLabel="Body font"
              options={FONT_OPTIONS}
              value={fontFamily}
              onChange={setFontFamily}
            />
          </Field>

          <Field label="Line spacing">
            <Segmented
              ariaLabel="Line spacing"
              options={SPACING_OPTIONS}
              value={nearestSpacing(lineSpacing)}
              onChange={setLineSpacing}
            />
          </Field>

          <Field label="Margins">
            <Segmented
              ariaLabel="Margins"
              options={MARGIN_OPTIONS}
              value={margins}
              onChange={setMargins}
            />
          </Field>

          <Field label="Theme">
            <Segmented
              ariaLabel="Theme"
              options={THEME_OPTIONS}
              value={theme}
              onChange={onSetTheme}
            />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function nearestSpacing(value: number): number {
  return SPACING_OPTIONS.reduce((best, opt) =>
    Math.abs(opt.value - value) < Math.abs(best.value - value) ? opt : best,
  ).value;
}
