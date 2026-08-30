// Cover extraction (M6). Style-agnostic logic layer.
//
// The cover comes out of the EPUB itself rather than the catalogue's search
// result: it is the same code path for Standard Ebooks, Gutenberg and a user's
// own upload, it needs no second network call, and nothing can rot or start
// blocking hotlinks later. Uploads have no catalogue entry at all, so this is
// the only way they ever get a cover.
//
// EPUBs name their cover in three different ways depending on age and producer,
// so this is tiered the same way the chapter normalizer is: use the strongest
// signal available, degrade to the weakest, never throw.

import { loadEpubZip, readOpf, type EpubBytes, type ManifestItem } from "./validate";

export interface EpubCover {
  bytes: Uint8Array;
  mediaType: string;
  /** File extension, without the dot, for the storage key. */
  extension: string;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function isImage(item: ManifestItem): boolean {
  return item.mediaType.startsWith("image/");
}

/** Tiered pick — strongest signal first. */
function findCoverItem(
  manifest: ManifestItem[],
  coverMetaId: string | null,
): ManifestItem | null {
  // 1. EPUB 3: the manifest item declares itself.
  const declared = manifest.find(
    (i) => isImage(i) && i.properties.split(/\s+/).includes("cover-image"),
  );
  if (declared) return declared;

  // 2. EPUB 2: <meta name="cover" content="…"> points at a manifest id.
  if (coverMetaId) {
    const byId = manifest.find((i) => i.id === coverMetaId && isImage(i));
    if (byId) return byId;
  }

  // 3. Neither: an image that calls itself a cover. Weakest signal, and the
  //    reason this is a guess rather than a guarantee.
  const byName = manifest.find(
    (i) => isImage(i) && /cover/i.test(i.href.split("/").pop() ?? ""),
  );
  return byName ?? null;
}

/**
 * The book's cover image, or `null` when the file does not carry one (or is
 * unreadable). Never throws: a missing cover must not fail an import — the shelf
 * falls back to the title initial, exactly as it did before.
 */
export async function extractEpubCover(
  bytes: EpubBytes,
): Promise<EpubCover | null> {
  try {
    const zip = await loadEpubZip(bytes);
    const opf = await readOpf(zip);
    const item = findCoverItem(opf.manifest, opf.coverMetaId);
    if (!item) return null;

    const file = zip.file(item.path);
    if (!file) return null;

    const data = await file.async("uint8array");
    if (data.byteLength === 0) return null;

    const mediaType = EXTENSIONS[item.mediaType] ? item.mediaType : "image/jpeg";
    return {
      bytes: data,
      mediaType,
      extension: EXTENSIONS[mediaType] ?? "jpg",
    };
  } catch {
    return null;
  }
}
