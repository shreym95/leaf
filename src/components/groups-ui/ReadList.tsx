import Link from "next/link";
import { bodyClass, linkClass } from "./styles";

export interface ReadListItem {
  id: string;
  title: string;
  author: string;
}

export interface ReadListProps {
  groupId: string;
  reads: ReadListItem[];
}

export function ReadList({ groupId, reads }: ReadListProps) {
  if (reads.length === 0) {
    return <p className={bodyClass}>No reads yet.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {reads.map((r) => (
        <li
          key={r.id}
          className="flex flex-col gap-0.5 border-b border-rule-soft py-2"
        >
          <Link
            href={`/groups/${groupId}/reads/${r.id}`}
            className={`${linkClass} self-start font-display [font-size:var(--leaf-text-lg)]`}
          >
            {r.title}
          </Link>
          <span className={bodyClass}>{r.author}</span>
        </li>
      ))}
    </ul>
  );
}
