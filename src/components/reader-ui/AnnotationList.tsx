"use client";

// The Notes tab body in the contents popover: my personal marks, highlights and
// notes, and (when the book is linked to a group read) the group's visible items.
// Presentational only: the data and every write come in as props and callbacks.

import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/groups-ui/ConfirmDialog";
import { ANNOTATION_NOTE_MAX } from "@/lib/db/annotations";
import { QUOTE_SHARE_MAX } from "@/lib/db/read-notes";
import type { Annotation } from "@/lib/types";
import {
  authorName,
  groupByLabel,
  isQuoteTruncated,
  itemIsMark,
  itemNote,
  itemPercent,
  itemQuote,
  itemTitle,
  noteDraft,
  notesForRead,
  sharedGroupNames,
  type AnnotationGroupContext,
  type AnnotationListItem,
} from "./annotation-list";

export interface AnnotationListProps {
  /** My personal items, in position order. */
  mine: Annotation[];
  /** The group side. Passing it adds the Mine / Group filter; null or omitted hides it. */
  group?: AnnotationGroupContext | null;
  /** Group read ids each of my items is shared to, by annotation id. */
  sharedReadIds: Record<string, string[]>;
  /** Chapter label for a row; rows with the same label are grouped together. */
  sectionLabelFor: (item: AnnotationListItem) => string;
  /** Whether a row can be opened in the reader. */
  canJump: (item: AnnotationListItem) => boolean;
  onJump: (item: AnnotationListItem) => void;
  /** Saves a note; null removes it. */
  onSaveNote: (id: string, note: string | null) => void;
  onRemove: (id: string) => void;
  onShare: (id: string, readId: string) => void;
  onUnshare: (id: string, readId: string) => void;
  /** Share and Unshare are disabled while offline. */
  offline?: boolean;
}

type View = "mine" | "group";

const MUTED = { color: "var(--leaf-dock-text-muted)" } as const;
const TEXT = { color: "var(--leaf-dock-text)" } as const;
const ACCENT = { color: "var(--leaf-accent)" } as const;
const LINE = { borderColor: "var(--leaf-dock-border)" } as const;
const FIELD = {
  background: "transparent",
  borderColor: "var(--leaf-dock-border)",
  color: "var(--leaf-dock-text)",
} as const;
const SELECTED = {
  color: "var(--leaf-dock-text)",
  background: "var(--leaf-dock-hover)",
} as const;

const chapterClass =
  "font-mono uppercase [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-wide)]";

const captionClass = "font-mono tabular-nums [font-size:var(--leaf-text-3xs)]";

const rowButtonClass =
  "flex min-h-[var(--leaf-dock-pod-size)] items-center rounded-md px-[var(--leaf-space-2)] py-[var(--leaf-space-1)] text-left font-ui [font-size:var(--leaf-text-xs)] outline-none transition-colors [transition-duration:var(--leaf-dur-ui)] [transition-timing-function:var(--leaf-ease)] hover:[background:var(--leaf-dock-hover)] focus-visible:[box-shadow:var(--leaf-shadow-focus)] disabled:opacity-50";

const fieldClass =
  "w-full rounded-md border p-[var(--leaf-space-2)] font-ui [font-size:var(--leaf-text-xs)] outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]";

