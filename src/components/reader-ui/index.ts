// Reader chrome — presentational, token-driven (SPEC §8). The only seam
// between the style-agnostic engine (`@/reader`) and the design layer.

export { ReaderShell } from "./ReaderShell";
export type {
  ReaderShellProps,
  ReaderShellInitialSettings,
} from "./ReaderShell";

export { ReaderTopBar } from "./ReaderTopBar";

export { ReturnChip } from "./ReturnChip";
export type { ReturnChipProps } from "./ReturnChip";
export { ReaderDock } from "./ReaderDock";
export type { ReaderDockProps } from "./ReaderDock";
export { TocPopover } from "./TocPopover";
export type { TocPopoverProps } from "./TocPopover";

export { SpreadFrame } from "./SpreadFrame";
export type { SpreadFrameProps } from "./SpreadFrame";

export { NotesPanel } from "./NotesPanel";

// Temporary on-device instrumentation for DEFECTS.md D2. `debugRequested` is
// the `?debug=1` gate and is deliberately NOT a client module, so the reader
// route (a Server Component) can call it.
export { debugRequested, DEBUG_PARAM } from "./debug-flag";
export { ReaderDebugOverlay, formatDebugText } from "./ReaderDebugOverlay";
export type { ReaderDebugOverlayProps } from "./ReaderDebugOverlay";
