import { createHash } from "node:crypto";
import { crc32, inflateSync } from "node:zlib";
import type { PDFDict, PDFRawStream } from "pdf-lib";
import type { DeckScan, PictureFact } from "./material-visuals";

// ── THE PICTURES INSIDE A PDF ── SCHOLAR-VISUAL-CLASSIFY-01 ─────────────────────────────────────────────────────────────
//
// Server only (pdf-lib, sharp). Each page's image XObjects are listed and measured, and served in their ORIGINAL form where a
// browser can show it:
//   * /DCTDecode (a JPEG)                      -> the stream's own bytes, unmodified, as image/jpeg;
//   * /FlateDecode, 8-bit DeviceRGB / DeviceGray, no mask, no /Decode  -> the same pixels as a lossless PNG (no resize, crop or
//                                                  rotation: a PNG-predicted stream becomes a PNG by wrapping its own data);
//   * anything else (JPX, CCITT, Indexed, CMYK, ICC profiles, soft masks, image masks) -> not handed over; the single page of
//     the learner's PDF stands for it (material-visuals-io.ts, pdfPagesPdf).
// Nothing is drawn, rendered or interpreted. Images inside Form XObjects are not enumerated (a limit, stated in the docs).

const sha16 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const MAX_PIXELS = 100_000_000;

type Lib = typeof import("pdf-lib");
type Route = { via: "direct"; kind: "jpeg" } | { via: "converted"; kind: "png"; channels: 1 | 3; predictor: boolean } | { via: "page" };

/** Pure-ish. The JPEG's number of colour components from its frame header (1 grey, 3 colour, 4 CMYK), or null. */
export function jpegComponents(b: Uint8Array): number | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return b[i + 9] ?? null;
    i += 2 + len;
  }
  return null;
}

function nameOf(lib: Lib, v: unknown): string | null {
  return v instanceof lib.PDFName ? v.decodeText() : null;
}
function numberOf(lib: Lib, dict: PDFDict, key: string): number | null {
  const v = dict.lookup(lib.PDFName.of(key));
  return v instanceof lib.PDFNumber ? v.asNumber() : null;
}

/** How a PDF image is served. */
function routeOf(lib: Lib, stream: PDFRawStream): { route: Route; width: number | null; height: number | null } {
  const { PDFName, PDFArray, PDFDict, PDFBool } = lib;
  const dict = stream.dict;
  const width = numberOf(lib, dict, "Width"), height = numberOf(lib, dict, "Height");
  const page = { route: { via: "page" } as Route, width, height };
  if (!width || !height || width * height > MAX_PIXELS) return page;
  const flag = (k: string) => dict.lookup(PDFName.of(k));
  if (flag("SMask") || flag("Mask") || flag("Decode")) return page;
  const im = flag("ImageMask");
  if (im instanceof PDFBool && im.asBoolean()) return page;
  let filter = dict.lookup(PDFName.of("Filter"));
  let parms = dict.lookup(PDFName.of("DecodeParms"));
  if (filter instanceof PDFArray) { if (filter.size() !== 1) return page; parms = parms instanceof PDFArray ? parms.lookup(0) : parms; filter = filter.lookup(0); }
  const f = nameOf(lib, filter);
  if (f === "DCTDecode") {
    const comps = jpegComponents(stream.contents);
    return comps === 1 || comps === 3 ? { route: { via: "direct", kind: "jpeg" }, width, height } : page;
  }
  if (f === "FlateDecode") {
    const cs = nameOf(lib, dict.lookup(PDFName.of("ColorSpace")));
    const channels = cs === "DeviceRGB" ? 3 : cs === "DeviceGray" ? 1 : 0;
    if (!channels || numberOf(lib, dict, "BitsPerComponent") !== 8) return page;
    let predictor = false;
    if (parms instanceof PDFDict) {
      const pr = numberOf(lib, parms, "Predictor") ?? 1;
      if (pr >= 10) {
        if ((numberOf(lib, parms, "Colors") ?? 1) !== channels || (numberOf(lib, parms, "BitsPerComponent") ?? 8) !== 8 || (numberOf(lib, parms, "Columns") ?? 1) !== width) return page;
        predictor = true;
      } else if (pr !== 1) return page;
    }
    return { route: { via: "converted", kind: "png", channels: channels as 1 | 3, predictor }, width, height };
  }
  return page;
}

