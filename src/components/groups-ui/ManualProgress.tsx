"use client";

import { Fragment, useId, useState } from "react";
import { Button } from "@/components/primitives";
import type { Outline } from "@/lib/groups/types";
import { partTitle } from "./readModel";
import { bodyClass, errorClass, inputClass, labelClass } from "./styles";

export interface ManualProgressProps {
  outline: Outline;
  /** The member's current chapter index, or null before any progress. */
  current: number | null;
  hasCopy: boolean;
  /** Points the viewer has reached; unreached Parts show their number only. */
  reached: Set<string>;
  /** Resolves on success; throw an Error to show its message. */
  onSet: (chapterIndex: number) => Promise<void>;
}

/** "I'm at" chapter picker. Available to everyone; the only way without a copy. */
export function ManualProgress({
  outline,
  current,
  hasCopy,
  reached,
  onSet,
}: ManualProgressProps) {
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const selectId = useId();
  const hintId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || value === "") return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await onSet(Number(value));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your place.");
    } finally {
      setPending(false);
    }
  }

  // Chapters grouped under their Part, in outline order.
  const groups: { part: number | null; label: string | null; entries: Outline }[] =
    [];
  for (const entry of outline) {
    const last = groups[groups.length - 1];
    if (last && last.part === entry.partIndex) {
      last.entries.push(entry);
    } else {
      groups.push({
        part: entry.partIndex,
        label:
          entry.partIndex === null
            ? null
            : partTitle(reached, entry.partIndex, entry.partLabel),
        entries: [entry],
      });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={selectId} className={labelClass}>
        I&rsquo;m at
      </label>
      {!hasCopy ? (
        <p id={hintId} className={bodyClass}>
          You have no copy yet, so set your place by hand.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <select
          id={selectId}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          aria-describedby={!hasCopy ? hintId : undefined}
          className={`${inputClass} min-w-0 max-w-full flex-1`}
        >
          <option value="" disabled>
            Choose a chapter
          </option>
          {groups.map((g, i) => {
            const options = g.entries.map((entry) => (
              <option key={entry.index} value={entry.index}>
                {entry.label}
              </option>
            ));
            return g.label ? (
              <optgroup key={i} label={g.label}>
                {options}
              </optgroup>
            ) : (
              <Fragment key={i}>{options}</Fragment>
            );
          })}
        </select>
        <Button type="submit" variant="ghost" disabled={pending || value === ""}>
          Set
        </Button>
      </div>
      <p role="status" className={bodyClass}>
        {saved ? "Saved." : ""}
      </p>
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
