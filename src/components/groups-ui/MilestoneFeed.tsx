import { formatDay, type FeedItem } from "./readModel";
import { bodyClass, labelClass } from "./styles";

export interface MilestoneFeedProps {
  items: FeedItem[];
}

/** Newest first: who reached what, with the date. Arrival order only, never pace. */
export function MilestoneFeed({ items }: MilestoneFeedProps) {
  if (items.length === 0) return <p className={bodyClass}>No milestones yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-rule-soft py-2"
        >
          <span className={labelClass}>{item.text}</span>
          <time
            dateTime={item.at}
            className="font-mono text-faint [font-size:var(--leaf-text-2xs)]"
          >
            {formatDay(item.at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
