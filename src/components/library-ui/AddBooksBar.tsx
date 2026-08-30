"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { uploadEpub } from "@/lib/upload-client";
import { trackUpload } from "@/lib/analytics";
import { ImportSheet } from "./ImportSheet";

/**
 * AddBooksBar — the control row above the shelf: open the import search, or
 * upload a DRM-free EPUB. Client component; presentational + token-driven.
 *
 * The upload goes through `uploadEpub` (Agent B) which streams straight to
 * Storage; the client never touches catalogue bytes (SPEC §6). After any
 * mutation we `router.refresh()` so the server-rendered shelf updates.
 */

type UploadState =
  | { state: "idle" }
  | { state: "uploading"; pct: number }
  | { state: "error"; message: string };

export function AddBooksBar() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ state: "idle" });

  const refresh = useCallback(() => router.refresh(), [router]);

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Allow re-picking the same file later.
      e.target.value = "";
      if (!file) return;

      setUpload({ state: "uploading", pct: 0 });
      try {
        await uploadEpub(file, {
          onProgress: (pct) => setUpload({ state: "uploading", pct }),
        });
        // Bare count — no file name or metadata (SPEC §9 M4).
        trackUpload();
        setUpload({ state: "idle" });
        refresh();
      } catch (err) {
        setUpload({
          state: "error",
          message:
            err instanceof Error
              ? err.message
              : "Upload failed. Please try again.",
        });
      }
    },
    [refresh],
  );

  const uploading = upload.state === "uploading";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setSheetOpen(true)}>
          Search Standard Ebooks &amp; Gutenberg
        </Button>

        <Button
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading
            ? `Uploading… ${Math.round(upload.pct)}%`
            : "Upload EPUB"}
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".epub,application/epub+zip"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFileChange}
        />
      </div>

      {upload.state === "error" && (
        <p
          role="alert"
          className="font-ui text-accent [font-size:var(--leaf-text-sm)]"
        >
          {upload.message}
        </p>
      )}

      <ImportSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onImported={refresh}
      />
    </div>
  );
}
