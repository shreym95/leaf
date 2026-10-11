/** Client call to POST /api/invites/:token/accept, with a plain line per failure. */

export interface AcceptResult {
  groupId: string;
}

export type AcceptFailure = {
  message: string;
  /** Only unexpected failures are worth retrying; the others will not change. */
  retryable: boolean;
};

export class AcceptInviteError extends Error {
  readonly retryable: boolean;
  constructor({ message, retryable }: AcceptFailure) {
    super(message);
    this.retryable = retryable;
  }
}

const GENERIC: AcceptFailure = {
  message: "Could not join the group. Try again.",
  retryable: true,
};

const BY_STATUS: Record<number, AcceptFailure> = {
  404: { message: "This invite link is not valid.", retryable: false },
  410: { message: "This invite has expired.", retryable: false },
  409: { message: "This group is full.", retryable: false },
};

export async function acceptInvite(token: string): Promise<AcceptResult> {
  let res: Response;
  try {
    res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
      method: "POST",
    });
  } catch {
    throw new AcceptInviteError(GENERIC);
  }
  if (!res.ok) throw new AcceptInviteError(BY_STATUS[res.status] ?? GENERIC);
  const body = (await res.json().catch(() => null)) as {
    groupId?: unknown;
  } | null;
  if (typeof body?.groupId !== "string" || body.groupId === "") {
    throw new AcceptInviteError(GENERIC);
  }
  // Failed catalog imports are not surfaced: the group page offers adding copies.
  return { groupId: body.groupId };
}
