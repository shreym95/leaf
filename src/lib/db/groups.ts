// Client-side data layer for reading groups (0008 groups core, 0009 group reads).
//
// Direct-to-Supabase reads, plus the writes RLS lets a member make themselves:
// their own read_copies link and their own read_progress row. Creating a group,
// invites, joining, removing members and adding a read go through Route Handlers
// and are NOT here. read_milestones has no client write policy at all.
//
// Like the other db modules these take an EXPLICIT Supabase client so the module
// stays browser-safe (the offline outbox replays `setGroupProgress` from the client
// bundle). Errors follow the neighbours: a Postgrest error is thrown; "not found" on
// a single-row read is `null`. Nothing here logs.
//
// Security is RLS; the explicit `user_id` filters are belt-and-braces.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Group,
  GroupMemberName,
  GroupRead,
  GroupRole,
  ReadMilestone,
  ReadProgress,
} from "@/lib/types";
import type {
  Alignment,
  Outline,
  OutlineEntry,
  OutlinePosition,
} from "@/lib/groups/types";
import { parseSchedule } from "@/lib/groups/schedule";

function resolveClient(client?: SupabaseClient): SupabaseClient {
  if (client) return client;
  throw new Error(
    "groups helpers require an explicit Supabase client (the browser client in the " +
      "reader, `await createClient()` from @/lib/supabase/server on the server).",
  );
}

// ── tolerant JSON parsing ────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * `group_reads.outline` (jsonb) to the S2 `Outline`. Tolerates missing optional
 * fields: `partLabel` (not part of the stored shape in 0009) becomes null, a
 * missing `depth` becomes 0, a missing `partIndex` becomes null, a missing
 * `index` falls back to the entry's position. Anything that is not an object is
 * skipped; anything that is not an array is an empty outline.
 */
export function parseOutline(raw: unknown): Outline {
  if (!Array.isArray(raw)) return [];
  const out: OutlineEntry[] = [];
  raw.forEach((item, position) => {
    if (!isRecord(item)) return;
    out.push({
      index:
        typeof item.index === "number" && Number.isFinite(item.index)
          ? item.index
          : position,
      label: typeof item.label === "string" ? item.label : "",
      depth:
        typeof item.depth === "number" && Number.isFinite(item.depth) ? item.depth : 0,
      partIndex:
        typeof item.partIndex === "number" && Number.isFinite(item.partIndex)
          ? item.partIndex
          : null,
      partLabel: typeof item.partLabel === "string" ? item.partLabel : null,
      href: typeof item.href === "string" ? item.href : "",
    });
  });
  return out;
}

/**
 * `read_copies.alignment` (jsonb) to an `Alignment`, or null when the column is
 * null or not an object. A missing `copyHrefs` falls back to the map's keys; a
 * missing `confidence` is 0; a missing `identity` is false.
 */
export function parseAlignment(raw: unknown): Alignment | null {
  if (!isRecord(raw)) return null;
  const map: Record<string, number> = {};
  if (isRecord(raw.map)) {
    for (const [href, idx] of Object.entries(raw.map)) {
      if (typeof idx === "number" && Number.isFinite(idx)) map[href] = idx;
    }
  }
  const copyHrefs = Array.isArray(raw.copyHrefs)
    ? raw.copyHrefs.filter((h): h is string => typeof h === "string")
    : Object.keys(map);
  return {
    map,
    copyHrefs,
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? clamp01(raw.confidence)
        : 0,
    identity: raw.identity === true,
  };
}

// ── shapes ───────────────────────────────────────────────────────────────────

/** A group I belong to, with my role and how many members it has. */
export interface MyGroup {
  group: Group;
  role: GroupRole;
  memberCount: number;
}

export interface GroupDetail {
  group: Group;
  members: GroupMemberName[];
}

/** A `group_reads` row with its outline and schedule parsed. */
export type ParsedGroupRead = Omit<GroupRead, "outline"> & { outline: Outline };

/** My `read_copies` row with its alignment parsed. */
export interface MyReadCopy {
  readId: string;
  bookId: string;
  contentSha256: string | null;
  alignment: Alignment | null;
}

/** A read my book is linked to, with my alignment against its outline. */
export interface BookRead {
  read: ParsedGroupRead;
  copy: MyReadCopy;
}

