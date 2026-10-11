// Pure view-models for the group read page: where members are in the outline, and
// the milestone feed. No React, no data access.
//
// Masking rule (one rule, used by the feed): a Part you have not reached is named by
// its number only ("Part 3"), never by its title. "Halfway" and "The end" are never
// masked. Arrival order is shown; time gaps and pace never are.

import { milestonePoints } from "@/lib/groups/outline";
import type { Outline } from "@/lib/groups/types";
import type { GroupMemberName, ReadMilestone, ReadProgress } from "@/lib/types";
import { memberDisplayName } from "./MemberList";

export interface Placement {
  userId: string;
  name: string;
  isSelf: boolean;
  /** True when the member set their place by hand. */
  manual: boolean;
}

export interface Placements {
  /** Members at each outline chapter, keyed by chapter index. */
  byChapter: Map<number, Placement[]>;
  /** Names of members with no progress row yet. */
  notStarted: string[];
}

function nameOf(member: GroupMemberName, currentUserId: string): string {
  return member.user_id === currentUserId ? "You" : memberDisplayName(member);
}

export function placeMembers(
  outline: Outline,
  progress: ReadProgress[],
  members: GroupMemberName[],
  currentUserId: string,
): Placements {
  const byChapter = new Map<number, Placement[]>();
  const notStarted: string[] = [];
  const rows = new Map(progress.map((p) => [p.user_id, p]));
  const last = Math.max(0, outline.length - 1);

  for (const m of members) {
    const name = nameOf(m, currentUserId);
    const row = rows.get(m.user_id);
    if (!row) {
      notStarted.push(name);
      continue;
    }
    const index = Math.min(Math.max(Math.trunc(row.chapter_index), 0), last);
    const list = byChapter.get(index) ?? [];
    list.push({
      userId: m.user_id,
      name,
      isSelf: m.user_id === currentUserId,
      manual: row.manual,
    });
    byChapter.set(index, list);
  }
  return { byChapter, notStarted };
}

/** Milestone points the viewer has reached themselves. */
export function reachedPoints(
  milestones: ReadMilestone[],
  viewerId: string,
): Set<string> {
  return new Set(
    milestones.filter((r) => r.user_id === viewerId).map((r) => r.point),
  );
}

/** A Part's title once the viewer has reached it; otherwise its number only. */
export function partTitle(
  reached: Set<string>,
  partIndex: number,
  label: string | null,
): string {
  return reached.has(`part:${partIndex}`) && label
    ? label
    : `Part ${partIndex + 1}`;
}

export interface FeedItem {
  key: string;
  text: string;
  /** ISO timestamp of the arrival the line describes. */
  at: string;
}

export function buildFeed({
  outline,
  milestones,
  members,
  viewerId,
}: {
  outline: Outline;
  milestones: ReadMilestone[];
  members: GroupMemberName[];
  viewerId: string;
}): FeedItem[] {
  const defs = new Map(milestonePoints(outline).map((d) => [d.point as string, d]));
  const order = [...defs.keys()];
  const memberById = new Map(members.map((m) => [m.user_id, m]));

  // Current members' arrivals only, oldest first.
  const rows = milestones
    .filter((r) => defs.has(r.point) && memberById.has(r.user_id))
    .sort(
      (a, b) =>
        a.reached_at.localeCompare(b.reached_at) ||
        order.indexOf(a.point) - order.indexOf(b.point),
    );

  const viewerReached = reachedPoints(rows, viewerId);

  function labelOf(point: string, n: number | null): string {
    if (point === "half") return "Halfway";
    if (point === "end") return "The end";
    return partTitle(viewerReached, n ?? 0, defs.get(point)?.label ?? null);
  }

  const arrived = new Map<string, Set<string>>();
  const events: FeedItem[] = [];
  for (const row of rows) {
    const n = row.point.startsWith("part:") ? Number(row.point.slice(5)) : null;
    const label = labelOf(row.point, n);
    const name = nameOf(memberById.get(row.user_id)!, viewerId);
    const seen = arrived.get(row.point) ?? new Set<string>();
    const first = seen.size === 0;
    seen.add(row.user_id);
    arrived.set(row.point, seen);

    events.push({
      key: `${row.point}:${row.user_id}`,
      text: first ? `First to ${label}: ${name}` : `${name} reached ${label}`,
      at: row.reached_at,
    });
    if (members.length >= 2 && seen.size === members.length) {
      events.push({
        key: `${row.point}:everyone`,
        text: `Everyone reached ${label}`,
        at: row.reached_at,
      });
    }
  }

  // Newest first. Equal timestamps keep the later event on top.
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i)
    .map(({ e }) => e);
}

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** A fixed-locale, UTC date so server and client render the same text. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}
