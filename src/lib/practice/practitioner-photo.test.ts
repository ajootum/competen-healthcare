/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-BOOK-PROFILE-001 s4/s15 -- the photograph's two server-side controls, tested by being run.
 *
 * These are the controls that decide what bytes reach a public bucket, and there is no image library
 * in this deployment to lean on, so they are hand-written and therefore worth real tests:
 *
 *   1. IS IT A JPEG -- from the magic bytes, never the declared type or the file name.
 *   2. IS THE METADATA GONE -- every APPn segment removed, including an EXIF block carrying GPS.
 *
 * The fixtures are built here rather than committed as binaries, so what each test asserts is visible
 * in the file: you can see the EXIF block go in, and see it not come out.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { looksLikeJpeg, stripJpegMetadata } from "./practitioner-photo";

/** A segment: FF <marker> <2-byte length including itself> <payload>. */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
/** Start of Scan, then entropy-coded data. Note the FF 00 -- an escaped FF inside image data. */
const SCAN = [...segment(0xda, [0x00, 0x01]), 0x12, 0x34, 0xff, 0x00, 0x56, ...EOI];
/** A quantisation table: a real segment that must SURVIVE. */
const DQT = segment(0xdb, [0x00, 0x11, 0x22, 0x33]);
/** APP1 carrying an EXIF header and something that stands in for GPS. */
const EXIF = segment(0xe1, [
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
  0x47, 0x50, 0x53, 0x2d, 0x48, 0x45, 0x52, 0x45, // "GPS-HERE"
]);
/** APP0 JFIF, which is ordinary and still metadata. */
const JFIF = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]);

const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());
const contains = (hay: Uint8Array, needle: number[]) =>
  Buffer.from(hay).includes(Buffer.from(needle));

