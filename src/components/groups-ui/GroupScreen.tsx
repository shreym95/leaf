"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import type { GroupMemberName } from "@/lib/types";
import {
  addRead,
  canRemoveRead,
  leaveGroup,
  removeGroupRead,
  removeMember,
  renameGroup,
} from "./actions";
import { BookPickerDialog } from "./BookPickerDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { GroupNameDialog } from "./GroupNameDialog";
import { InviteLinkControl } from "./InviteLinkControl";
import { MemberList, memberDisplayName } from "./MemberList";
import { ReadList, type ReadListItem } from "./ReadList";
import { RemoveReadDialog } from "./RemoveReadDialog";
import { backLinkClass, sectionHeadingClass } from "./styles";
import { useInviteLink } from "./useInviteLink";
import { useOwnBooks, type OwnBook } from "./useOwnBooks";

export interface GroupScreenProps {
  groupId: string;
  name: string;
  currentUserId: string;
  members: GroupMemberName[];
  reads: ReadListItem[];
}

export function GroupScreen({
  groupId,
  name,
  currentUserId,
  members,
  reads,
}: GroupScreenProps) {
  const router = useRouter();
  const isOwner = members.some(
    (m) => m.user_id === currentUserId && m.role === "owner",
  );
  const [renameOpen, setRenameOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removing, setRemoving] = useState<GroupMemberName | null>(null);
  const [removingRead, setRemovingRead] = useState<ReadListItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const invite = useInviteLink(groupId);
  const ownBooks = useOwnBooks(currentUserId, addOpen);

  async function handleRename(next: string) {
    await renameGroup(groupId, next);
    router.refresh();
  }

  async function handleLeave() {
    await leaveGroup(groupId);
    router.push("/groups");
    router.refresh();
  }

  async function handleRemove() {
    if (!removing) return;
    await removeMember(groupId, removing.user_id);
    router.refresh();
  }

  async function handleRemoveRead() {
    if (!removingRead) return;
    await removeGroupRead(groupId, removingRead.id);
    router.refresh();
  }

  async function handleAddBook(book: OwnBook) {
    await addRead(groupId, book);
    router.refresh();
  }

  const leaveDescription =
    members.length <= 1
      ? "You are the last member. The group will be deleted."
      : isOwner
        ? "Ownership passes to the longest-standing member."
        : undefined;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <Link href="/groups" className={backLinkClass}>
          &larr; Groups
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="min-w-0 break-words font-display text-ink [font-size:var(--leaf-text-3xl)]">
            {name}
          </h1>
          {isOwner ? (
            <Button variant="ghost" size="sm" onClick={() => setRenameOpen(true)}>
              Rename
            </Button>
          ) : null}
        </div>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="group-members">
        <h2 id="group-members" className={sectionHeadingClass}>
          Members
        </h2>
        <MemberList
          members={members}
          currentUserId={currentUserId}
          canRemove={isOwner}
          onRemove={setRemoving}
        />
        {isOwner ? (
          <InviteLinkControl state={invite.state} onCopy={invite.copy} />
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="group-reads">
        <div className="flex items-center justify-between gap-3">
          <h2 id="group-reads" className={sectionHeadingClass}>
            Reads
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
            Add a book
          </Button>
        </div>
        <ReadList
          groupId={groupId}
          reads={reads}
          canRemove={(r) => canRemoveRead(isOwner, currentUserId, r.createdBy)}
          onRemove={setRemovingRead}
        />
      </section>

      <div>
        <Button variant="ghost" onClick={() => setLeaveOpen(true)}>
          Leave group
        </Button>
      </div>

      {isOwner ? (
        <GroupNameDialog
          key={name}
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title="Rename group"
          submitLabel="Save"
          initialName={name}
          onSubmit={handleRename}
        />
      ) : null}

      <BookPickerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add a book"
        books={ownBooks}
        onPick={handleAddBook}
      />

      <RemoveReadDialog
        open={removingRead !== null}
        onOpenChange={(next) => {
          if (!next) setRemovingRead(null);
        }}
        onConfirm={handleRemoveRead}
      />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave this group?"
        description={leaveDescription}
        confirmLabel="Leave group"
        onConfirm={handleLeave}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        title={removing ? `Remove ${memberDisplayName(removing)}?` : "Remove member?"}
        confirmLabel="Remove"
        onConfirm={handleRemove}
      />
    </main>
  );
}
