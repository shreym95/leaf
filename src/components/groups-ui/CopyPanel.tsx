import Link from "next/link";
import { Button } from "@/components/primitives";
import { bodyClass, errorClass } from "./styles";

/** Below this alignment confidence the copy's chapters are said not to match. */
export const LOW_CONFIDENCE = 0.6;

export type CopyPanelState =
  | { kind: "have"; bookId: string; confidence: number | null }
  | { kind: "catalog" }
  | { kind: "upload" };

export interface CopyPanelProps {
  state: CopyPanelState;
  pending: boolean;
  /** Set once a copy was added in this visit and the page is catching up. */
  added: boolean;
  error: string | null;
  onAddCatalog: () => void;
  onChoose: () => void;
}

export function CopyPanel({
  state,
  pending,
  added,
  error,
  onAddCatalog,
  onChoose,
}: CopyPanelProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      {state.kind === "have" ? (
        <>
          <Button asChild>
            <Link href={`/reader/${state.bookId}`}>Open book</Link>
          </Button>
          {state.confidence !== null && state.confidence < LOW_CONFIDENCE ? (
            <p className={bodyClass}>
              Your copy&rsquo;s chapters don&rsquo;t fully match. Progress may be
              approximate.
            </p>
          ) : null}
        </>
      ) : (
        <>
          {state.kind === "catalog" ? (
            <Button onClick={onAddCatalog} disabled={pending}>
              Add to my library
            </Button>
          ) : (
            <Button onClick={onChoose} disabled={pending}>
              Choose your copy
            </Button>
          )}
          <p className={bodyClass}>Each member uses their own copy.</p>
        </>
      )}
      <p role="status" className={bodyClass}>
        {added && state.kind !== "have" ? "Added." : ""}
      </p>
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
