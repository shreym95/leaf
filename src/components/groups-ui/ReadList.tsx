import Link from "next/link";
import { Button } from "@/components/primitives";
import { bodyClass, linkClass } from "./styles";

export interface ReadListItem {
  id: string;
  title: string;
  author: string;
  /** User id of the member who added the read; null once their account is gone. */
  createdBy?: string | null;
}

export interface ReadListProps {
  groupId: string;
  reads: ReadListItem[];
  /** Which reads show a Remove button. Omit to show none. */
  canRemove?: (read: ReadListItem) => boolean;
  onRemove?: (read: ReadListItem) => void;
}

export function ReadList({ groupId, reads, canRemove, onRemove }: ReadListProps) {
  if (reads.length === 0) {
    return <p className={bodyClass}>No reads yet.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {reads.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-3 border-b border-rule-soft py-2"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={`/groups/${groupId}/reads/${r.id}`}
              className={`${linkClass} self-start font-display [font-size:var(--leaf-text-lg)]`}
            >
              {r.title}
            </Link>
            <span className={bodyClass}>{r.author}</span>
          </span>
          {onRemove && canRemove?.(r) ? (
            <Button
              variant="quiet"
              size="sm"
              aria-label={`Remove ${r.title}`}
              onClick={() => onRemove(r)}
            >
              Remove
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
