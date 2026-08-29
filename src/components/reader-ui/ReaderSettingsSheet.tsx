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

/**
 * Text size is three named choices, not a fine-grained stepper — the sizes are
 * far enough apart that picking one is unambiguous, and there is no state where
 * a tap appears to do nothing.
 */
const TEXT_SIZES = [
  { value: 0.94, label: "S" },
  { value: 1.14, label: "M" },
  { value: 1.38, label: "L" },
] as const;

/** Snap any persisted value to the nearest named size. */
function nearestTextSize(size: number): number {
  return TEXT_SIZES.reduce((best, opt) =>
    Math.abs(opt.value - size) < Math.abs(best.value - size) ? opt : best,
  ).value;
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Reading settings">
        <div className="flex flex-col gap-6">
          <Field label="Text size">
            <Segmented
              ariaLabel="Text size"
              options={TEXT_SIZES.map((o) => ({ ...o }))}
              value={nearestTextSize(fontSize)}
              onChange={setFontSize}
            />
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