describe("CPR-BOOK-PROFILE-001 photograph: is it a JPEG", () => {
  it("accepts bytes that start with the Start-of-Image marker", () => {
    expect(looksLikeJpeg(bytes(SOI, DQT, SCAN))).toBe(true);
  });

  it("refuses a PNG, whatever it claims to be", () => {
    // The PNG signature. A file named headshot.jpg with these bytes is still a PNG.
    expect(looksLikeJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
  });

  it("refuses empty and near-empty input rather than reading past the end", () => {
    expect(looksLikeJpeg(Uint8Array.from([]))).toBe(false);
    expect(looksLikeJpeg(Uint8Array.from([0xff]))).toBe(false);
    expect(looksLikeJpeg(Uint8Array.from([0xff, 0xd8]))).toBe(false);
  });
});

describe("CPR-BOOK-PROFILE-001 photograph: metadata stripping", () => {
  it("removes an EXIF block, and with it anything it was carrying", () => {
    const withExif = bytes(SOI, EXIF, DQT, SCAN);
    // The fixture really does contain what the test claims -- otherwise this proves nothing.
    expect(contains(withExif, [0x45, 0x78, 0x69, 0x66])).toBe(true);
    expect(contains(withExif, [0x47, 0x50, 0x53, 0x2d, 0x48, 0x45, 0x52, 0x45])).toBe(true);

    const clean = stripJpegMetadata(withExif)!;
    expect(clean).not.toBeNull();
    expect(contains(clean, [0x45, 0x78, 0x69, 0x66])).toBe(false);
    expect(contains(clean, [0x47, 0x50, 0x53, 0x2d, 0x48, 0x45, 0x52, 0x45])).toBe(false);
  });

  it("removes JFIF (APP0) as well -- every APPn goes, not only the one carrying GPS", () => {
    const clean = stripJpegMetadata(bytes(SOI, JFIF, EXIF, DQT, SCAN))!;
    expect(contains(clean, [0x4a, 0x46, 0x49, 0x46])).toBe(false);
  });

  it("KEEPS the segments the decoder needs -- a stripper that removes those makes an unopenable file", () => {
    const clean = stripJpegMetadata(bytes(SOI, EXIF, DQT, SCAN))!;
    // The quantisation table and its payload survive.
    expect(contains(clean, [0xff, 0xdb])).toBe(true);
    expect(contains(clean, [0x00, 0x11, 0x22, 0x33])).toBe(true);
    // It still begins as a JPEG and still ends with End-of-Image.
    expect(clean[0]).toBe(0xff);
    expect(clean[1]).toBe(0xd8);
    expect(Array.from(clean.slice(-2))).toEqual(EOI);
  });

  it("copies image data after the scan verbatim, escaped FF bytes and all", () => {
    // ⚠ THE ONE THAT WOULD CORRUPT PHOTOGRAPHS SILENTLY. After Start-of-Scan an 0xFF is not a marker;
    // a stripper that keeps walking for segments reads compressed pixels as structure.
    const clean = stripJpegMetadata(bytes(SOI, DQT, SCAN))!;
    expect(contains(clean, [0x12, 0x34, 0xff, 0x00, 0x56])).toBe(true);
  });

  it("leaves a file that has no metadata exactly as it was", () => {
    const already = bytes(SOI, DQT, SCAN);
    expect(Array.from(stripJpegMetadata(already)!)).toEqual(Array.from(already));
  });

  it("refuses what it cannot parse rather than storing bytes it did not understand", () => {
    expect(stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    // Starts like a JPEG and then is not one.
    expect(stripJpegMetadata(bytes(SOI, [0x00, 0x01, 0x02, 0x03]))).toBeNull();
    // A segment claiming to be longer than the file.
    expect(stripJpegMetadata(bytes(SOI, [0xff, 0xe1, 0x7f, 0xff], [0x00]))).toBeNull();
    // A length under two, which cannot include its own two bytes.
    expect(stripJpegMetadata(bytes(SOI, [0xff, 0xe1, 0x00, 0x01], [0x00]))).toBeNull();
  });

  it("does not grow the file -- stripping only ever removes", () => {
    const withExif = bytes(SOI, JFIF, EXIF, DQT, SCAN);
    expect(stripJpegMetadata(withExif)!.length).toBeLessThan(withExif.length);
  });
});

/**
 * ⚠ THE TESTS ABOVE BUILD THEIR OWN JPEGs, WHICH MEANS THEY COULD BE WRONG IN EXACTLY THE WAY THE
 * PARSER IS WRONG. These use a real photograph shipped in this repository, so the structure is one a
 * camera and an encoder actually produced rather than one this file invented.
 *
 * The round trip is the strong assertion: inject an EXIF block into a real image, strip it, and require
 * the result to be BYTE-IDENTICAL to the original. That can only pass if the stripper removed exactly
 * what was added and touched nothing else -- not a single byte of image data.
 */
describe("CPR-BOOK-PROFILE-001 photograph: against a real JPEG", () => {
  const real = new Uint8Array(readFileSync(join(process.cwd(), "public/images/og/competen.jpg")));

  it("reads a real photograph and leaves an already-clean one untouched", () => {
    expect(looksLikeJpeg(real)).toBe(true);
    const clean = stripJpegMetadata(real);
    expect(clean).not.toBeNull();
    expect(Buffer.from(clean!).equals(Buffer.from(real))).toBe(true);
  });

  it("removes an EXIF block injected into a real photograph, byte for byte", () => {
    // Injected immediately after Start-of-Image, which is where a camera writes it.
    const injected = Uint8Array.from([
      ...Array.from(real.slice(0, 2)),
      ...EXIF,
      ...Array.from(real.slice(2)),
    ]);
    expect(injected.length).toBe(real.length + EXIF.length);
    expect(contains(injected, [0x47, 0x50, 0x53, 0x2d, 0x48, 0x45, 0x52, 0x45])).toBe(true);

    const clean = stripJpegMetadata(injected)!;
    expect(clean).not.toBeNull();
    expect(contains(clean, [0x47, 0x50, 0x53, 0x2d, 0x48, 0x45, 0x52, 0x45])).toBe(false);
    // ⚠ AND THE IMAGE IS OTHERWISE UNCHANGED. Equality with the original file is the whole assertion.
    expect(Buffer.from(clean).equals(Buffer.from(real))).toBe(true);
  });
});
