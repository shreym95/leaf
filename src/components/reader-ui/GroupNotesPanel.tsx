"use client";

// The Group tab body in the contents popover: this book's page marks and notes in
// the linked group reads. Lists what the database lets me see (the spoiler gate is
// applied there), creates a mark or a note at my current page, deletes my own items,
// and jumps to an item in my copy. Writes are online only; nothing is queued.

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addReadNote,
  deleteReadNote,
  listVisibleNotes,
  NOTE_MAX,
} from "@/lib/db/read-notes";
import type { VisibleReadNote } from "@/lib/types";
import {
  buildNoteSections,
  canSaveNote,
  noteLength,
  type GroupReadContext,
  outlinePositionFor,
  type NoteRow,
  type PlaceInBook,
} from "./group-notes";
import type { GroupReadsState } from "./useGroupReads";

export interface GroupNotesPanelProps {
  ctx: GroupReadsState;
  /** The reader's current place; null before the first relocation. */
  place: PlaceInBook | null;
  /** Jump to a CFI or a copy href, as the contents popover does. */
  onJump: (target: string) => void;
}

/** Visible notes for each read, keyed by read id. Rejects if any read fails. */
async function fetchNotes(
  reads: readonly GroupReadContext[],
): Promise<Map<string, VisibleReadNote[]>> {
  const supabase = createClient();
  const pairs = await Promise.all(
    reads.map(async (r) => [r.readId, await listVisibleNotes(r.readId, supabase)] as const),
  );
  return new Map(pairs);
}

function isOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  } catch {
    return false;
  }
}

const MUTED = { color: "var(--leaf-dock-text-muted)" } as const;
const ACCENT = { color: "var(--leaf-accent)" } as const;

const buttonClass =
  "rounded-md px-[var(--leaf-space-2)] py-[var(--leaf-space-1)] text-left font-ui [font-size:var(--leaf-text-xs)] outline-none transition-colors [transition-duration:var(--leaf-dur-ui)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)] disabled:opacity-50";

const fieldClass =
  "w-full rounded-md border p-[var(--leaf-space-2)] font-ui [font-size:var(--leaf-text-xs)] outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]";

const fieldStyle = {
  background: "transparent",
  borderColor: "var(--leaf-dock-border)",
  color: "var(--leaf-dock-text)",
} as const;

