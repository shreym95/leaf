// Reader settings store (Zustand v5). Style-agnostic: holds the reader's
// typographic choices as plain data — the design layer reads these values and
// maps them to tokens / epub.js themes, this file never touches CSS.
//
// M3: hydrate from reader_settings table + sync

import { create } from "zustand";

export type FontFamily = "serif" | "sans" | "legible";
export type Margins = "narrow" | "normal" | "wide";
export type ReaderTheme = "day" | "night";

export interface ReaderSettingsState {
  /** Curated body font: serif / humanist sans / Atkinson Hyperlegible. */
  fontFamily: FontFamily;
  /** rem */
  fontSize: number;
  lineSpacing: number;
  margins: Margins;
  theme: ReaderTheme;

  setFontFamily: (value: FontFamily) => void;
  setFontSize: (value: number) => void;
  setLineSpacing: (value: number) => void;
  setMargins: (value: Margins) => void;
  setTheme: (value: ReaderTheme) => void;
  reset: () => void;
}

type ReaderSettingsValues = Pick<
  ReaderSettingsState,
  "fontFamily" | "fontSize" | "lineSpacing" | "margins" | "theme"
>;

export const READER_SETTINGS_DEFAULTS: ReaderSettingsValues = {
  fontFamily: "serif",
  fontSize: 1.06,
  lineSpacing: 1.62,
  margins: "normal",
  theme: "night",
};

export const useReaderSettings = create<ReaderSettingsState>((set) => ({
  ...READER_SETTINGS_DEFAULTS,

  setFontFamily: (fontFamily) => set({ fontFamily }),
  setFontSize: (fontSize) => set({ fontSize }),
  setLineSpacing: (lineSpacing) => set({ lineSpacing }),
  setMargins: (margins) => set({ margins }),
  setTheme: (theme) => set({ theme }),
  reset: () => set({ ...READER_SETTINGS_DEFAULTS }),
}));
