// Table of contents of a stored EPUB, read server-side.
//
// EPUB 3: the manifest item with `properties="nav"`, its `nav[epub:type~=toc]`
// (else the first nav), as nested `ol > li > a`. EPUB 2: the NCX, as nested
// `navMap > navPoint`. The EPUB 3 nav wins when both exist.
//
// Href convention: epub.js reports `spineHref` as the manifest item href, i.e.
// relative to the OPF's directory and without a fragment. Navigation hrefs are
// relative to the navigation document itself, so each is resolved against that
// document's location and re-expressed relative to the OPF directory. The
// `#fragment` is kept.

import type { SupabaseClient } from "@supabase/supabase-js";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type JSZip from "jszip";
import {
  InvalidEpubError,
  loadEpubZip,
  readOpf,
  resolvePath,
  type EpubBytes,
  type ManifestItem,
  type ParsedOpf,
} from "@/lib/epub/validate";
import type { TocInput } from "@/lib/groups/types";

const BUCKET = "epubs";
const NCX_TYPE = "application/x-dtbncx+xml";

// ── minimal element tree ─────────────────────────────────────────────────────

interface XNode {
  /** Local name (namespace prefix removed); "#text" for text nodes. */
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const treeParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
});

function localName(name: string): string {
  const i = name.indexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

function toNodes(raw: unknown): XNode[] {
  if (!Array.isArray(raw)) return [];
  const out: XNode[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    const attrsRaw = (entry[":@"] ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (key === ":@") continue;
      if (key === "#text") {
        out.push({ name: "#text", attrs: {}, children: [], text: String(entry[key]) });
        continue;
      }
      if (key.startsWith("?") || key.startsWith("!") || key.startsWith("#")) continue;
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(attrsRaw)) {
        if (k.startsWith("@_")) attrs[k.slice(2)] = String(v);
      }
      out.push({
        name: localName(key),
        attrs,
        children: toNodes(entry[key]),
        text: "",
      });
    }
  }
  return out;
}

function parseXml(text: string, what: string): XNode[] {
  if (XMLValidator.validate(text) !== true) {
    throw new InvalidEpubError(`EPUB ${what} is not well-formed XML`);
  }
  try {
    return toNodes(treeParser.parse(text));
  } catch {
    throw new InvalidEpubError(`EPUB ${what} is not well-formed XML`);
  }
}

const elements = (node: XNode): XNode[] =>
  node.children.filter((c) => c.name !== "#text");

function textOf(node: XNode): string {
  if (node.name === "#text") return node.text;
  return node.children.map(textOf).join("");
}

