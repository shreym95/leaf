"use client";

import { useState } from "react";
import { Sheet, SheetContent, Button } from "@/components/primitives";
import { highlightVar } from "@/design/highlight-theme";

/**
 * NotesPanel — the per-book list of highlights and notes (SPEC §8). Sheet-based
 * so it shares the reader's focus-trap / Esc behaviour. Presentational: the
 * shell owns the managers and passes data + callbacks.
 *
 * ── PLACEHOLDER: the bookmarks section ────────────────────────────────────
 * The bookmark schema (`bookmarks` table, 0005), the db layer
 * (`src/lib/db/bookmarks.ts`) and the manager (`src/reader/bookmarks.ts`) are
 * the stable, deliberate part. THIS SURFACE IS NOT: it is a deliberately plain
 * "bookmark / un-bookmark this page" control plus a flat list, living inside
 * the existing Notes sheet so it adds no new chrome and no tap target over the
 * page (DEFECTS D1). When the design for bookmarks is decided (REVISED_PLAN
 * §4A is NOT approved), only this component and its wiring in ReaderShell
 * change — the schema and data layer do not.
 * ─────────────────────────────────────────────────────────────────────────
 */

const sectionLabelClass =
  "font-mono uppercase text-faint [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-label)]";

export interface NoteItem {
  id: string;
  cfiRange: string;
  text: string;
  color: string;
  note: string | null;
}

/** A saved bookmark, flattened for display (see `BookmarkRecord`). */
export interface BookmarkItem {
  id: string;
  cfi: string;
  /** Chapter title at save time, or null. */
  label: string | null;
  /** 0–1 progress at save time, or null. */
  percent: number | null;
}

export interface NotesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NoteItem[];
  onGoTo: (cfiRange: string) => void;
  onSetNote: (id: string, note: string | null) => void;
  onRemove: (id: string) => void;

  // ── bookmarks (placeholder surface — see the file header) ───────────────
  bookmarks: BookmarkItem[];
  /** False before the reader has reported a position — the toggle can't act. */
  canBookmark: boolean;
  /** Whether the page currently on screen already has a bookmark. */
  currentPageBookmarked: boolean;
  onToggleBookmark: () => void;
  onGoToBookmark: (cfi: string) => void;
  onRemoveBookmark: (id: string) => void;
}

function NoteRow({
  item,
  onGoTo,
  onSetNote,
  onRemove,
}: {
  item: NoteItem;
  onGoTo: (cfiRange: string) => void;
  onSetNote: (id: string, note: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.note ?? "");

  return (
    <li className="flex flex-col gap-2 border-b border-rule pb-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 h-3 w-3 flex-none rounded-pill"
          style={{ background: highlightVar(item.color) }}
        />
        <button
          type="button"
          onClick={() => onGoTo(item.cfiRange)}
          className="flex-1 rounded-sm text-left font-body text-ink [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)] hover:text-accent focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
        >
          {item.text}
        </button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2 pl-6">
          <label
            className="font-mono uppercase text-faint [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-label)]"
            htmlFor={`note-${item.id}`}
          >
            Note
          </label>
          <textarea
            id={`note-${item.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded-sm border border-rule bg-paper p-2 font-ui text-ink [font-size:var(--leaf-text-sm)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setDraft(item.note ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onSetNote(item.id, draft.trim() ? draft.trim() : null);
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 pl-6">
          {item.note ? (
            <p className="flex-1 font-ui text-ink-mid [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]">
              {item.note}
            </p>
          ) : (
            <span className="flex-1 font-ui text-faint [font-size:var(--leaf-text-sm)]">
              No note
            </span>
          )}
          <div className="flex flex-none gap-1">
            <Button variant="quiet" size="sm" mono onClick={() => setEditing(true)}>
              {item.note ? "Edit" : "Add note"}
            </Button>
            <Button variant="quiet" size="sm" mono onClick={() => onRemove(item.id)}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function BookmarkRow({
  item,
  onGoTo,
  onRemove,
}: {
  item: BookmarkItem;
  onGoTo: (cfi: string) => void;
  onRemove: (id: string) => void;
}) {
  const pct =
    item.percent != null ? `${Math.round(item.percent * 100)}%` : null;
  return (
    <li className="flex items-center justify-between gap-3 border-b border-rule pb-4 last:border-b-0">
      <button
        type="button"
        onClick={() => onGoTo(item.cfi)}
        className="flex flex-1 items-baseline gap-3 rounded-sm text-left font-body text-ink [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)] hover:text-accent focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
      >
        <span className="flex-1">{item.label ?? "Bookmarked page"}</span>
        {pct && (
          <span className="flex-none font-mono text-faint [font-size:var(--leaf-text-3xs)]">
            {pct}
          </span>
        )}
      </button>
      <Button
        variant="quiet"
        size="sm"
        mono
        onClick={() => onRemove(item.id)}
        aria-label={`Delete bookmark${item.label ? ` — ${item.label}` : ""}`}
      >
        Delete
      </Button>
    </li>
  );
}

export function NotesPanel({
  open,
  onOpenChange,
  items,
  onGoTo,
  onSetNote,
  onRemove,
  bookmarks,
  canBookmark,
  currentPageBookmarked,
  onToggleBookmark,
  onGoToBookmark,
  onRemoveBookmark,
}: NotesPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Notes">
        <div className="flex flex-col gap-7">
          <section className="flex flex-col gap-4">
            <h3 className={sectionLabelClass}>Highlights ({items.length})</h3>
            {items.length === 0 ? (
              <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]">
                Select any passage while reading to highlight it. Your highlights
                and notes stay with the book, on every device.
              </p>
            ) : (
              <ul className="flex max-h-[40vh] flex-col gap-4 overflow-y-auto">
                {items.map((item) => (
                  <NoteRow
                    key={item.id}
                    item={item}
                    onGoTo={onGoTo}
                    onSetNote={onSetNote}
                    onRemove={onRemove}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className={sectionLabelClass}>Bookmarks ({bookmarks.length})</h3>
              <Button
                variant="ghost"
                size="sm"
                mono
                disabled={!canBookmark}
                aria-pressed={currentPageBookmarked}
                onClick={onToggleBookmark}
              >
                {currentPageBookmarked ? "Remove bookmark" : "Bookmark this page"}
              </Button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]">
                Bookmark the page you are on to come back to it later. Bookmarks
                stay with the book, on every device.
              </p>
            ) : (
              <ul className="flex max-h-[40vh] flex-col gap-4 overflow-y-auto">
                {bookmarks.map((item) => (
                  <BookmarkRow
                    key={item.id}
                    item={item}
                    onGoTo={onGoToBookmark}
                    onRemove={onRemoveBookmark}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
