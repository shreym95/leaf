import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { checkDrm } from "./drm";
import { assertValidEpub, InvalidEpubError } from "./validate";
import { extractEpubMetadata } from "./metadata";

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function opf(opts: { title?: string; creators?: string[]; extraManifest?: string } = {}) {
  const { title = "Test Book", creators = ["Ada Lovelace"], extraManifest = "" } = opts;
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test</dc:identifier>
    <dc:title>${title}</dc:title>
    ${creators.map((c) => `<dc:creator>${c}</dc:creator>`).join("\n    ")}
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    ${extraManifest}
  </manifest>
  <spine>
    <itemref idref="c1"/>
  </spine>
</package>`;
}

const CHAPTER_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head>
<body><h1>Chapter 1</h1><p>Hello.</p></body></html>`;

interface BuildOpts {
  encryptionXml?: string;
  rightsXml?: string;
  lcpl?: string;
  opfXml?: string;
  extraFiles?: Record<string, string>;
  omitMimetype?: boolean;
}

async function buildEpub(opts: BuildOpts = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  if (!opts.omitMimetype) zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", opts.opfXml ?? opf());
  zip.file("OEBPS/chapter1.xhtml", CHAPTER_XHTML);
  if (opts.encryptionXml) zip.file("META-INF/encryption.xml", opts.encryptionXml);
  if (opts.rightsXml) zip.file("META-INF/rights.xml", opts.rightsXml);
  if (opts.lcpl) zip.file("META-INF/license.lcpl", opts.lcpl);
  for (const [path, body] of Object.entries(opts.extraFiles ?? {})) {
    zip.file(path, body);
  }
  return zip.generateAsync({ type: "uint8array" });
}

const encryptionFor = (uri: string, algorithm: string) => `<?xml version="1.0" encoding="utf-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="${algorithm}"/>
    <enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`;

describe("checkDrm", () => {
  it("(1) clean minimal EPUB -> drmFree: true", async () => {
    const bytes = await buildEpub();
    expect(await checkDrm(bytes)).toEqual({ drmFree: true });
  });

  it("(2) encryption.xml encrypting a content document -> drmFree: false", async () => {
    const bytes = await buildEpub({
      encryptionXml: encryptionFor(
        "OEBPS/chapter1.xhtml",
        "http://www.w3.org/2001/04/xmlenc#aes256-cbc",
      ),
    });
    const res = await checkDrm(bytes);
    expect(res.drmFree).toBe(false);
    expect(res.reason).toMatch(/content document/i);
  });

  it("(3) META-INF/rights.xml with ADEPT -> drmFree: false", async () => {
    const bytes = await buildEpub({
      rightsXml: `<?xml version="1.0"?><rights xmlns="http://ns.adobe.com/adept"><licenseToken/></rights>`,
    });
    const res = await checkDrm(bytes);
    expect(res.drmFree).toBe(false);
    expect(res.reason).toMatch(/rights\.xml/i);
  });

  it("(4) encryption.xml with only IDPF font obfuscation -> drmFree: true", async () => {
    const bytes = await buildEpub({
      opfXml: opf({
        extraManifest:
          '<item id="f1" href="fonts/body.otf" media-type="application/vnd.ms-opentype"/>',
      }),
      encryptionXml: encryptionFor(
        "OEBPS/fonts/body.otf",
        "http://www.idpf.org/2008/embedding",
      ),
      extraFiles: { "OEBPS/fonts/body.otf": "FONTBYTES" },
    });
    expect(await checkDrm(bytes)).toEqual({ drmFree: true });
  });

  it("rejects an Adobe ADEPT algorithm in encryption.xml", async () => {
    const bytes = await buildEpub({
      encryptionXml: encryptionFor(
        "OEBPS/whatever.bin",
        "http://ns.adobe.com/adept#aes128-cbc",
      ),
    });
    const res = await checkDrm(bytes);
    expect(res.drmFree).toBe(false);
    expect(res.reason).toMatch(/adept/i);
  });

  it("rejects a Readium LCP license", async () => {
    const bytes = await buildEpub({ lcpl: "{}" });
    const res = await checkDrm(bytes);
    expect(res.drmFree).toBe(false);
    expect(res.reason).toMatch(/lcp/i);
  });
});

describe("assertValidEpub", () => {
  it("passes a well-formed EPUB", async () => {
    await expect(assertValidEpub(await buildEpub())).resolves.toBeUndefined();
  });

  it("rejects non-zip bytes", async () => {
    await expect(
      assertValidEpub(new TextEncoder().encode("not a zip")),
    ).rejects.toBeInstanceOf(InvalidEpubError);
  });

  it("rejects a zip with no mimetype entry", async () => {
    await expect(
      assertValidEpub(await buildEpub({ omitMimetype: true })),
    ).rejects.toBeInstanceOf(InvalidEpubError);
  });

  it("rejects a zip with no content documents", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("META-INF/container.xml", CONTAINER_XML);
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf">
       <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>x</dc:title></metadata>
       <manifest><item id="css" href="s.css" media-type="text/css"/></manifest><spine/></package>`,
    );
    await expect(
      assertValidEpub(await zip.generateAsync({ type: "uint8array" })),
    ).rejects.toBeInstanceOf(InvalidEpubError);
  });
});

describe("extractEpubMetadata", () => {
  it("reads dc:title and a single dc:creator", async () => {
    const bytes = await buildEpub({
      opfXml: opf({ title: "Frankenstein", creators: ["Mary Shelley"] }),
    });
    expect(await extractEpubMetadata(bytes)).toEqual({
      title: "Frankenstein",
      author: "Mary Shelley",
    });
  });

  it("joins multiple dc:creator entries", async () => {
    const bytes = await buildEpub({
      opfXml: opf({ creators: ["Nicci French", "Sean French"] }),
    });
    expect((await extractEpubMetadata(bytes)).author).toBe(
      "Nicci French, Sean French",
    );
  });

  it("falls back to Untitled / empty author when metadata is absent", async () => {
    const bytes = await buildEpub({
      opfXml: `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier>x</dc:identifier></metadata>
        <manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="c1"/></spine></package>`,
    });
    expect(await extractEpubMetadata(bytes)).toEqual({
      title: "Untitled",
      author: "",
    });
  });
});
