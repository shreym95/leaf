// DRM detection for EPUBs (SPEC §3.5 — HARD legal invariant).
//
// Leaf only accepts DRM-free books. This module *classifies*; it never strips
// anything. `ingestEpub` turns a `{ drmFree: false }` result into a
// user-facing `DrmProtectedError`.
//
// What counts as DRM here:
//   - META-INF/rights.xml            -> Adobe ADEPT DRM
//   - META-INF/license.lcpl          -> Readium LCP
//   - META-INF/encryption.xml that either
//       * uses an Adobe ADEPT algorithm (ns.adobe.com/adept), or
//       * encrypts a content document (XHTML/HTML)
//
// What is NOT DRM (allowed, per SPEC §3.5): IDPF/Adobe *font obfuscation* — an
// encryption.xml that only references non-content resources (fonts, CSS,
// images). Common obfuscation algorithms are IDPF
// (http://www.idpf.org/2008/embedding) and Adobe (http://ns.adobe.com/pdf/enc#RC).

import { XMLParser } from "fast-xml-parser";
import {
  loadEpubZip,
  readOpf,
  isContentDocument,
  type EpubBytes,
  type ManifestItem,
} from "./validate";

export interface DrmCheckResult {
  drmFree: boolean;
  /** Present when `drmFree` is false — a short technical reason (not user copy). */
  reason?: string;
}

const encParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (name) => name === "EncryptedData",
});

interface EncryptedData {
  EncryptionMethod?: { "@_Algorithm"?: string };
  CipherData?: { CipherReference?: { "@_URI"?: string } };
}

/**
 * Inspect EPUB bytes for DRM. Never throws for DRM — returns
 * `{ drmFree: false, reason }`. Rejects the promise only on unreadable input.
 */
export async function checkDrm(bytes: EpubBytes): Promise<DrmCheckResult> {
  const zip = await loadEpubZip(bytes);

  if (zip.file("META-INF/rights.xml")) {
    return {
      drmFree: false,
      reason: "META-INF/rights.xml present (Adobe ADEPT DRM)",
    };
  }
  if (zip.file("META-INF/license.lcpl")) {
    return {
      drmFree: false,
      reason: "META-INF/license.lcpl present (Readium LCP DRM)",
    };
  }

  const encryptionFile = zip.file("META-INF/encryption.xml");
  if (!encryptionFile) {
    return { drmFree: true };
  }

  const encryptionXml = await encryptionFile.async("string");
  if (/ns\.adobe\.com\/adept/i.test(encryptionXml)) {
    return {
      drmFree: false,
      reason: "encryption.xml uses an Adobe ADEPT algorithm",
    };
  }

  let manifest: ManifestItem[] = [];
  try {
    manifest = (await readOpf(zip)).manifest;
  } catch {
    // No usable OPF — fall back to extension-only classification below.
  }

  const doc = encParser.parse(encryptionXml) as {
    encryption?: { EncryptedData?: EncryptedData[] };
  };
  const entries = doc.encryption?.EncryptedData ?? [];

  for (const entry of entries) {
    const rawUri = entry.CipherData?.CipherReference?.["@_URI"] ?? "";
    if (!rawUri) continue;

    // OCF: CipherReference URIs are relative to the container (zip) root.
    const uri = decodeURIComponent(rawUri).replace(/^\/+/, "");
    const manifestItem = manifest.find(
      (m) => m.path === uri || m.href === rawUri,
    );
    const looksLikeContentDoc = manifestItem
      ? isContentDocument(manifestItem)
      : /\.(x?html?|opf|ncx)$/i.test(uri);

    if (looksLikeContentDoc) {
      return {
        drmFree: false,
        reason: `encryption.xml encrypts a content document (${uri})`,
      };
    }
    // Otherwise: obfuscation of a font / CSS / image — allowed (SPEC §3.5).
  }

  return { drmFree: true };
}