export function AnnotationList({
  mine,
  group = null,
  sharedReadIds,
  sectionLabelFor,
  canJump,
  onJump,
  onSaveNote,
  onRemove,
  onShare,
  onUnshare,
  offline = false,
}: AnnotationListProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const filterName = useId();
  const pickerId = useId();
  const [view, setView] = useState<View>("mine");
  const [pickedReadId, setPickedReadId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Without a group the filter is gone, so the view is always Mine.
  const activeView: View = group ? view : "mine";
  const reads = group?.reads ?? [];
  const activeRead =
    reads.find((r) => r.id === pickedReadId) ?? reads[0] ?? null;

  const mineItems: AnnotationListItem[] = mine.map((annotation) => ({
    source: "mine",
    annotation,
  }));
  const groupItems: AnnotationListItem[] =
    group && activeRead
      ? notesForRead(group.notes, activeRead.id).map((note) => ({
          source: "group",
          note,
        }))
      : [];

  // Removing an item takes its row out of the list; move focus to the list root
  // so keyboard focus is not lost to the body.
  function removeItem(id: string): void {
    onRemove(id);
    setOpenId(null);
    rootRef.current?.focus();
  }

  const sections = groupByLabel(
    activeView === "mine" ? mineItems : groupItems,
    sectionLabelFor,
  );

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex flex-col gap-[var(--leaf-space-2)] outline-none"
    >
      {group && (
        <fieldset className="m-0 flex gap-[var(--leaf-space-1)] border-0 p-0">
          <legend className="sr-only">Show</legend>
          {(
            [
              { id: "mine", label: "Mine" },
              { id: "group", label: "Group" },
            ] as const
          ).map((option) => {
            const checked = activeView === option.id;
            return (
              <label
                key={option.id}
                className={`${chapterClass} flex min-h-[var(--leaf-dock-pod-size)] flex-1 cursor-pointer items-center justify-center rounded-md px-[var(--leaf-space-2)] transition-colors [transition-duration:var(--leaf-dur-ui)] has-[:focus-visible]:[box-shadow:var(--leaf-shadow-focus)] hover:[background:var(--leaf-dock-hover)]`}
                style={checked ? SELECTED : MUTED}
              >
                <input
                  type="radio"
                  name={filterName}
                  value={option.id}
                  checked={checked}
                  onChange={() => setView(option.id)}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </fieldset>
      )}

      {group && activeView === "group" && reads.length > 1 && (
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
            value={activeRead?.id ?? ""}
            onChange={(e) => setPickedReadId(e.target.value)}
            className={fieldClass}
            style={FIELD}
          >
            {reads.map((r) => (
              <option key={r.id} value={r.id}>
                {r.groupName}
              </option>
            ))}
          </select>
        </div>
      )}

      {activeView === "mine" && mine.length === 0 && (
        <p
          className="py-[var(--leaf-space-2)] font-ui [font-size:var(--leaf-text-xs)]"
          style={MUTED}
        >
          No marks or notes yet. Long-press text to highlight, or mark this page
          from the dock.
        </p>
      )}

      {activeView === "group" && groupItems.length === 0 && (
        <p
          className="py-[var(--leaf-space-2)] font-ui [font-size:var(--leaf-text-xs)]"
          style={MUTED}
        >
          No marks or notes yet.
        </p>
      )}

      {sections.length > 0 && (
        <div className="flex max-h-[40vh] flex-col gap-[var(--leaf-space-3)] overflow-y-auto">
          {sections.map((section) => (
            <section
              key={section.label}
              className="flex flex-col gap-[var(--leaf-space-1)]"
            >
              <h3 className={chapterClass} style={MUTED}>
                {section.label}
              </h3>
              <ul className="flex flex-col gap-[var(--leaf-space-1)]">
                {section.items.map((item) =>
                  item.source === "mine" ? (
                    <MineRow
                      key={item.annotation.id}
                      item={item}
                      expanded={openId === item.annotation.id}
                      onToggle={() =>
                        setOpenId((cur) =>
                          cur === item.annotation.id ? null : item.annotation.id,
                        )
                      }
                      group={group}
                      sharedIds={sharedReadIds[item.annotation.id] ?? []}
                      canJump={canJump(item)}
                      onJump={() => onJump(item)}
                      onSave={(note) => onSaveNote(item.annotation.id, note)}
                      onRemove={() => removeItem(item.annotation.id)}
                      onShare={(readId) => onShare(item.annotation.id, readId)}
                      onUnshare={(readId) => onUnshare(item.annotation.id, readId)}
                      offline={offline}
                    />
                  ) : (
                    <GroupRow
                      key={item.note.id}
                      item={item}
                      authorName={
                        group ? authorName(item.note.user_id, group) : "Member"
                      }
                      jumpable={canJump(item)}
                      onJump={() => onJump(item)}
                    />
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface MineRowProps {
  item: Extract<AnnotationListItem, { source: "mine" }>;
  expanded: boolean;
  onToggle: () => void;
  group: AnnotationGroupContext | null;
  sharedIds: string[];
  canJump: boolean;
  onJump: () => void;
  onSave: (note: string | null) => void;
  onRemove: () => void;
  onShare: (readId: string) => void;
  onUnshare: (readId: string) => void;
  offline: boolean;
}

/** One of my items: the quote or mark, its note, and a "⋯" that reveals the actions. */
function MineRow({
  item,
  expanded,
  onToggle,
  group,
  sharedIds,
  canJump,
  onJump,
  onSave,
  onRemove,
  onShare,
  onUnshare,
  offline,
}: MineRowProps) {
  const quote = itemQuote(item);
  const note = itemNote(item);
  const percent = itemPercent(item);
  const panelId = useId();
  const textareaId = useId();
  const countId = useId();
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Focus follows the note form: into the textarea on open, back to the
  // Add / Edit note button when the form closes by Save or Cancel.
  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      noteButtonRef.current?.focus();
    }
  }, [editing]);

  const sharedNames = group ? sharedGroupNames(sharedIds, group.reads) : [];
  const check = noteDraft(draft);
  const showEdit = expanded && editing;
  const truncated = isQuoteTruncated(quote);

  function startEdit(): void {
    setDraft(note ?? "");
    setEditing(true);
  }

  function closeEdit(): void {
    restoreFocus.current = true;
    setEditing(false);
    setDraft("");
  }

  function save(): void {
    if (check.overLimit) return;
    onSave(check.value);
    closeEdit();
  }

  function requestRemove(): void {
    if (note === null) onRemove();
    else setConfirming(true);
  }

  const caption = percent === null ? "" : `${percent}%`;

  return (
    <li className="flex flex-col">
      <div className="flex items-start gap-[var(--leaf-space-1)]">
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--leaf-space-1)] px-[var(--leaf-space-2)] py-[var(--leaf-space-1)]">
          {quote !== null ? (
            <p
              className="line-clamp-2 break-words font-ui [font-size:var(--leaf-text-xs)]"
              style={TEXT}
            >
              {quote}
            </p>
          ) : (
            <p className="font-ui [font-size:var(--leaf-text-xs)]" style={TEXT}>
              Marked page
            </p>
          )}
          {note !== null && (
            <p
              className="whitespace-pre-wrap break-words font-ui [font-size:var(--leaf-text-xs)]"
              style={MUTED}
            >
              {note}
            </p>
          )}
          {caption !== "" && (
            <p className={captionClass} style={MUTED}>
              {caption}
            </p>
          )}
          {sharedNames.length > 0 && (
            <p className={captionClass} style={MUTED}>
              {`Shared with ${sharedNames.join(", ")}`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            onToggle();
          }}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`Actions for ${itemTitle(item)}`}
          className={`${rowButtonClass} flex-none font-mono`}
          style={MUTED}
        >
          ⋯
        </button>
      </div>

      {expanded && (
        <div
          id={panelId}
          className="flex flex-col gap-[var(--leaf-space-1)] border-l px-[var(--leaf-space-2)] py-[var(--leaf-space-1)]"
          style={LINE}
        >
          {showEdit ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
              className="flex flex-col gap-[var(--leaf-space-2)]"
            >
              <label
                htmlFor={textareaId}
                className="font-ui [font-size:var(--leaf-text-xs)]"
                style={MUTED}
              >
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
                style={FIELD}
              />
              {check.overLimit && (
                <p className="font-ui [font-size:var(--leaf-text-xs)]" style={ACCENT}>
                  Up to {ANNOTATION_NOTE_MAX} characters.
                </p>
              )}
              <div className="flex items-center justify-between gap-[var(--leaf-space-2)]">
                <span
                  id={countId}
                  className={captionClass}
                  style={check.overLimit ? ACCENT : MUTED}
                >
                  {`${check.length}/${ANNOTATION_NOTE_MAX}`}
                </span>
                <div className="flex gap-[var(--leaf-space-2)]">
                  <button type="button" onClick={closeEdit} className={rowButtonClass} style={MUTED}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={check.overLimit}
                    className={rowButtonClass}
                    style={TEXT}
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <>
              {canJump && (
                <button type="button" onClick={onJump} className={rowButtonClass} style={TEXT}>
                  Jump
                </button>
              )}
              <button
                ref={noteButtonRef}
                type="button"
                onClick={startEdit}
                className={rowButtonClass}
                style={TEXT}
              >
                {note === null ? "Add note" : "Edit note"}
              </button>
              {group && group.reads.length > 0 && (
                <div className="flex flex-col gap-[var(--leaf-space-1)]">
                  {offline && (
                    <p className="font-ui [font-size:var(--leaf-text-xs)]" style={MUTED}>
                      Needs a connection
                    </p>
                  )}
                  {group.reads.map((read) => {
                    const shared = sharedIds.includes(read.id);
                    return (
                      <button
                        key={read.id}
                        type="button"
                        disabled={offline}
                        onClick={() => (shared ? onUnshare(read.id) : onShare(read.id))}
                        className={rowButtonClass}
                        style={TEXT}
                      >
                        {shared
                          ? `Unshare from ${read.groupName}`
                          : `Share with ${read.groupName}`}
                      </button>
                    );
                  })}
                  {truncated && (
                    <p className="font-ui [font-size:var(--leaf-text-xs)]" style={MUTED}>
                      {`Shares the first ${QUOTE_SHARE_MAX} characters`}
                    </p>
                  )}
                </div>
              )}
              <button type="button" onClick={requestRemove} className={rowButtonClass} style={TEXT}>
                Remove
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          itemIsMark(item)
            ? "Remove this mark and its note?"
            : "Remove this highlight and its note?"
        }
        description="Group copies are removed too."
        confirmLabel="Remove"
        onConfirm={async () => {
          onRemove();
        }}
      />
    </li>
  );
}

interface GroupRowProps {
  item: Extract<AnnotationListItem, { source: "group" }>;
  authorName: string;
  jumpable: boolean;
  onJump: () => void;
}

/** A visible group note: author, quote or "Marked page", and the note text. Read-only except Jump. */
function GroupRow({ item, authorName, jumpable, onJump }: GroupRowProps) {
  const quote = itemQuote(item);
  const note = itemNote(item);
  const body = (
    <>
      <span className="block font-mono [font-size:var(--leaf-text-3xs)]" style={MUTED}>
        {authorName}
      </span>
      {quote !== null ? (
        <span className="line-clamp-2 block break-words font-ui [font-size:var(--leaf-text-xs)]" style={TEXT}>
          {quote}
        </span>
      ) : (
        itemIsMark(item) && (
          <span className="block font-ui [font-size:var(--leaf-text-xs)]" style={TEXT}>
            Marked page
          </span>
        )
      )}
      {note !== null && (
        <span className="block whitespace-pre-wrap break-words font-ui [font-size:var(--leaf-text-xs)]" style={TEXT}>
          {note}
        </span>
      )}
    </>
  );

  return (
    <li>
      {jumpable ? (
        <button
          type="button"
          onClick={onJump}
          className={`${rowButtonClass} w-full`}
          style={TEXT}
        >
          <span className="min-w-0 flex-1 flex flex-col gap-[var(--leaf-space-1)]">{body}</span>
        </button>
      ) : (
        <div className="flex w-full flex-col gap-[var(--leaf-space-1)] px-[var(--leaf-space-2)] py-[var(--leaf-space-1)]">
          {body}
        </div>
      )}
    </li>
  );
}
