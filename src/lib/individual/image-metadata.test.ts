import { describe, expect, it } from "vitest";
import { sniffImage, stripImageMetadata } from "./image-metadata";

// COMPETEN-INDIVIDUAL-IDENTITY-HUB-01: a profile photo keeps no location, device or time metadata.

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap(p => (typeof p === "string" ? [...p].map(c => c.charCodeAt(0)) : p)));
const seg = (marker: number, payload: number[] | string) => {
  const body = typeof payload === "string" ? [...payload].map(c => c.charCodeAt(0)) : payload;
  const len = body.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...body];
};
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, "latin1"));

describe("JPEG", () => {
  const jpeg = bytes([0xff, 0xd8], seg(0xe0, "JFIF\0"), seg(0xe1, "Exif\0\0GPS-SECRET"), seg(0xe2, "ICC_PROFILE"), seg(0xed, "Photoshop IPTC SECRET"), seg(0xfe, "COMMENT SECRET"),
    seg(0xdb, [1, 2, 3]), [0xff, 0xda, 0, 4, 9, 9, 0x11, 0x22, 0xff, 0xd9]);
  it("drops EXIF, IPTC and comments, keeps JFIF, the colour profile and the image data", () => {
    const out = stripImageMetadata(jpeg, "image/jpeg")!;
    expect(has(out, "GPS-SECRET") || has(out, "IPTC SECRET") || has(out, "COMMENT SECRET")).toBe(false);
    expect(has(out, "JFIF") && has(out, "ICC_PROFILE")).toBe(true);
    expect(Array.from(out.slice(-8))).toEqual(Array.from(jpeg.slice(-8)));
  });
  it("refuses what it cannot parse", () => {
    expect(stripImageMetadata(bytes([0xff, 0xd8, 0x00, 0x00]), "image/jpeg")).toBeNull();
  });
});

describe("PNG", () => {
  const chunk = (type: string, data: string) => { const d = [...data].map(c => c.charCodeAt(0)); return [0, 0, 0, d.length, ...[...type].map(c => c.charCodeAt(0)), ...d, 0, 0, 0, 0]; };
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk("IHDR", "hdr"), chunk("eXIf", "GPS-SECRET"), chunk("tEXt", "Author SECRET"), chunk("IDAT", "pixels"), chunk("IEND", ""));
  it("drops eXIf and text chunks, keeps the image", () => {
    const out = stripImageMetadata(png, "image/png")!;
    expect(has(out, "GPS-SECRET") || has(out, "Author SECRET")).toBe(false);
    expect(has(out, "IHDR") && has(out, "IDAT") && has(out, "IEND")).toBe(true);
  });
});

describe("WebP", () => {
  const ck = (type: string, data: number[]) => [...[...type].map(c => c.charCodeAt(0)), data.length, 0, 0, 0, ...data, ...(data.length % 2 ? [0] : [])];
  const body = [...ck("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...ck("VP8 ", [1, 2, 3, 4]), ...ck("EXIF", [...[..."GPS-SECRET"].map(c => c.charCodeAt(0))]), ...ck("XMP ", [...[..."XMP-SECRET"].map(c => c.charCodeAt(0))])];
  const size = 4 + body.length;
  const webp = bytes("RIFF", [size & 0xff, size >> 8, 0, 0], "WEBP", body);
  it("drops EXIF and XMP, clears their flags and fixes the size", () => {
    const out = stripImageMetadata(webp, "image/webp")!;
    expect(has(out, "GPS-SECRET") || has(out, "XMP-SECRET")).toBe(false);
    expect(out[20] & 0x0c).toBe(0);
    expect(out[4] | (out[5] << 8)).toBe(out.length - 8);
    expect(sniffImage(out)).toBe("image/webp");
  });
});

describe("the container decides the type, not the browser", () => {
  it("recognises the three, and nothing else", () => {
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(bytes("GIF89a......"))).toBeNull();
  });
});
