/**
 * Client-side calls to the groups Route Handlers. Each resolves on success and
 * throws an Error carrying the server's plain message otherwise.
 */

import type { ScheduleCheckpoint } from "@/lib/groups/schedule";

const NETWORK_ERROR = "Could not reach the server. Try again.";

async function call<T>(
  url: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) throw new Error(body?.error || fallback);
  return (body ?? ({} as T)) as T;
}

function jsonInit(method: string, payload?: unknown): RequestInit {
  return payload === undefined
    ? { method }
    : {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      };
}

export async function createGroup(name: string): Promise<{ id: string }> {
  const body = await call<{ group: { id: string } }>(
    "/api/groups",
    jsonInit("POST", { name }),
    "Could not create the group.",
  );
  return body.group;
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  await call(
    `/api/groups/${encodeURIComponent(groupId)}`,
    jsonInit("PATCH", { name }),
    "Could not rename the group.",
  );
}

export async function createInvite(
  groupId: string,
): Promise<{ url: string; expiresAt: string }> {
  return call<{ url: string; expiresAt: string }>(
    `/api/groups/${encodeURIComponent(groupId)}/invites`,
    jsonInit("POST"),
    "Could not create the invite link.",
  );
}

export async function leaveGroup(groupId: string): Promise<void> {
  await call(
    `/api/groups/${encodeURIComponent(groupId)}/members/me`,
    jsonInit("DELETE"),
    "Could not leave the group.",
  );
}

export async function removeMember(
  groupId: string,
  userId: string,
): Promise<void> {
  await call(
    `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
    jsonInit("DELETE"),
    "Could not remove the member.",
  );
}

export interface NewReadBook {
  id: string;
  title: string;
  author: string;
  source: "standardebooks" | "gutenberg" | "upload";
  sourceRef: string | null;
}

/** Start a group read from one of the caller's own books. */
export async function addRead(
  groupId: string,
  book: NewReadBook,
): Promise<{ id: string }> {
  const body = await call<{ read: { id: string } }>(
    `/api/groups/${encodeURIComponent(groupId)}/reads`,
    jsonInit("POST", {
      title: book.title,
      author: book.author,
      source: book.source,
      ...(book.source === "upload" || !book.sourceRef
        ? {}
        : { sourceRef: book.sourceRef }),
      bookId: book.id,
    }),
    "Could not add the book.",
  );
  return body.read;
}

/**
 * Give the caller their own copy of a read. Without `bookId` a catalog read is
 * imported (or linked) for the caller; an uploaded read needs `bookId`.
 * Resolves with the alignment confidence, or null when there is no alignment.
 */
export async function addMyCopy(
  groupId: string,
  readId: string,
  bookId?: string,
): Promise<{ confidence: number | null }> {
  const body = await call<{ alignment: { confidence: number } | null }>(
    `/api/groups/${encodeURIComponent(groupId)}/reads/${encodeURIComponent(readId)}/copy`,
    jsonInit("POST", bookId ? { bookId } : undefined),
    "Could not add your copy.",
  );
  return { confidence: body.alignment?.confidence ?? null };
}

const REMOVE_READ_ERROR = "Couldn't remove the book. Try again.";

/**
 * Remove a read from its group (owner, or the member who added it). Resolves on
 * success (204); any failure throws the same plain message.
 */
export async function removeGroupRead(
  groupId: string,
  readId: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(
      `/api/groups/${encodeURIComponent(groupId)}/reads/${encodeURIComponent(readId)}`,
      { method: "DELETE" },
    );
  } catch {
    throw new Error(REMOVE_READ_ERROR);
  }
  if (!res.ok) throw new Error(REMOVE_READ_ERROR);
}

const SCHEDULE_ERROR = "Couldn't save. Try again.";

/**
 * Replace a read's schedule (owner, or the member who added the read). `null` clears
 * it. A 400 shows the route's own message; any other failure shows the plain one.
 */
export async function setReadSchedule(
  groupId: string,
  readId: string,
  schedule: ScheduleCheckpoint[] | null,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(
      `/api/groups/${encodeURIComponent(groupId)}/reads/${encodeURIComponent(readId)}`,
      jsonInit("PATCH", { schedule }),
    );
  } catch {
    throw new Error(SCHEDULE_ERROR);
  }
  if (res.ok) return;
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof body?.error === "string" && body.error) throw new Error(body.error);
  }
  throw new Error(SCHEDULE_ERROR);
}

/** Who may remove a read: the group owner, or the member who added it. */
export function canRemoveRead(
  isOwner: boolean,
  currentUserId: string,
  createdBy: string | null | undefined,
): boolean {
  return isOwner || (createdBy != null && createdBy === currentUserId);
}
