import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  InvalidEpubError,
  loadEpubZip,
  readOpf,
  resolvePath,
} from "@/lib/epub/validate";
import type { TocInput } from "@/lib/groups/types";
import { extractEpubToc } from "./toc";

const bundled = (name: string) =>
  readFileSync(`public/bundled/${name}.epub`);

function flatten(toc: readonly TocInput[]): TocInput[] {
  return toc.flatMap((t) => [t, ...flatten(t.subitems ?? [])]);
}

async function manifestPaths(bytes: Uint8Array): Promise<Set<string>> {
  const opf = await readOpf(await loadEpubZip(bytes));
  return new Set(opf.manifest.map((m) => m.path));
}

/** Every returned href, fragment dropped, resolved against the OPF dir, is a manifest item. */
async function expectHrefsInManifest(bytes: Uint8Array, toc: TocInput[]) {
  const opf = await readOpf(await loadEpubZip(bytes));
  const paths = await manifestPaths(bytes);
  for (const entry of flatten(toc)) {
    const path = resolvePath(opf.opfDir, entry.href.split("#")[0]);
    expect(paths.has(path), `${entry.href} -> ${path}`).toBe(true);
  }
}

// ── synthetic EPUBs ──────────────────────────────────────────────────────────

const CONTAINER = (opf: string) =>
  `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="${opf}" media-type="application/oebps-package+xml"/></rootfiles></container>`;

const OPF = (manifest: string, spineAttrs = "") =>
  `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="u"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata><manifest>${manifest}</manifest><spine${spineAttrs}><itemref idref="c1"/></spine></package>`;

const XHTML_NS =
  'xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"';

async function build(
  opfPath: string,
  files: Record<string, string>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER(opfPath));
  for (const [path, body] of Object.entries(files)) zip.file(path, body);
  return zip.generateAsync({ type: "uint8array" });
}

const item = (id: string, href: string, type = "application/xhtml+xml", props = "") =>
  `<item id="${id}" href="${href}" media-type="${type}"${props ? ` properties="${props}"` : ""}/>`;

// ── bundled EPUBs ────────────────────────────────────────────────────────────

describe("extractEpubToc: bundled EPUBs", () => {
  it("frankenstein: Parts with nested chapters, in order", async () => {
    const bytes = bundled("frankenstein");
    const toc = await extractEpubToc(bytes);
    expect(toc).toHaveLength(10);
    expect(toc[0]).toEqual({ href: "text/titlepage.xhtml", label: "Titlepage" });
    expect(toc.at(-1)).toEqual({
      href: "text/uncopyright.xhtml",
      label: "Uncopyright",
    });
    const parent = toc[6];
    expect(parent.label).toBe("Frankenstein");
    expect(parent.href).toBe("text/halftitlepage.xhtml");
    expect(parent.subitems).toHaveLength(28);
    expect(parent.subitems?.[0].label).toBe("Letter I");
    expect(parent.subitems?.at(-1)?.label).toBe("Chapter XXIV");
    expect(flatten(toc)).toHaveLength(39);
    await expectHrefsInManifest(bytes, toc);
  });

  it("wizard-of-oz: one Part holding 24 chapters", async () => {
    const bytes = bundled("wizard-of-oz");
    const toc = await extractEpubToc(bytes);
    expect(toc).toHaveLength(6);
    expect(toc[0].label).toBe("Titlepage");
    expect(toc.at(-1)?.label).toBe("Uncopyright");
    expect(toc[3].subitems).toHaveLength(24);
    expect(toc[3].subitems?.[0].label).toBe("I: The Cyclone");
    expect(toc[3].subitems?.at(-1)?.label).toBe("XXIV: Home Again");
    expect(flatten(toc)).toHaveLength(30);
    await expectHrefsInManifest(bytes, toc);
  });

  it("time-machine: flat list", async () => {
    const bytes = bundled("time-machine");
    const toc = await extractEpubToc(bytes);
    expect(toc).toHaveLength(18);
    expect(toc[0].label).toBe("Titlepage");
    expect(toc[2].label).toBe("I");
    expect(toc.at(-1)?.label).toBe("Uncopyright");
    expect(toc.every((t) => !t.subitems)).toBe(true);
    await expectHrefsInManifest(bytes, toc);
  });

  it("chapter-image-heading: EPUB 3 with the nav at the OPF level", async () => {
    const bytes = bundled("chapter-image-heading");
    const toc = await extractEpubToc(bytes);
    expect(toc.map((t) => [t.href, t.label])).toEqual([
      ["chapter-1.xhtml", "1"],
      ["chapter-2.xhtml", "2"],
      ["chapter-3.xhtml", "3"],
    ]);
    await expectHrefsInManifest(bytes, toc);
  });

  it("ignores the landmarks nav", async () => {
    const toc = await extractEpubToc(bundled("time-machine"));
    expect(flatten(toc).map((t) => t.label)).not.toContain("Bodymatter");
  });

  it("the NCX of a real EPUB gives the same contents as its nav", async () => {
    for (const name of ["frankenstein", "wizard-of-oz", "time-machine"]) {
      const original = bundled(name);
      const viaNav = await extractEpubToc(original);

      // Drop the nav property so only the NCX is left.
      const zip = await JSZip.loadAsync(original);
      const opfText = await zip.file("epub/content.opf")!.async("string");
      zip.file("epub/content.opf", opfText.replace(' properties="nav"', ""));
      const viaNcx = await extractEpubToc(
        await zip.generateAsync({ type: "uint8array" }),
      );

      const key = (t: TocInput[]) => flatten(t).map((e) => [e.href, e.label]);
      expect(key(viaNcx), name).toEqual(key(viaNav));
      expect(viaNcx.map((t) => t.subitems?.length ?? 0), name).toEqual(
        viaNav.map((t) => t.subitems?.length ?? 0),
      );
    }
  });
});

