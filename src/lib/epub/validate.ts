// EPUB structural validation + shared zip/OPF helpers (SPEC §6).
// Style-agnostic logic layer — no design/component imports.

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

/** Thrown when the bytes are not a usable EPUB (corrupt, not a zip, no OPF). */
export class InvalidEpubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEpubError";
  }
}

export type EpubBytes = ArrayBuffer | Uint8Array;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (name) => name === "item" || name === "rootfile",
});

export async function loadEpubZip(bytes: EpubBytes): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch (err) {
    throw new InvalidEpubError(
      `Not a valid EPUB archive: ${(err as Error).message}`,
    );
  }
}

function zipText(zip: JSZip, path: string): Promise<string> | null {
  const file = zip.file(path);
  return file ? file.async("string") : null;
}

/** The OPF path from `META-INF/container.xml`. */
export async function readRootfilePath(zip: JSZip): Promise<string> {
  const containerXml = zipText(zip, "META-INF/container.xml");
  if (!containerXml) {
    throw new InvalidEpubError("EPUB is missing META-INF/container.xml");
  }
  const doc = xml.parse(await containerXml) as {
    container?: { rootfiles?: { rootfile?: Array<{ "@_full-path"?: string }> } };
  };
  const rootfiles = doc.container?.rootfiles?.rootfile ?? [];
  const fullPath = rootfiles[0]?.["@_full-path"];
  if (!fullPath) {
    throw new InvalidEpubError("container.xml has no rootfile path");
  }
  return fullPath.replace(/^\/+/, "");
}

export interface ManifestItem {
  href: string;
  /** Absolute zip path (OPF-dir-relative `href` resolved). */
  path: string;
  mediaType: string;
}

export interface ParsedOpf {
  opfPath: string;
  opfDir: string;
  title: string;
  creators: string[];
  manifest: ManifestItem[];
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Resolve `rel` against directory `base`, collapsing `.`/`..` and leading `/`. */
export function resolvePath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  const stack = base ? base.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

function dcText(v: unknown): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((entry) => {
      if (entry == null) return "";
      if (typeof entry === "string") return entry.trim();
      if (typeof entry === "object" && "#text" in entry) {
        return String((entry as { "#text"?: unknown })["#text"] ?? "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

export async function readOpf(zip: JSZip): Promise<ParsedOpf> {
  const opfPath = await readRootfilePath(zip);
  const opfText = zipText(zip, opfPath);
  if (!opfText) {
    throw new InvalidEpubError(`EPUB rootfile "${opfPath}" is missing`);
  }
  const doc = xml.parse(await opfText) as {
    package?: {
      metadata?: { title?: unknown; creator?: unknown };
      manifest?: {
        item?: Array<{
          "@_href"?: string;
          "@_media-type"?: string;
        }>;
      };
    };
  };
  const pkg = doc.package;
  if (!pkg) {
    throw new InvalidEpubError("EPUB OPF has no <package> root");
  }
  const opfDir = dirname(opfPath);
  const manifest: ManifestItem[] = (pkg.manifest?.item ?? [])
    .map((item) => {
      const href = item["@_href"] ?? "";
      return {
        href,
        path: resolvePath(opfDir, href),
        mediaType: (item["@_media-type"] ?? "").trim().toLowerCase(),
      };
    })
    .filter((item) => item.href);

  return {
    opfPath,
    opfDir,
    title: dcText(pkg.metadata?.title)[0] ?? "",
    creators: dcText(pkg.metadata?.creator),
    manifest,
  };
}

const CONTENT_DOC_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
]);

export function isContentDocument(item: ManifestItem): boolean {
  if (CONTENT_DOC_TYPES.has(item.mediaType)) return true;
  return /\.x?html?$/i.test(item.href);
}

/**
 * Assert the bytes are a structurally valid EPUB:
 *  - a `mimetype` entry equal to `application/epub+zip`
 *  - a readable `META-INF/container.xml` -> OPF
 *  - at least one content document in the manifest
 * Throws {@link InvalidEpubError} otherwise.
 */
export async function assertValidEpub(bytes: EpubBytes): Promise<void> {
  const zip = await loadEpubZip(bytes);

  const mimetypeFile = zip.file("mimetype");
  if (!mimetypeFile) {
    throw new InvalidEpubError("EPUB is missing the `mimetype` entry");
  }
  const mimetype = (await mimetypeFile.async("string")).trim();
  if (mimetype !== "application/epub+zip") {
    throw new InvalidEpubError(
      `Unexpected EPUB mimetype: "${mimetype || "(empty)"}"`,
    );
  }

  const opf = await readOpf(zip);
  if (!opf.manifest.some(isContentDocument)) {
    throw new InvalidEpubError("EPUB has no content documents");
  }
}
