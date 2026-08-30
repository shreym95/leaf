import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractEpubCover } from "./cover";

const bundled = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../public/bundled",
);

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

/** Build a minimal EPUB whose cover is declared the way `variant` says. */
async function epubWithCover(
  variant: "epub3-properties" | "epub2-meta" | "named-cover" | "none",
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );

  const imageName = variant === "named-cover" ? "cover.png" : "img1.png";
  zip.file(`OEBPS/${imageName}`, PNG);

  const props =
    variant === "epub3-properties" ? ` properties="cover-image"` : "";
  const meta =
    variant === "epub2-meta" ? `<meta name="cover" content="the-cover"/>` : "";

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>T</dc:title><dc:creator>A</dc:creator>${meta}
      </metadata>
      <manifest>
        <item id="the-cover" href="${imageName}" media-type="image/png"${props}/>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
    </package>`,
  );
  zip.file("OEBPS/ch1.xhtml", "<html><body><p>Hi</p></body></html>");
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("extractEpubCover", () => {
  it("uses the EPUB 3 cover-image property", async () => {
    const cover = await extractEpubCover(await epubWithCover("epub3-properties"));
    expect(cover?.mediaType).toBe("image/png");
    expect(cover?.extension).toBe("png");
    expect(cover?.bytes.byteLength).toBeGreaterThan(0);
  });

  it("falls back to the EPUB 2 <meta name=cover> id", async () => {
    const cover = await extractEpubCover(await epubWithCover("epub2-meta"));
    expect(cover?.extension).toBe("png");
  });

  it("falls back again to an image simply named cover", async () => {
    const cover = await extractEpubCover(await epubWithCover("named-cover"));
    expect(cover?.extension).toBe("png");
  });

  it("returns null when the book carries no cover — not an error", async () => {
    // A book without a picture is still a complete book; the shelf falls back
    // to the title initial.
    expect(await extractEpubCover(await epubWithCover("none"))).toBeNull();
  });

  it("returns null for bytes that are not an EPUB at all", async () => {
    const junk = new TextEncoder().encode("this is not a zip").buffer;
    expect(await extractEpubCover(junk)).toBeNull();
  });

  // The real proof: the EPUBs actually shipped with the app.
  for (const file of ["frankenstein.epub", "wizard-of-oz.epub", "time-machine.epub"]) {
    const path = join(bundled, file);
    it.skipIf(!existsSync(path))(`finds the cover in ${file}`, async () => {
      const cover = await extractEpubCover(readFileSync(path));
      expect(cover, file).not.toBeNull();
      expect(cover!.mediaType.startsWith("image/")).toBe(true);
      expect(cover!.bytes.byteLength).toBeGreaterThan(1000);
    });
  }
});
