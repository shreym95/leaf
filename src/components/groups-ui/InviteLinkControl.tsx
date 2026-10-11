"use client";

import { useId } from "react";
import { Button } from "@/components/primitives";
import { bodyClass, errorClass, inputClass, labelClass } from "./styles";

export type InviteLinkState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "copied"; expiresAt: string }
  | { kind: "manual"; url: string }
  | { kind: "error"; message: string };

export interface InviteLinkControlProps {
  state: InviteLinkState;
  onCopy: () => void;
}

export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function InviteLinkControl({ state, onCopy }: InviteLinkControlProps) {
  const inputId = useId();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="ghost"
        onClick={onCopy}
        disabled={state.kind === "working"}
      >
        Copy invite link
      </Button>
      {/* Always mounted so assistive tech announces the change. */}
      <p role="status" className={bodyClass}>
        {state.kind === "copied"
          ? `Link copied. Expires ${formatExpiry(state.expiresAt)}.`
          : ""}
      </p>
      {state.kind === "manual" ? (
        <div className="flex w-full flex-col gap-2">
          <label htmlFor={inputId} className={labelClass}>
            Could not copy. Copy the link below.
          </label>
          <input
            id={inputId}
            type="text"
            readOnly
            value={state.url}
            onFocus={(e) => e.currentTarget.select()}
            className={inputClass}
          />
        </div>
      ) : null}
      {state.kind === "error" ? (
        <p role="alert" className={errorClass}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