// ── synthetic EPUBs ──────────────────────────────────────────────────────────

describe("extractEpubToc: synthetic EPUBs", () => {
  it("nav headings in span become label-only parents with the first child's href", async () => {
    const nav = `<html ${XHTML_NS}><body><nav epub:type="toc"><ol>
      <li><span>Part One</span><ol>
        <li><a href="a.xhtml">Alpha</a></li>
        <li><a href="b.xhtml#sec">Beta   <i>the</i>
            second</a></li>
      </ol></li>
      <li><a href="c.xhtml">Gamma</a></li>
    </ol></nav></body></html>`;
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") +
          item("c1", "a.xhtml") + item("c2", "b.xhtml") + item("c3", "c.xhtml"),
      ),
      "nav.xhtml": nav,
    });
    const toc = await extractEpubToc(bytes);
    expect(toc).toEqual([
      {
        href: "a.xhtml",
        label: "Part One",
        subitems: [
          { href: "a.xhtml", label: "Alpha" },
          { href: "b.xhtml#sec", label: "Beta the second" },
        ],
      },
      { href: "c.xhtml", label: "Gamma" },
    ]);
  });

  it("uses the nav with epub:type toc, not an earlier landmarks nav", async () => {
    const nav = `<html ${XHTML_NS}><body>
      <nav epub:type="landmarks"><ol><li><a href="a.xhtml">Start</a></li></ol></nav>
      <nav epub:type="page-list toc"><ol><li><a href="b.xhtml">Real</a></li></ol></nav>
    </body></html>`;
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") +
          item("c1", "a.xhtml") + item("c2", "b.xhtml"),
      ),
      "nav.xhtml": nav,
    });
    expect((await extractEpubToc(bytes)).map((t) => t.label)).toEqual(["Real"]);
  });

  it("falls back to the first nav when none says toc", async () => {
    const nav = `<html ${XHTML_NS}><body><nav><ol><li><a href="a.xhtml">Only</a></li></ol></nav></body></html>`;
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") + item("c1", "a.xhtml"),
      ),
      "nav.xhtml": nav,
    });
    expect((await extractEpubToc(bytes)).map((t) => t.label)).toEqual(["Only"]);
  });

  it("EPUB 2: reads a nested NCX in document order", async () => {
    const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
      <navPoint id="p1"><navLabel><text>Book One</text></navLabel><content src="a.xhtml"/>
        <navPoint id="p2"><navLabel><text> Chapter  1 </text></navLabel><content src="a.xhtml#c1"/></navPoint>
        <navPoint id="p3"><navLabel><text>Chapter 2</text></navLabel><content src="b.xhtml"/></navPoint>
      </navPoint>
      <navPoint id="p4"><navLabel><text>Epilogue</text></navLabel><content src="c.xhtml"/></navPoint>
    </navMap></ncx>`;
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("ncx", "toc.ncx", "application/x-dtbncx+xml") +
          item("c1", "a.xhtml") + item("c2", "b.xhtml") + item("c3", "c.xhtml"),
        ' toc="ncx"',
      ),
      "toc.ncx": ncx,
    });
    expect(await extractEpubToc(bytes)).toEqual([
      {
        href: "a.xhtml",
        label: "Book One",
        subitems: [
          { href: "a.xhtml#c1", label: "Chapter 1" },
          { href: "b.xhtml", label: "Chapter 2" },
        ],
      },
      { href: "c.xhtml", label: "Epilogue" },
    ]);
    await expectHrefsInManifest(bytes, await extractEpubToc(bytes));
  });

  it("EPUB 2: finds the NCX through the spine toc attribute", async () => {
    const ncx = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="p"><navLabel><text>One</text></navLabel><content src="a.xhtml"/></navPoint></navMap></ncx>`;
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("tocfile", "toc.xml", "text/xml") + item("c1", "a.xhtml"),
        ' toc="tocfile"',
      ),
      "toc.xml": ncx,
    });
    expect((await extractEpubToc(bytes)).map((t) => t.label)).toEqual(["One"]);
  });

  it("prefers the nav over the NCX when both exist", async () => {
    const nav = `<html ${XHTML_NS}><body><nav epub:type="toc"><ol><li><a href="a.xhtml">From nav</a></li></ol></nav></body></html>`;
    const ncx = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="p"><navLabel><text>From ncx</text></navLabel><content src="a.xhtml"/></navPoint></navMap></ncx>`;
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") +
          item("ncx", "toc.ncx", "application/x-dtbncx+xml") +
          item("c1", "a.xhtml"),
        ' toc="ncx"',
      ),
      "nav.xhtml": nav,
      "toc.ncx": ncx,
    });
    expect((await extractEpubToc(bytes)).map((t) => t.label)).toEqual(["From nav"]);
  });

  it("resolves nav hrefs against the nav's own folder, then against the OPF folder", async () => {
    // OPF in OEBPS/, nav in OEBPS/nav/, chapters in OEBPS/text/ and one outside OEBPS.
    const nav = `<html ${XHTML_NS}><body><nav epub:type="toc"><ol>
      <li><a href="../text/c1.xhtml">One</a></li>
      <li><a href="../text/c2.xhtml#mid">Two</a></li>
      <li><a href="sibling.xhtml">Three</a></li>
      <li><a href="../text/with%20space.xhtml">Four</a></li>
    </ol></nav></body></html>`;
    const bytes = await build("OEBPS/content.opf", {
      "OEBPS/content.opf": OPF(
        item("nav", "nav/toc.xhtml", "application/xhtml+xml", "nav") +
          item("c1", "text/c1.xhtml") +
          item("c2", "text/c2.xhtml") +
          item("c3", "nav/sibling.xhtml") +
          item("c4", "text/with%20space.xhtml"),
      ),
      "OEBPS/nav/toc.xhtml": nav,
    });
    const toc = await extractEpubToc(bytes);
    expect(toc.map((t) => t.href)).toEqual([
      "text/c1.xhtml",
      "text/c2.xhtml#mid",
      "nav/sibling.xhtml",
      "text/with%20space.xhtml",
    ]);
    await expectHrefsInManifest(bytes, toc);
  });

  it("resolves NCX hrefs against the NCX's own folder", async () => {
    const ncx = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint id="p"><navLabel><text>One</text></navLabel><content src="../text/c1.xhtml#x"/></navPoint>
    </navMap></ncx>`;
    const bytes = await build("OEBPS/content.opf", {
      "OEBPS/content.opf": OPF(
        item("ncx", "meta/toc.ncx", "application/x-dtbncx+xml") + item("c1", "text/c1.xhtml"),
        ' toc="ncx"',
      ),
      "OEBPS/meta/toc.ncx": ncx,
    });
    expect(await extractEpubToc(bytes)).toEqual([
      { href: "text/c1.xhtml#x", label: "One" },
    ]);
  });

  it("OPF in the zip root and nav in a folder above the content", async () => {
    // Nav at the zip root, OPF in a subfolder: hrefs climb out through "..".
    const nav = `<html ${XHTML_NS}><body><nav epub:type="toc"><ol><li><a href="book/text/c1.xhtml">One</a></li></ol></nav></body></html>`;
    const bytes = await build("book/content.opf", {
      "book/content.opf": OPF(
        item("nav", "../nav.xhtml", "application/xhtml+xml", "nav") + item("c1", "text/c1.xhtml"),
      ),
      "nav.xhtml": nav,
    });
    expect(await extractEpubToc(bytes)).toEqual([
      { href: "text/c1.xhtml", label: "One" },
    ]);
  });

  it("skips external links and entries with no usable href", async () => {
    const nav = `<html ${XHTML_NS}><body><nav epub:type="toc"><ol>
      <li><a href="https://example.com/x">Web</a></li>
      <li><span>Heading with nothing under it</span></li>
      <li><a href="a.xhtml">Real</a></li>
    </ol></nav></body></html>`;
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") + item("c1", "a.xhtml"),
      ),
      "nav.xhtml": nav,
    });
    expect((await extractEpubToc(bytes)).map((t) => t.label)).toEqual(["Real"]);
  });

  it("returns [] when the EPUB has no navigation document", async () => {
    const bytes = await build("content.opf", {
      "content.opf": OPF(item("c1", "a.xhtml")),
      "a.xhtml": "<html/>",
    });
    expect(await extractEpubToc(bytes)).toEqual([]);
  });

  it("returns [] when the nav has no list", async () => {
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") + item("c1", "a.xhtml"),
      ),
      "nav.xhtml": `<html ${XHTML_NS}><body><nav epub:type="toc"><h1>Contents</h1></nav></body></html>`,
    });
    expect(await extractEpubToc(bytes)).toEqual([]);
  });

  it("falls back to the NCX when the nav is empty", async () => {
    const ncx = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="p"><navLabel><text>Via ncx</text></navLabel><content src="a.xhtml"/></navPoint></navMap></ncx>`;
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") +
          item("ncx", "toc.ncx", "application/x-dtbncx+xml") +
          item("c1", "a.xhtml"),
      ),
      "nav.xhtml": `<html ${XHTML_NS}><body><nav epub:type="toc"></nav></body></html>`,
      "toc.ncx": ncx,
    });
    expect((await extractEpubToc(bytes)).map((t) => t.label)).toEqual(["Via ncx"]);
  });
});

describe("extractEpubToc: malformed input", () => {
  it("throws InvalidEpubError for bytes that are not a zip", async () => {
    await expect(extractEpubToc(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      InvalidEpubError,
    );
  });

  it("throws InvalidEpubError when there is no container.xml", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(extractEpubToc(bytes)).rejects.toBeInstanceOf(InvalidEpubError);
  });

  it("throws InvalidEpubError when the nav is not well-formed", async () => {
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") + item("c1", "a.xhtml"),
      ),
      "nav.xhtml": `<html><body><nav><ol><li><a href="a.xhtml">Broken</li></ol></body>`,
    });
    await expect(extractEpubToc(bytes)).rejects.toBeInstanceOf(InvalidEpubError);
  });

  it("throws InvalidEpubError when the nav is listed but missing from the archive", async () => {
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("nav", "nav.xhtml", "application/xhtml+xml", "nav") + item("c1", "a.xhtml"),
      ),
    });
    await expect(extractEpubToc(bytes)).rejects.toBeInstanceOf(InvalidEpubError);
  });

  it("throws InvalidEpubError when the NCX is not well-formed", async () => {
    const bytes = await build("content.opf", {
      "content.opf": OPF(
        item("ncx", "toc.ncx", "application/x-dtbncx+xml") + item("c1", "a.xhtml"),
      ),
      "toc.ncx": "<ncx><navMap><navPoint></navMap>",
    });
    await expect(extractEpubToc(bytes)).rejects.toBeInstanceOf(InvalidEpubError);
  });
});
