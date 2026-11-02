import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { jpegComponents, pdfImageFile, scanPdfImages } from "./material-visuals-pdf";
import { buildVisuals, pageInfoOf } from "./material-visuals";

// SCHOLAR-VISUAL-CLASSIFY-01: pictures inside a PDF, served in their original form. A tiny generated deck stands in for a
// slide deck saved as PDF: a title-only chart page (JPEG), a textless Flate screenshot, a thin banner, an image with a soft
// mask (stood for by its page) and a logo repeated on most pages.

const noiseRaw = (w: number, h: number) => randomBytes(w * h * 3);

async function build() {
  const jpeg = await sharp(noiseRaw(300, 200), { raw: { width: 300, height: 200, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  const rawRgb = noiseRaw(200, 150);
  const png = await sharp(rawRgb, { raw: { width: 200, height: 150, channels: 3 } }).png().toBuffer();
  const bannerPng = await sharp(noiseRaw(898, 89), { raw: { width: 898, height: 89, channels: 3 } }).png().toBuffer();
  const alphaPng = await sharp(randomBytes(160 * 120 * 4), { raw: { width: 160, height: 120, channels: 4 } }).png().toBuffer();
  const logoPng = await sharp(noiseRaw(150, 150), { raw: { width: 150, height: 150, channels: 3 } }).png().toBuffer();

  const doc = await PDFDocument.create();
  const pages = Array.from({ length: 6 }, () => doc.addPage([960, 540]));
  const j = await doc.embedJpg(jpeg), p = await doc.embedPng(png), b = await doc.embedPng(bannerPng), a = await doc.embedPng(alphaPng), l = await doc.embedPng(logoPng);
  pages[0].drawImage(j, { x: 10, y: 10, width: 300, height: 200 });                       // page 1: JPEG
  pages[1].drawImage(p, { x: 10, y: 10, width: 200, height: 150 });                       // page 2: Flate RGB
  pages[2].drawImage(b, { x: 0, y: 0, width: 898, height: 89 });                          // page 3: banner
  pages[3].drawImage(a, { x: 10, y: 10, width: 160, height: 120 });                       // page 4: soft mask
  for (const pg of pages.slice(0, 4)) pg.drawImage(l, { x: 800, y: 450, width: 100, height: 100 }); // logo on 4 of 6 pages
  return { bytes: new Uint8Array(await doc.save()), jpeg, rawRgb };
}

describe("the pictures inside a PDF", () => {
  it("lists each page's images, measured; the banner, the logo and the tiny are filtered by the shared rules", async () => {
    const { bytes } = await build();
    const scan = await scanPdfImages(bytes);
    expect(scan?.slides).toBe(6);
    const by = (n: number) => scan!.pictures.filter(p => p.n === n);
    expect(by(1).map(p => [p.width, p.height, p.via])).toContainEqual([300, 200, "direct"]);
    expect(by(2).map(p => [p.width, p.height, p.via])).toContainEqual([200, 150, "converted"]);
    expect(by(4).some(p => p.via === "page")).toBe(true); // the soft mask: the page stands for it
    const r = buildVisuals(scan, { unit: "page" });
    expect(r.visuals.map(v => [v.n, v.kind])).toEqual([[1, "jpeg"], [2, "png"], [4, "pdf_page"]]);
    expect(r.visuals.every(v => v.key.startsWith(`p${v.n}`))).toBe(true);
  });

  it("serves a JPEG byte for byte, unmodified", async () => {
    const { bytes, jpeg } = await build();
    const scan = await scanPdfImages(bytes);
    const v = buildVisuals(scan, { unit: "page" }).visuals.find(x => x.n === 1)!;
    const f = await pdfImageFile(bytes, Number(v.media!.slice(1)), v.sha);
    expect(f).not.toBeNull();
    expect(f).not.toBe("page");
    const file = f as { bytes: Uint8Array; type: string };
    expect(file.type).toBe("image/jpeg");
    expect(Buffer.from(file.bytes).equals(jpeg)).toBe(true);
  });

  it("serves a Flate image as a lossless PNG of the same size and the same pixels", async () => {
    const { bytes, rawRgb } = await build();
    const scan = await scanPdfImages(bytes);
    const v = buildVisuals(scan, { unit: "page" }).visuals.find(x => x.n === 2)!;
    const f = (await pdfImageFile(bytes, Number(v.media!.slice(1)), v.sha)) as { bytes: Uint8Array; type: string };
    expect(f.type).toBe("image/png");
    const meta = await sharp(f.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 200, 150]);
    const pixels = await sharp(f.bytes).removeAlpha().raw().toBuffer();
    expect(pixels.equals(rawRgb)).toBe(true);
  });

  it("an image with a soft mask is not handed over: the page stands for it; a wrong digest is not found", async () => {
    const { bytes } = await build();
    const scan = await scanPdfImages(bytes);
    const m = scan!.pictures.find(p => p.via === "page")!;
    expect(await pdfImageFile(bytes, Number(m.media.slice(1)), m.sha)).toBe("page");
    const ok = scan!.pictures.find(p => p.via === "direct")!;
    expect(await pdfImageFile(bytes, Number(ok.media.slice(1)), "0000000000000000")).toBeNull();
    expect(await pdfImageFile(bytes, 99999, ok.sha)).toBeNull();
  });

  it("a textless page with no picture is the visual; a PDF that cannot be opened still has its image-only pages", async () => {
    expect(await scanPdfImages(new Uint8Array([1, 2, 3]))).toBeNull();
    const r = buildVisuals(null, { unit: "page", emptyUnits: [7, 8], pages: pageInfoOf([], [7, 8], []) });
    expect(r.visuals.map(v => v.key)).toEqual(["p7", "p8"]);
  });

  it("reads a JPEG's number of colour components from its frame header", async () => {
    const grey = await sharp(randomBytes(40 * 40), { raw: { width: 40, height: 40, channels: 1 } }).toColourspace("b-w").jpeg().toBuffer();
    const rgb = await sharp(noiseRaw(40, 40), { raw: { width: 40, height: 40, channels: 3 } }).jpeg().toBuffer();
    expect(jpegComponents(grey)).toBe(1);
    expect(jpegComponents(rgb)).toBe(3);
    expect(jpegComponents(new Uint8Array([0, 1, 2]))).toBeNull();
  });
});
