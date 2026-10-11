"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite, AcceptInviteError } from "./acceptInvite";
import type { InviteStatusState } from "./InviteStatus";

/**
 * Accepts the invite once on mount (the ref survives React strict mode's
 * double-invoked effect, so the token is never spent twice), then replaces the
 * URL with the group. `retry` posts again after a failure.
 */
export function useAcceptInvite(token: string) {
  const router = useRouter();
  const [state, setState] = useState<InviteStatusState>({ kind: "joining" });
  const started = useRef(false);

  const run = useCallback(async () => {
    setState({ kind: "joining" });
    try {
      const { groupId } = await acceptInvite(token);
      router.replace(`/groups/${groupId}`);
    } catch (err) {
      setState(
        err instanceof AcceptInviteError
          ? { kind: "error", message: err.message, retryable: err.retryable }
          : {
              kind: "error",
              message: "Could not join the group. Try again.",
              retryable: true,
            },
      );
    }
  }, [token, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return { state, retry: run };
}
