import { Button } from "@/components/primitives";
import type { GroupMemberName } from "@/lib/types";
import { labelClass } from "./styles";

export interface MemberListProps {
  members: GroupMemberName[];
  currentUserId: string;
  /** Owner only. Shows a Remove button on every member except yourself. */
  canRemove: boolean;
  onRemove: (member: GroupMemberName) => void;
}

export function memberDisplayName(member: GroupMemberName): string {
  return member.display_name?.trim() || "Reader";
}

const tagClass =
  "font-mono uppercase text-faint [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]";

export function MemberList({
  members,
  currentUserId,
  canRemove,
  onRemove,
}: MemberListProps) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {members.map((m) => {
        const name = memberDisplayName(m);
        const isSelf = m.user_id === currentUserId;
        return (
          <li
            key={m.user_id}
            className="flex items-center justify-between gap-3 border-b border-rule-soft py-2"
          >
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
              <span className={`${labelClass} truncate`}>{name}</span>
              {m.role === "owner" ? <span className={tagClass}>Owner</span> : null}
              {isSelf ? <span className={tagClass}>You</span> : null}
            </span>
            {canRemove && !isSelf ? (
              <Button
                variant="quiet"
                size="sm"
                aria-label={`Remove ${name}`}
                onClick={() => onRemove(m)}
              >
                Remove
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
