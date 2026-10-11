import Link from "next/link";
import type { GroupRole } from "@/lib/types";

export interface GroupListItem {
  id: string;
  name: string;
  memberCount: number;
  role: GroupRole;
}

export interface GroupListProps {
  groups: GroupListItem[];
}

export function memberCountLabel(count: number): string {
  return `${count} ${count === 1 ? "member" : "members"}`;
}

export function GroupList({ groups }: GroupListProps) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {groups.map((g) => (
        <li key={g.id}>
          <Link
            href={`/groups/${g.id}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-rule px-4 py-3 transition-colors hover:bg-edge [transition-duration:var(--leaf-dur-ui)] focus-visible:outline-none focus-visible:[box-shadow:var(--leaf-shadow-focus)]"
          >
            <span className="font-display text-ink [font-size:var(--leaf-text-lg)]">
              {g.name}
            </span>
            <span className="font-mono uppercase text-faint [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]">
              {memberCountLabel(g.memberCount)}
              {" · "}
              {g.role === "owner" ? "Owner" : "Member"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
