"use client";

import { InviteStatus } from "./InviteStatus";
import { useAcceptInvite } from "./useAcceptInvite";

export interface InviteScreenProps {
  token: string;
}

export function InviteScreen({ token }: InviteScreenProps) {
  const { state, retry } = useAcceptInvite(token);
  return <InviteStatus state={state} onRetry={retry} />;
}