/** Every page's image XObjects, measured. Null when the PDF cannot be opened (encrypted, damaged). */
export async function scanPdfImages(bytes: Uint8Array): Promise<DeckScan | null> {
  try {
    const lib = await import("pdf-lib");
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    const pages = doc.getPages();
    const scan: DeckScan = { slides: pages.length, pictures: [], undisplayable: [] };
    const measured = new Map<number, Omit<PictureFact, "n"> | null>();
    for (const [i, page] of pages.entries()) {
      const xo = page.node.Resources()?.lookupMaybe(lib.PDFName.of("XObject"), lib.PDFDict);
      if (!xo) continue;
      for (const [, value] of xo.entries()) {
        if (!(value instanceof lib.PDFRef)) continue; // a direct stream cannot be named again, so it is never served
        const obj = doc.context.lookup(value);
        if (!(obj instanceof lib.PDFRawStream) || nameOf(lib, obj.dict.lookup(lib.PDFName.of("Subtype"))) !== "Image") continue;
        if (!measured.has(value.objectNumber)) {
          const r = routeOf(lib, obj);
          measured.set(value.objectNumber, {
            media: `x${value.objectNumber}`, kind: r.route.via === "page" ? null : r.route.kind, width: r.width, height: r.height,
            bytes: obj.contents.byteLength, sha: sha16(obj.contents), via: r.route.via,
          });
        }
        const fact = measured.get(value.objectNumber);
        if (fact) scan.pictures.push({ n: i + 1, ...fact });
      }
    }
    return scan;
  } catch {
    return null;
  }
}

const png = (type: string, data: Uint8Array) => {
  const t = Buffer.from(type, "ascii"), d = Buffer.from(data);
  const out = Buffer.alloc(12 + d.length);
  out.writeUInt32BE(d.length, 0); t.copy(out, 4); d.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, d])) >>> 0, 8 + d.length);
  return out;
};

export type PdfImageFile = { bytes: Uint8Array; type: string } | "page" | null;

/**
 * One image of the learner's PDF by its object number, in its original form (see the header). "page": hand over the page
 * instead. Null: not found, or its bytes no longer match the key's digest.
 */
export async function pdfImageFile(bytes: Uint8Array, objectNumber: number, sha: string): Promise<PdfImageFile> {
  try {
    const lib = await import("pdf-lib");
    const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    const obj = doc.context.lookup(lib.PDFRef.of(objectNumber));
    if (!(obj instanceof lib.PDFRawStream) || sha16(obj.contents) !== sha) return null;
    const { route, width, height } = routeOf(lib, obj);
    if (route.via === "page" || !width || !height) return "page";
    if (route.via === "direct") return { bytes: new Uint8Array(obj.contents), type: "image/jpeg" };
    const sharp = (await import("sharp")).default;
    let out: Buffer;
    if (route.predictor) {
      // A PNG-predicted Flate stream IS a PNG image-data stream: wrap it, change nothing.
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = route.channels === 3 ? 2 : 0;
      out = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), png("IHDR", ihdr), png("IDAT", obj.contents), png("IEND", new Uint8Array())]);
      await sharp(out, { limitInputPixels: MAX_PIXELS }).metadata(); // a header the decoder accepts
    } else {
      const raw = inflateSync(obj.contents);
      if (raw.length < width * height * route.channels) return "page";
      out = await sharp(raw, { raw: { width, height, channels: route.channels }, limitInputPixels: MAX_PIXELS }).png().toBuffer();
    }
    return { bytes: new Uint8Array(out), type: "image/png" };
  } catch {
    return null;
  }
}