function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Every element named `name` below `nodes`, in document order. */
function findAll(nodes: readonly XNode[], name: string): XNode[] {
  const out: XNode[] = [];
  const walk = (list: readonly XNode[]): void => {
    for (const n of list) {
      if (n.name === name) out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// ── href handling ────────────────────────────────────────────────────────────

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Path of `target` relative to directory `fromDir` (both zip-root relative). */
function relativeTo(fromDir: string, target: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const to = target.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i += 1;
  return [...Array<string>(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

type HrefFn = (raw: string) => string | null;

/**
 * Resolver for hrefs found in the navigation document at `docPath`. Returns the
 * href relative to the OPF directory (the manifest item's own href when the
 * target is in the manifest), fragment kept; null for external links.
 */
function makeHrefResolver(opf: ParsedOpf, docPath: string): HrefFn {
  const docDir = dirOf(docPath);
  const byPath = new Map<string, string>();
  for (const item of opf.manifest) {
    byPath.set(item.path, item.href);
    byPath.set(safeDecode(item.path), item.href);
  }
  return (raw) => {
    const href = raw.trim();
    if (!href || SCHEME_RE.test(href)) return null;
    const hash = href.indexOf("#");
    const pathPart = hash === -1 ? href : href.slice(0, hash);
    const fragment = hash === -1 ? "" : href.slice(hash);
    const target = pathPart === "" ? docPath : resolvePath(docDir, pathPart);
    const manifestHref =
      byPath.get(target) ?? byPath.get(safeDecode(target));
    return (manifestHref ?? relativeTo(opf.opfDir, target)) + fragment;
  };
}

// ── EPUB 3 nav ───────────────────────────────────────────────────────────────

function hasTocType(node: XNode): boolean {
  const type = node.attrs["epub:type"] ?? node.attrs["type"] ?? "";
  return type.split(/\s+/).includes("toc");
}

function navList(nav: XNode): XNode | null {
  const direct = elements(nav).find((c) => c.name === "ol");
  return direct ?? findAll(nav.children, "ol")[0] ?? null;
}

function firstHref(items: readonly TocInput[]): string | null {
  for (const it of items) {
    if (it.href) return it.href;
    const nested = it.subitems ? firstHref(it.subitems) : null;
    if (nested) return nested;
  }
  return null;
}

function parseNavList(ol: XNode, resolve: HrefFn): TocInput[] {
  const out: TocInput[] = [];
  for (const li of elements(ol).filter((c) => c.name === "li")) {
    const kids = elements(li);
    const head = kids.find((c) => c.name === "a" || c.name === "span");
    const nested = kids.find((c) => c.name === "ol");
    const subitems = nested ? parseNavList(nested, resolve) : [];
    const label = head ? cleanLabel(textOf(head)) : "";

    let href: string | null = null;
    if (head?.name === "a" && head.attrs["href"] !== undefined) {
      href = resolve(head.attrs["href"]);
    }
    if (href === null) href = firstHref(subitems);
    if (href === null) continue;
    out.push(subitems.length > 0 ? { href, label, subitems } : { href, label });
  }
  return out;
}

function parseNav(text: string, resolve: HrefFn): TocInput[] {
  const doc = parseXml(text, "navigation document");
  const navs = findAll(doc, "nav");
  const nav = navs.find(hasTocType) ?? navs[0];
  if (!nav) return [];
  const ol = navList(nav);
  return ol ? parseNavList(ol, resolve) : [];
}

// ── EPUB 2 NCX ───────────────────────────────────────────────────────────────

function parseNavPoints(parent: XNode, resolve: HrefFn): TocInput[] {
  const out: TocInput[] = [];
  for (const point of elements(parent).filter((c) => c.name === "navPoint")) {
    const labelNode = elements(point).find((c) => c.name === "navLabel");
    const textNode = labelNode
      ? elements(labelNode).find((c) => c.name === "text")
      : undefined;
    const label = cleanLabel(textNode ? textOf(textNode) : "");
    const subitems = parseNavPoints(point, resolve);
    const content = elements(point).find((c) => c.name === "content");

    let href: string | null = null;
    if (content?.attrs["src"] !== undefined) href = resolve(content.attrs["src"]);
    if (href === null) href = firstHref(subitems);
    if (href === null) continue;
    out.push(subitems.length > 0 ? { href, label, subitems } : { href, label });
  }
  return out;
}

function parseNcx(text: string, resolve: HrefFn): TocInput[] {
  const doc = parseXml(text, "NCX");
  const navMap = findAll(doc, "navMap")[0];
  return navMap ? parseNavPoints(navMap, resolve) : [];
}

// ── entry point ──────────────────────────────────────────────────────────────

const spineParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

async function spineTocId(zip: JSZip, opfPath: string): Promise<string | null> {
  const file = zip.file(opfPath);
  if (!file) return null;
  const doc = spineParser.parse(await file.async("string")) as {
    package?: { spine?: { "@_toc"?: string } };
  };
  return doc.package?.spine?.["@_toc"]?.trim() || null;
}

async function readEntry(zip: JSZip, item: ManifestItem, what: string): Promise<string> {
  const file = zip.file(item.path) ?? zip.file(safeDecode(item.path));
  if (!file) {
    throw new InvalidEpubError(`EPUB ${what} "${item.path}" is missing`);
  }
  return file.async("string");
}

/**
 * The EPUB's table of contents as nested entries in document order, hrefs
 * relative to the OPF directory. `[]` when the book has none. Throws
 * `InvalidEpubError` for an unreadable archive or a malformed navigation file.
 */
export async function extractEpubToc(bytes: EpubBytes): Promise<TocInput[]> {
  const zip = await loadEpubZip(bytes);
  const opf = await readOpf(zip);

  const navItem = opf.manifest.find((i) => i.properties.split(/\s+/).includes("nav"));
  const spineId = await spineTocId(zip, opf.opfPath);
  const ncxItem =
    opf.manifest.find((i) => i.mediaType === NCX_TYPE) ??
    (spineId ? opf.manifest.find((i) => i.id === spineId) : undefined);

  let navError: InvalidEpubError | null = null;
  if (navItem) {
    try {
      const toc = parseNav(
        await readEntry(zip, navItem, "navigation document"),
        makeHrefResolver(opf, navItem.path),
      );
      if (toc.length > 0) return toc;
    } catch (err) {
      if (!(err instanceof InvalidEpubError)) throw err;
      navError = err;
    }
  }

  if (ncxItem) {
    return parseNcx(
      await readEntry(zip, ncxItem, "NCX"),
      makeHrefResolver(opf, ncxItem.path),
    );
  }
  if (navError) throw navError;
  return [];
}

/** Download a book's EPUB with the service role. The caller has already checked ownership. */
export async function downloadBookBytes(
  admin: SupabaseClient,
  storagePath: string,
): Promise<ArrayBuffer> {
  const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
  if (error) throw error;
  if (!data) throw new Error("Empty download.");
  return data.arrayBuffer();
}
