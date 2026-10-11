"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { createGroup } from "./actions";
import { GroupList, type GroupListItem } from "./GroupList";
import { GroupNameDialog } from "./GroupNameDialog";
import { bodyClass } from "./styles";

export interface GroupsScreenProps {
  groups: GroupListItem[];
}

export function GroupsScreen({ groups }: GroupsScreenProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleCreate(name: string) {
    const group = await createGroup(name);
    router.push(`/groups/${group.id}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="font-display text-ink [font-size:var(--leaf-text-3xl)]">
          Groups
        </h1>
        <Button onClick={() => setOpen(true)}>New group</Button>
      </header>

      {groups.length === 0 ? (
        <p className={bodyClass}>No groups yet.</p>
      ) : (
        <GroupList groups={groups} />
      )}

      <GroupNameDialog
        open={open}
        onOpenChange={setOpen}
        title="New group"
        submitLabel="Create"
        onSubmit={handleCreate}
      />
    </main>
  );
}