/** What `setGroupProgress` writes: the same fields the outbox payload carries. */
export interface GroupProgressWrite {
  userId: string;
  readId: string;
  chapterIndex: number;
  chapterFraction: number;
  percent: number;
  finishedAt: string | null;
}

function parseRead(row: GroupRead): ParsedGroupRead {
  return {
    ...row,
    outline: parseOutline(row.outline),
    schedule: parseSchedule(row.schedule),
  };
}

function parseCopy(row: {
  read_id: string;
  book_id: string;
  content_sha256: string | null;
  alignment: unknown;
}): MyReadCopy {
  return {
    readId: row.read_id,
    bookId: row.book_id,
    contentSha256: row.content_sha256 ?? null,
    alignment: parseAlignment(row.alignment),
  };
}

/** PostgREST returns a to-one embed as an object; tolerate a one-element array. */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// ── groups ───────────────────────────────────────────────────────────────────

/** Every group I belong to, oldest membership first, with my role and member count. */
export async function listMyGroups(
  userId: string,
  client?: SupabaseClient,
): Promise<MyGroup[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("group_members")
    .select("role, joined_at, groups(id, name, created_at, group_members(count))")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });
  if (error) throw error;

  type Row = {
    role: GroupRole;
    groups:
      | (Group & { group_members?: { count: number }[] })
      | (Group & { group_members?: { count: number }[] })[]
      | null;
  };
  const out: MyGroup[] = [];
  for (const row of (data as unknown as Row[] | null) ?? []) {
    const g = one(row.groups);
    if (!g) continue;
    const { group_members, ...group } = g;
    out.push({
      group: group as Group,
      role: row.role,
      memberCount: group_members?.[0]?.count ?? 0,
    });
  }
  return out;
}

/**
 * One group and its members (names via `group_member_names`, which is empty unless
 * I am a member). Null when the group is not visible to me.
 */
export async function getGroup(
  groupId: string,
  client?: SupabaseClient,
): Promise<GroupDetail | null> {
  const supabase = resolveClient(client);
  const { data: group, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw error;
  if (!group) return null;

  const { data: members, error: rpcError } = await supabase.rpc("group_member_names", {
    gid: groupId,
  });
  if (rpcError) throw rpcError;
  return {
    group: group as Group,
    members: (members as GroupMemberName[] | null) ?? [],
  };
}

// ── reads ────────────────────────────────────────────────────────────────────

/** The reads of a group, oldest first, with outlines parsed. */
export async function listReads(
  groupId: string,
  client?: SupabaseClient,
): Promise<ParsedGroupRead[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("group_reads")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data as GroupRead[] | null) ?? []).map(parseRead);
}

/** Every member's progress row for a read. */
export async function getReadProgress(
  readId: string,
  client?: SupabaseClient,
): Promise<ReadProgress[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("read_progress")
    .select("*")
    .eq("read_id", readId);
  if (error) throw error;
  return (data as ReadProgress[] | null) ?? [];
}

/** My own progress row for a read, or null if I have none yet. */
export async function getMyProgress(
  userId: string,
  readId: string,
  client?: SupabaseClient,
): Promise<ReadProgress | null> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("read_progress")
    .select("*")
    .eq("read_id", readId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ReadProgress | null) ?? null;
}

/** Milestones reached in a read, in arrival order. */
export async function listMilestones(
  readId: string,
  client?: SupabaseClient,
): Promise<ReadMilestone[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("read_milestones")
    .select("*")
    .eq("read_id", readId)
    .order("reached_at", { ascending: true });
  if (error) throw error;
  return (data as ReadMilestone[] | null) ?? [];
}

// ── my copy ──────────────────────────────────────────────────────────────────

/** My link from my own book to a read, or null when I have not added a copy. */
export async function getMyCopy(
  userId: string,
  readId: string,
  client?: SupabaseClient,
): Promise<MyReadCopy | null> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("read_copies")
    .select("*")
    .eq("read_id", readId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? parseCopy(data) : null;
}

/** Link (or re-link) my book to a read. Upserts my own `read_copies` row. */
export async function linkMyCopy(
  userId: string,
  readId: string,
  bookId: string,
  alignment: Alignment,
  contentSha256: string | null,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase.from("read_copies").upsert(
    {
      read_id: readId,
      user_id: userId,
      book_id: bookId,
      content_sha256: contentSha256,
      alignment,
    },
    { onConflict: "read_id,user_id" },
  );
  if (error) throw error;
}

