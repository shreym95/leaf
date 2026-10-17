"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { createClient } from "@/lib/supabase/client";
import { setManualProgress } from "@/lib/db/groups";
import type { Outline } from "@/lib/groups/types";
import type {
  BookSource,
  GroupMemberName,
  ReadMilestone,
  ReadProgress,
} from "@/lib/types";
import { addMyCopy, canRemoveRead, removeGroupRead } from "./actions";
import { BookPickerDialog } from "./BookPickerDialog";
import { CopyPanel, type CopyPanelState } from "./CopyPanel";
import { ManualProgress } from "./ManualProgress";
import { MilestoneFeed } from "./MilestoneFeed";
import { OutlineView } from "./OutlineView";
import { RemoveReadDialog } from "./RemoveReadDialog";
import { buildFeed, placeMembers, reachedPoints } from "./readModel";
import { backLinkClass, bodyClass, sectionHeadingClass } from "./styles";
import { useOwnBooks, type OwnBook } from "./useOwnBooks";

export interface ReadScreenProps {
  groupId: string;
  groupName: string;
  currentUserId: string;
  read: {
    id: string;
    title: string;
    author: string;
    source: BookSource;
    outline: Outline;
    /** User id of the member who added the read, or null. */
    createdBy?: string | null;
  };
  members: GroupMemberName[];
  progress: ReadProgress[];
  milestones: ReadMilestone[];
  /** The caller's own copy, or null when they have none. */
  copy: { bookId: string; confidence: number | null } | null;
}

export function ReadScreen({
  groupId,
  groupName,
  currentUserId,
  read,
  members,
  progress,
  milestones,
  copy,
}: ReadScreenProps) {
  const router = useRouter();
  const [chooseOpen, setChooseOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const ownBooks = useOwnBooks(currentUserId, chooseOpen);

  const isOwner = members.some(
    (m) => m.user_id === currentUserId && m.role === "owner",
  );
  const canRemove = canRemoveRead(isOwner, currentUserId, read.createdBy);

  const placements = placeMembers(read.outline, progress, members, currentUserId);
  const reached = reachedPoints(milestones, currentUserId);
  const feed = buildFeed({
    outline: read.outline,
    milestones,
    members,
    viewerId: currentUserId,
  });
  const mine = progress.find((p) => p.user_id === currentUserId);

  const copyState: CopyPanelState = copy
    ? { kind: "have", bookId: copy.bookId, confidence: copy.confidence }
    : read.source === "upload"
      ? { kind: "upload" }
      : { kind: "catalog" };

  async function handleAddCatalog() {
    if (pending) return;
    setPending(true);
    setCopyError(null);
    try {
      await addMyCopy(groupId, read.id);
      setAdded(true);
      router.refresh();
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Could not add your copy.");
    } finally {
      setPending(false);
    }
  }

  async function handleChoose(book: OwnBook) {
    await addMyCopy(groupId, read.id, book.id);
    setAdded(true);
    router.refresh();
  }

  async function handleRemove() {
    await removeGroupRead(groupId, read.id);
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  async function handleSetChapter(chapterIndex: number) {
    await setManualProgress(
      currentUserId,
      read.id,
      { chapterIndex, chapterFraction: 0 },
      createClient(),
    );
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <Link href={`/groups/${groupId}`} className={backLinkClass}>
          &larr; {groupName}
        </Link>
        <h1 className="min-w-0 break-words font-display text-ink [font-size:var(--leaf-text-3xl)]">
          {read.title}
        </h1>
        {read.author ? <p className={bodyClass}>{read.author}</p> : null}
        {canRemove ? (
          <div>
            <Button variant="quiet" size="sm" onClick={() => setRemoveOpen(true)}>
              Remove book
            </Button>
          </div>
        ) : null}
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="read-copy">
        <h2 id="read-copy" className={sectionHeadingClass}>
          Your copy
        </h2>
        <CopyPanel
          state={copyState}
          pending={pending}
          added={added}
          error={copyError}
          onAddCatalog={handleAddCatalog}
          onChoose={() => setChooseOpen(true)}
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="read-where">
        <h2 id="read-where" className={sectionHeadingClass}>
          Where everyone is
        </h2>
        <OutlineView
          outline={read.outline}
          placements={placements}
          reached={reached}
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="read-progress">
        <h2 id="read-progress" className={sectionHeadingClass}>
          Your place
        </h2>
        <ManualProgress
          outline={read.outline}
          current={mine?.chapter_index ?? null}
          hasCopy={copy !== null}
          reached={reached}
          onSet={handleSetChapter}
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="read-milestones">
        <h2 id="read-milestones" className={sectionHeadingClass}>
          Milestones
        </h2>
        <MilestoneFeed items={feed} />
      </section>

      <RemoveReadDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        onConfirm={handleRemove}
      />

      <BookPickerDialog
        open={chooseOpen}
        onOpenChange={setChooseOpen}
        title="Choose your copy"
        description="Each member uses their own copy."
        books={ownBooks}
        onPick={handleChoose}
      />
    </main>
  );
}
