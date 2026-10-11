import Link from "next/link";
import { Button } from "@/components/primitives";
import { bodyClass, errorClass, linkClass } from "./styles";

export type InviteStatusState =
  | { kind: "joining" }
  | { kind: "error"; message: string; retryable: boolean };

export interface InviteStatusProps {
  state: InviteStatusState;
  onRetry: () => void;
}

export function InviteStatus({ state, onRetry }: InviteStatusProps) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-4 px-6 py-6 sm:py-10">
      {state.kind === "joining" ? (
        <p role="status" className={bodyClass}>
          Joining…
        </p>
      ) : (
        <>
          <p role="alert" className={errorClass}>
            {state.message}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {state.retryable ? (
              <Button variant="ghost" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            <Link
              href="/groups"
              className={`${linkClass} font-ui [font-size:var(--leaf-text-sm)]`}
            >
              Groups
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