/** Replace the alignment of my existing copy (e.g. after the user confirms a match). */
export async function setCopyAlignment(
  userId: string,
  readId: string,
  alignment: Alignment,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = resolveClient(client);
  const { error } = await supabase
    .from("read_copies")
    .update({ alignment })
    .eq("read_id", readId)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * The reads my book is linked to, with their outlines and my alignment. Used by
 * the reader hook to decide whether a position should be shared. Empty when the
 * book is not linked to any read (the common case).
 */
export async function findReadForBook(
  userId: string,
  bookId: string,
  client?: SupabaseClient,
): Promise<BookRead[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("read_copies")
    .select("*, group_reads(*)")
    .eq("user_id", userId)
    .eq("book_id", bookId);
  if (error) throw error;

  type Row = {
    read_id: string;
    book_id: string;
    content_sha256: string | null;
    alignment: unknown;
    group_reads: GroupRead | GroupRead[] | null;
  };
  const out: BookRead[] = [];
  for (const row of (data as unknown as Row[] | null) ?? []) {
    const read = one(row.group_reads);
    if (!read) continue;
    out.push({ read: parseRead(read), copy: parseCopy(row) });
  }
  return out;
}

// ── progress writes ──────────────────────────────────────────────────────────

/**
 * Overall progress (0..1) of an outline position: chapters before it plus the
 * fraction of the current one, over the outline length. An empty outline is 0.
 */
export function outlinePercent(outlineLength: number, position: OutlinePosition): number {
  if (!(outlineLength > 0)) return 0;
  const index = Number.isFinite(position.chapterIndex)
    ? Math.min(Math.max(Math.trunc(position.chapterIndex), 0), outlineLength - 1)
    : 0;
  return clamp01((index + clamp01(position.chapterFraction)) / outlineLength);
}

/**
 * Set my position by hand ("I'm at chapter N"). Reads the read's outline to
 * derive `percent`, then upserts my own `read_progress` row with `manual = true`
 * and `updated_at` now. `finished_at` is left as it is: the milestone trigger
 * records `end` from the position itself. Throws if the read is not visible.
 */
export async function setManualProgress(
  userId: string,
  readId: string,
  position: OutlinePosition,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("group_reads")
    .select("outline")
    .eq("id", readId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Group read not found.");

  const length = parseOutline((data as { outline: unknown }).outline).length;
  const chapterIndex = Number.isFinite(position.chapterIndex)
    ? Math.min(Math.max(Math.trunc(position.chapterIndex), 0), Math.max(0, length - 1))
    : 0;
  const chapterFraction = clamp01(position.chapterFraction);

  const { error: upsertError } = await supabase.from("read_progress").upsert(
    {
      read_id: readId,
      user_id: userId,
      chapter_index: chapterIndex,
      chapter_fraction: chapterFraction,
      percent: outlinePercent(length, { chapterIndex, chapterFraction }),
      manual: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "read_id,user_id" },
  );
  if (upsertError) throw upsertError;
}

/**
 * Write my position from my copy (the outbox replays this). Upserts my own
 * `read_progress` row with `manual = false`. Values are clamped into the column
 * CHECK ranges so a stray number cannot turn into a permanent rejection.
 * `updatedAt` defaults to now; the outbox passes the time the position was
 * recorded so a late replay does not look newer than it is.
 */
export async function setGroupProgress(
  payload: GroupProgressWrite,
  client?: SupabaseClient,
  updatedAt?: string,
): Promise<void> {
  const supabase = resolveClient(client);
  const chapterIndex = Number.isFinite(payload.chapterIndex)
    ? Math.max(0, Math.trunc(payload.chapterIndex))
    : 0;
  const { error } = await supabase.from("read_progress").upsert(
    {
      read_id: payload.readId,
      user_id: payload.userId,
      chapter_index: chapterIndex,
      chapter_fraction: clamp01(payload.chapterFraction),
      percent: clamp01(payload.percent),
      finished_at: payload.finishedAt,
      manual: false,
      updated_at: updatedAt ?? new Date().toISOString(),
    },
    { onConflict: "read_id,user_id" },
  );
  if (error) throw error;
}
