"use client";

import { useSyncExternalStore } from "react";
import { isPastDue, todayIso, type ScheduleRow } from "./readModel";
import { bodyClass, labelClass } from "./styles";

const noopSubscribe = () => () => {};

/**
 * Today's date, read after hydration so the server render and the first client render
 * agree (both show no status), then the real one. Null on the server.
 */
function useToday(): string | null {
  return useSyncExternalStore(noopSubscribe, () => todayIso(), () => null);
}

/** A checkpoint date in the viewer's locale. Shows the ISO date until hydrated. */
function LocalDate({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noopSubscribe,
    () => formatLocal(iso),
    () => iso,
  );
  return <time dateTime={iso}>{text}</time>;
}

function formatLocal(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

const tagClass =
  "font-mono uppercase text-faint [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]";

const pastDueClass =
  "font-mono uppercase text-accent [font-size:var(--leaf-text-2xs)] [letter-spacing:var(--leaf-tracking-label)]";

export interface ScheduleListProps {
  rows: ScheduleRow[];
}

/** The read's checkpoints in order: "Through <chapter>", the date, and the viewer's status. */
export function ScheduleList({ rows }: ScheduleListProps) {
  const today = useToday();
  return (
    <ol aria-label="Checkpoints" className="m-0 flex list-none flex-col p-0">
      {rows.map((row) => {
        const pastDue =
          today !== null && !row.reached && isPastDue(row.dueOn, today);
        return (
          <li
            key={row.chapterIndex}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule-soft py-2"
          >
            <span className={labelClass}>{row.label}</span>
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {row.reached ? <span className={tagClass}>Reached</span> : null}
              {pastDue ? <span className={pastDueClass}>Past due</span> : null}
              <span className={bodyClass}>
                by <LocalDate iso={row.dueOn} />
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
