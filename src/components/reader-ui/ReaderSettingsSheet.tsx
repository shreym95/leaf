"use client";

import { useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Sheet, SheetContent } from "@/components/primitives";
import { THEMES, THEME_IDS } from "@/design/themes";
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
  { value: 0.9, label: "S" },
  // M is the design-token reading size (`--leaf-reader-font-size`) and the
  // `reader_settings` column default, so an untouched account already reads M.
  { value: 1.06, label: "M" },
  { value: 1.26, label: "L" },
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

// Driven by the theme registry, not a hand-written list: a theme added there
// must appear here, or it would be unreachable while reading — which is exactly
// where a reader wants to change it.
const THEME_OPTIONS: { value: ReaderTheme; label: string }[] = THEME_IDS.map(
  (id) => ({ value: id, label: THEMES[id].label }),
);

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

/**
 * Segmented — a WAI-ARIA radio group (APG "radio group" pattern): the group is
 * one Tab stop, arrow / Home / End keys move between options and select as they
 * go, and the checked option carries `tabIndex=0` (roving tabindex).
 */
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
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const foundIndex = options.findIndex((o) => o.value === value);
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
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        selectAt(activeIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
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
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="flex gap-2 rounded-sm border border-rule p-1"
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === activeIndex ? 0 : -1}
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
