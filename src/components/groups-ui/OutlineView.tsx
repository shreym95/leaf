import type { Outline } from "@/lib/groups/types";
import { partTitle, type Placement, type Placements } from "./readModel";
import { bodyClass, labelClass, sectionHeadingClass } from "./styles";

export interface OutlineViewProps {
  outline: Outline;
  placements: Placements;
  /** Points the viewer has reached; unreached Parts show their number only. */
  reached: Set<string>;
}

function Marker({ placement }: { placement: Placement }) {
  return (
    <span
      className={`max-w-32 truncate rounded-sm border px-2 py-0.5 font-mono text-ink [font-size:var(--leaf-text-2xs)] ${
        placement.manual ? "border-dashed" : "border-solid"
      } ${placement.isSelf ? "border-ink bg-edge" : "border-rule"}`}
    >
      {placement.name}
      {placement.manual ? <span className="sr-only"> (set by hand)</span> : null}
    </span>
  );
}

/** The read's chapters in order, with each member's marker at their chapter. */
export function OutlineView({ outline, placements, reached }: OutlineViewProps) {
  return (
    <div className="flex flex-col gap-3">
      {placements.notStarted.length > 0 ? (
        <p className={bodyClass}>Not started: {placements.notStarted.join(", ")}</p>
      ) : null}
      <ol aria-label="Chapters" className="m-0 flex list-none flex-col p-0">
        {outline.map((entry, i) => {
          const part = entry.partIndex;
          const startsPart = part !== null && outline[i - 1]?.partIndex !== part;
          const here = placements.byChapter.get(entry.index) ?? [];
          return (
            <li key={entry.index} className="contents">
              {startsPart ? (
                <p className={`${sectionHeadingClass} pt-4 pb-1`}>
                  {partTitle(reached, part, entry.partLabel)}
                </p>
              ) : null}
              <div
                className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-rule-soft py-2 ${
                  part !== null ? "pl-3" : ""
                }`}
              >
                <span className={here.length > 0 ? labelClass : bodyClass}>
                  {entry.label}
                </span>
                {here.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {here.map((p) => (
                      <Marker key={p.userId} placement={p} />
                    ))}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
