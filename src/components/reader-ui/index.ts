// Reader chrome — presentational, token-driven (SPEC §8). The only seam
// between the style-agnostic engine (`@/reader`) and the design layer.

export { ReaderShell } from "./ReaderShell";
export type {
  ReaderShellProps,
  ReaderShellInitialSettings,
} from "./ReaderShell";

export { ReaderTopBar } from "./ReaderTopBar";
export type { ReaderTopBarProps } from "./ReaderTopBar";

export { ReaderBottomBar } from "./ReaderBottomBar";
export type { ReaderBottomBarProps } from "./ReaderBottomBar";

export { SpreadFrame } from "./SpreadFrame";
export type { SpreadFrameProps } from "./SpreadFrame";

export { ReaderSettingsSheet } from "./ReaderSettingsSheet";
export type { ReaderSettingsSheetProps } from "./ReaderSettingsSheet";