export function GroupNotesPanel({ ctx, place, onJump }: GroupNotesPanelProps) {
  const { reads, userId } = ctx;
  const panelRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef(false);
  const seq = useRef(0);
  const pickerId = useId();
  const textareaId = useId();
  const countId = useId();

  const [notes, setNotes] = useState<Map<string, VisibleReadNote[]> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pickedId, setPickedId] = useState(reads[0].readId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const pickedRead = reads.find((r) => r.readId === pickedId) ?? reads[0];
  const at = outlinePositionFor(pickedRead, place);
  const canWrite = at !== null && !busy;

  // Fetch on mount (the tab opening) and again on window focus. A late response from
  // an older fetch is dropped by the sequence number.
  const loadNotes = useCallback((): void => {
    const mine = ++seq.current;
    fetchNotes(reads).then(
      (next) => {
        if (mine !== seq.current) return;
        setNotes(next);
        setLoadError(false);
      },
      () => {
        if (mine !== seq.current) return;
        setLoadError(true);
      },
    );
  }, [reads]);

  useEffect(() => {
    const onFocus = () => loadNotes();
    loadNotes();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      seq.current += 1;
    };
  }, [loadNotes]);

  // Focus follows the note form: into the textarea when it opens, back to the
  // "Add a note" control when it closes by Save or Cancel.
  useEffect(() => {
    if (adding) {
      textareaRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      addRef.current?.focus();
    }
  }, [adding]);

  function closeForm(refocus: boolean): void {
    returnFocus.current = refocus;
    setAdding(false);
    setDraft("");
    setSaveError(false);
  }

  async function create(kind: "mark" | "note"): Promise<boolean> {
    if (!at || busy) return false;
    if (kind === "note" && !canSaveNote(draft)) return false;
    setBusy(true);
    setSaveError(false);
    try {
      if (isOffline()) throw new Error("offline");
      await addReadNote(
        {
          readId: pickedRead.readId,
          userId,
          position: at,
          kind,
          note: kind === "note" ? draft : undefined,
          cfi: place?.cfi ?? null,
          contentSha256: pickedRead.copySha256,
        },
        createClient(),
      );
      return true;
    } catch {
      setSaveError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onMark(): Promise<void> {
    if (await create("mark")) loadNotes();
  }

  async function onSave(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (await create("note")) {
      closeForm(true);
      loadNotes();
    }
  }

  async function onDelete(id: string): Promise<void> {
    setDeleteError(false);
    try {
      if (isOffline()) throw new Error("offline");
      await deleteReadNote(id, createClient());
      loadNotes();
      panelRef.current?.focus();
    } catch {
      setDeleteError(true);
    }
  }

  const sections = notes ? buildNoteSections(reads, notes) : [];
  const total = sections.reduce(
    (n, s) => n + s.chapters.reduce((m, c) => m + c.rows.length, 0),
    0,
  );
  const length = noteLength(draft);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="flex flex-col gap-[var(--leaf-space-2)] outline-none"
    >
      {reads.length > 1 && (
        <div className="flex items-center gap-[var(--leaf-space-2)]">
          <label
            htmlFor={pickerId}
            className="flex-none font-ui [font-size:var(--leaf-text-xs)]"
            style={MUTED}
          >
            Group
          </label>
          <select
            id={pickerId}
            value={pickedRead.readId}
            onChange={(e) => setPickedId(e.target.value)}
            className={fieldClass}
            style={fieldStyle}
          >
            {reads.map((r) => (
              <option key={r.readId} value={r.readId}>
                {r.groupName}
              </option>
            ))}
          </select>
        </div>
      )}

      {!adding && (
        <div className="flex gap-[var(--leaf-space-2)]">
          <button
            type="button"
            onClick={() => void onMark()}
            disabled={!canWrite}
            className={buttonClass}
            style={fieldStyle}
          >
            Mark this page
          </button>
          <button
            ref={addRef}
            type="button"
            onClick={() => {
              setSaveError(false);
              setAdding(true);
            }}
            disabled={!canWrite}
            className={buttonClass}
            style={fieldStyle}
          >
            Add a note
          </button>
        </div>
      )}

      {saveError && (
        <p role="alert" className="font-ui [font-size:var(--leaf-text-xs)]" style={ACCENT}>
          Couldn&apos;t save. Try again.
        </p>
      )}

      {adding && (
        <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-[var(--leaf-space-2)]">
          <label htmlFor={textareaId} className="font-ui [font-size:var(--leaf-text-xs)]" style={MUTED}>
            Note
          </label>
          <textarea
            id={textareaId}
            ref={textareaRef}
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={countId}
            className={fieldClass}
            style={fieldStyle}
          />
          <div className="flex items-center justify-between gap-[var(--leaf-space-2)]">
            <span
              id={countId}
              className="font-mono tabular-nums [font-size:var(--leaf-text-3xs)]"
              style={length > NOTE_MAX ? ACCENT : MUTED}
            >
              {length}/{NOTE_MAX}
            </span>
            <div className="flex gap-[var(--leaf-space-2)]">
              <button
                type="button"
                onClick={() => closeForm(true)}
                className={buttonClass}
                style={fieldStyle}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canWrite || !canSaveNote(draft)}
                className={buttonClass}
                style={fieldStyle}
              >
                Save
              </button>
            </div>
          </div>
        </form>
      )}

      {deleteError && (
        <p role="alert" className="font-ui [font-size:var(--leaf-text-xs)]" style={ACCENT}>
          Couldn&apos;t delete. Try again.
        </p>
      )}

      {loadError ? (
        <div role="alert" className="flex items-center justify-between gap-[var(--leaf-space-2)]">
          <p className="font-ui [font-size:var(--leaf-text-xs)]" style={ACCENT}>
            Couldn&apos;t load marks and notes.
          </p>
          <button type="button" onClick={loadNotes} className={buttonClass} style={fieldStyle}>
            Try again
          </button>
        </div>
      ) : notes === null ? null : total === 0 ? (
        <p className="py-[var(--leaf-space-2)] font-ui [font-size:var(--leaf-text-xs)]" style={MUTED}>
          No marks or notes yet.
        </p>
      ) : (
        <div className="flex max-h-[40vh] flex-col gap-[var(--leaf-space-3)] overflow-y-auto">
          {sections.map((section) => (
            <div key={section.read.readId} className="flex flex-col gap-[var(--leaf-space-2)]">
              {reads.length > 1 && (
                <p className="font-mono uppercase [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)]" style={MUTED}>
                  {section.read.groupName}
                </p>
              )}
              {section.chapters.map((chapter) => (
                <div key={chapter.chapterIndex} className="flex flex-col gap-[var(--leaf-space-1)]">
                  <p className="font-mono uppercase [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)]" style={MUTED}>
                    {chapter.label}
                  </p>
                  <ul className="flex flex-col gap-[var(--leaf-space-1)]">
                    {chapter.rows.map((row) => (
                      <NoteItem
                        key={row.note.id}
                        row={row}
                        chapterLabel={chapter.label}
                        authorName={section.read.names.get(row.note.user_id) ?? "Member"}
                        own={row.note.user_id === userId}
                        onJump={onJump}
                        onDelete={(id) => void onDelete(id)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteItem({
  row,
  chapterLabel,
  authorName,
  own,
  onJump,
  onDelete,
}: {
  row: NoteRow;
  chapterLabel: string;
  authorName: string;
  own: boolean;
  onJump: (target: string) => void;
  onDelete: (id: string) => void;
}) {
  const { note, jump } = row;
  const kindWord = note.kind === "mark" ? "mark" : "note";
  const body = (
    <>
      <span className="block font-mono [font-size:var(--leaf-text-3xs)]" style={MUTED}>
        {authorName}
      </span>
      <span className="block whitespace-pre-wrap break-words font-ui [font-size:var(--leaf-text-xs)]">
        {note.kind === "mark" ? "Marked this page" : (note.note ?? "")}
      </span>
      {jump?.kind === "chapter" && (
        <span className="block font-ui [font-size:var(--leaf-text-3xs)]" style={MUTED}>
          in {chapterLabel}
        </span>
      )}
    </>
  );

  return (
    <li className="flex items-start gap-[var(--leaf-space-1)]">
      {jump ? (
        <button
          type="button"
          onClick={() => onJump(jump.target)}
          className={`${buttonClass} min-w-0 flex-1`}
          style={{ color: "var(--leaf-dock-text)" }}
        >
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-[var(--leaf-space-2)] py-[var(--leaf-space-1)]" style={MUTED}>
          {body}
        </div>
      )}
      {own && (
        <button
          type="button"
          onClick={() => onDelete(note.id)}
          aria-label={`Delete this ${kindWord}`}
          className={`${buttonClass} flex-none font-mono [font-size:var(--leaf-text-3xs)]`}
          style={MUTED}
        >
          Delete
        </button>
      )}
    </li>
  );
}
