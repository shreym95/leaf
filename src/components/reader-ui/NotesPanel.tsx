"use client";

import { useState } from "react";
import { Sheet, SheetContent, Button } from "@/components/primitives";
import { highlightVar } from "@/design/highlight-theme";

/**
 * NotesPanel — the per-book list of highlights and notes (SPEC §8). Sheet-based
 * so it shares the reader's focus-trap / Esc behaviour. Presentational: the
 * shell owns the highlight manager and passes data + callbacks.
 */

export interface NoteItem {
  id: string;
  cfiRange: string;
  text: string;
  color: string;
  note: string | null;
}

export interface NotesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NoteItem[];
  onGoTo: (cfiRange: string) => void;
  onSetNote: (id: string, note: string | null) => void;
  onRemove: (id: string) => void;
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

export function NotesPanel({
  open,
  onOpenChange,
  items,
  onGoTo,
  onSetNote,
  onRemove,
}: NotesPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={`Highlights (${items.length})`}>
        {items.length === 0 ? (
          <p className="font-ui text-ink-mid [font-size:var(--leaf-text-sm)] [line-height:var(--leaf-leading-body)]">
            Select any passage while reading to highlight it. Your highlights and
            notes stay with the book, on every device.
          </p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
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
      </SheetContent>
    </Sheet>
  );
}
