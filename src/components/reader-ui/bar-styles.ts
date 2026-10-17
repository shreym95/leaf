// Shared look for the actions that live in the top bar's slot (SelectionBar,
// HighlightBar, HighlightNoteCard). Quiet text controls in the same mono label
// style as the Library link, so the slot reads as the top bar with different words.
//
// The slot row is exactly one text line tall (see ReaderTopBar), so a control
// cannot grow the bar. Its touch target is still 44px: `before:` extends the hit
// area symmetrically around the label, inside the bar's own vertical padding.
//
// One left edge: the bar row and the note card hang from the same horizontal
// inset (barEdgeStyle). Text that sits on that edge carries no horizontal padding
// of its own. A button keeps its `px` for the label's breathing room, so a row of
// buttons pulls back by that same token (barRowClass) and its label lands on the edge.

/** The horizontal inset every bar row and card hangs from, safe areas included. */
export const barEdgeStyle = {
  paddingLeft: "calc(var(--leaf-reader-bar-pad-x) + var(--leaf-safe-left))",
  paddingRight: "calc(var(--leaf-reader-bar-pad-x) + var(--leaf-safe-right))",
} as const;

/** Pulls a row of barButtonClass controls back by their own horizontal padding. */
export const barRowClass = "-mx-[var(--leaf-space-2)]";

export const barButtonClass =
  "relative inline-flex flex-none items-center rounded-sm px-[var(--leaf-space-2)] font-mono font-medium uppercase " +
  "text-ink-mid transition-colors hover:text-ink " +
  "[font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-wide)] " +
  "[transition-duration:var(--leaf-dur-ui)] " +
  "focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)] " +
  "before:absolute before:left-0 before:right-0 before:top-1/2 " +
  "before:h-[var(--leaf-dock-pod-size)] before:-translate-y-1/2 before:content-['']";

export const barNoticeClass =
  "truncate px-[var(--leaf-space-2)] font-mono [font-size:var(--leaf-text-2xs)] " +
  "[letter-spacing:var(--leaf-tracking-wide)] text-ink-mid";

export const barCounterClass =
  "font-mono tabular-nums [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-tight)]";
