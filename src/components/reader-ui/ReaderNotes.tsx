"use client";

// The Notes tab body the reader hands to `TocPopover` (NOTES_PLAN N2b/N2c). It mounts
// when the tab opens, so the group reads and share state load lazily at that point, and
// again on window focus. It owns no persistence of its own: personal writes come in as
// callbacks from the reader's annotation manager, and the group calls are the
// `read-notes` client, which the flag and the linked read gate.

import { useCallback, useEffect, useState } from "react";
import { GROUPS_ENABLED } from "@/lib/groups/flag";
import {
  listSharedReads,
  listVisibleNotes,
  shareAnnotation,
  unshareAnnotation,
} from "@/lib/db/read-notes";
import type { Annotation, VisibleReadNote } from "@/lib/types";
import { AnnotationList } from "./AnnotationList";
import type {
  AnnotationGroupContext,
  AnnotationListItem,
} from "./annotation-list";
import { chapterLabelOf, noteJump, outlinePositionFor, type PlaceInBook } from "./group-notes";
import type { GroupReadsState } from "./useGroupReads";

export interface ReaderNotesProps {
  /** My personal items, in position order (the annotation manager's list). */
  mine: Annotation[];
  /** The linked group reads, or null: no group requests, no Group filter. */
  groupReads: GroupReadsState | null;
  /** The reader's current place. Sharing places an item from this, see `onShare`. */
  place: PlaceInBook;
  /** Offline: group items and share/unshare are unavailable. */
  offline: boolean;
  /** Navigate to a CFI or href in the book (the reader closes its deck first). */
  onJump: (target: string) => void;
  onSaveNote: (id: string, note: string | null) => void;
  onRemove: (id: string) => void;
}

const STATUS_CLASS = "font-mono [font-size:var(--leaf-text-3xs)]";

/** Visible group notes for each read. A read that fails keeps no entry (its list stays). */
async function fetchReadNotes(
  reads: readonly { readId: string }[],
): Promise<Record<string, VisibleReadNote[]>> {
  const results = await Promise.all(
    reads.map(async (read) => {
      try {
        return [read.readId, await listVisibleNotes(read.readId)] as const;
      } catch {
        return null;
      }
    }),
  );
  const out: Record<string, VisibleReadNote[]> = {};
  for (const r of results) if (r) out[r[0]] = r[1];
  return out;
}

export function ReaderNotes({
  mine,
  groupReads,
  place,
  offline,
  onJump,
  onSaveNote,
  onRemove,
}: ReaderNotesProps) {
  const groupOn = GROUPS_ENABLED && groupReads !== null && !offline;
  const [notesByRead, setNotesByRead] = useState<Record<string, VisibleReadNote[]>>({});
  const [sharedReadIds, setSharedReadIds] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<string | null>(null);

  const refreshNotes = useCallback(() => {
    if (!groupReads || !groupOn) return;
    void fetchReadNotes(groupReads.reads).then((next) =>
      setNotesByRead((prev) => ({ ...prev, ...next })),
    );
  }, [groupReads, groupOn]);

  // Opened once per Notes tab mount: the share state of the items on the list.
  // Items added later are not shared yet, so they need no lookup.
  useEffect(() => {
    if (!groupOn) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        mine.map(async (a) => {
          try {
            const rows = await listSharedReads(a.id);
            return { id: a.id, readIds: rows.map((r) => r.read_id) };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setSharedReadIds((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r.id] = r.readIds;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, see above
  }, [groupOn]);

  // Group notes load when the tab opens and again whenever the window regains focus.
  useEffect(() => {
    if (!groupOn || !groupReads) return;
    let cancelled = false;
    const load = () =>
      void fetchReadNotes(groupReads.reads).then((next) => {
        if (!cancelled) setNotesByRead((prev) => ({ ...prev, ...next }));
      });
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [groupOn, groupReads]);

  const readById = (readId: string) =>
    groupReads?.reads.find((r) => r.readId === readId) ?? null;

  const group: AnnotationGroupContext | null =
    groupOn && groupReads
      ? {
          reads: groupReads.reads.map((r) => ({ id: r.readId, groupName: r.groupName })),
          notes: groupReads.reads.flatMap((r) => notesByRead[r.readId] ?? []),
          names: Object.fromEntries(
            groupReads.reads.flatMap((r) => [...r.names]),
          ),
          meId: groupReads.userId,
        }
      : null;

  const sectionLabelFor = (item: AnnotationListItem): string => {
    if (item.source === "mine") return item.annotation.label ?? "Unknown";
    const read = readById(item.note.read_id);
    return read ? chapterLabelOf(read.outline, item.note.chapter_index) : "Unknown";
  };

  const canJump = (item: AnnotationListItem): boolean => {
    if (item.source === "mine") return true;
    const read = readById(item.note.read_id);
    return read !== null && noteJump(read, item.note) !== null;
  };

  const jump = (item: AnnotationListItem) => {
    if (item.source === "mine") {
      onJump(item.annotation.cfi);
      return;
    }
    const read = readById(item.note.read_id);
    const target = read ? noteJump(read, item.note) : null;
    if (target) onJump(target.target);
  };

  const share = async (id: string, readId: string) => {
    const item = mine.find((a) => a.id === id);
    const read = readById(readId);
    if (!item || !read || !groupReads) return;
    // A share needs a position in the group's outline. The engine can place only the
    // page on screen, so an item is shared from the page it sits on.
    if (item.cfi !== place.cfi) {
      setStatus("Open this page to share it.");
      return;
    }
    const position = outlinePositionFor(read, place);
    if (!position) {
      setStatus("This page can't be placed in the group read.");
      return;
    }
    try {
      await shareAnnotation({
        annotation: item,
        readId,
        userId: groupReads.userId,
        position: {
          chapterIndex: position.chapterIndex,
          chapterFraction: position.chapterFraction,
        },
        contentSha256: read.copySha256,
        prefix: "",
        suffix: "",
      });
      setSharedReadIds((prev) => ({
        ...prev,
        [id]: [...new Set([...(prev[id] ?? []), readId])],
      }));
      setStatus(null);
      void refreshNotes();
    } catch {
      setStatus("Couldn't share this item. It may not have synced yet.");
    }
  };

  const unshare = async (id: string, readId: string) => {
    try {
      await unshareAnnotation(id, readId);
      setSharedReadIds((prev) => ({
        ...prev,
        [id]: (prev[id] ?? []).filter((r) => r !== readId),
      }));
      setStatus(null);
      void refreshNotes();
    } catch {
      setStatus("Couldn't unshare this item. Try again when online.");
    }
  };

  return (
    <div className="flex flex-col gap-[var(--leaf-space-2)]">
      <AnnotationList
        mine={mine}
        group={group}
        sharedReadIds={sharedReadIds}
        sectionLabelFor={sectionLabelFor}
        canJump={canJump}
        onJump={jump}
        onSaveNote={onSaveNote}
        onRemove={(id) => {
          setSharedReadIds((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          onRemove(id);
        }}
        onShare={(id, readId) => void share(id, readId)}
        onUnshare={(id, readId) => void unshare(id, readId)}
        offline={offline}
      />
      <p role="status" aria-live="polite" className={STATUS_CLASS} style={{ color: "var(--leaf-dock-text-muted)" }}>
        {status ?? ""}
      </p>
    </div>
  );
}
