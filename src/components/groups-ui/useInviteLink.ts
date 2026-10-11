"use client";

import { useCallback, useState } from "react";
import { createInvite } from "./actions";
import type { InviteLinkState } from "./InviteLinkControl";

/** Mints an invite, copies its absolute URL to the clipboard, reports the outcome. */
export function useInviteLink(groupId: string) {
  const [state, setState] = useState<InviteLinkState>({ kind: "idle" });

  const copy = useCallback(async () => {
    setState({ kind: "working" });
    let url: string;
    let expiresAt: string;
    try {
      const invite = await createInvite(groupId);
      url = new URL(invite.url, window.location.origin).toString();
      expiresAt = invite.expiresAt;
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Could not create the invite link.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setState({ kind: "copied", expiresAt });
    } catch {
      setState({ kind: "manual", url });
    }
  }, [groupId]);

  return { state, copy };
}
