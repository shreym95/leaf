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
export { SyncOfferChip } from "./SyncOfferChip";
export type { SyncOfferChipProps } from "./SyncOfferChip";
export { ReaderDock } from "./ReaderDock";
export type { ReaderDockProps } from "./ReaderDock";
export { TocPopover } from "./TocPopover";
export type { TocPopoverProps } from "./TocPopover";

export { SpreadFrame } from "./SpreadFrame";
export type { SpreadFrameProps } from "./SpreadFrame";

export { NotesPanel } from "./NotesPanel";
