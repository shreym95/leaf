/**
 * Client-side calls to the groups Route Handlers. Each resolves on success and
 * throws an Error carrying the server's plain message otherwise.
 */

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
