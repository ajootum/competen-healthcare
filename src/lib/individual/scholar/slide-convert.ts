// ── CONVERTING A SLIDE PICTURE TO PNG ── SCHOLAR-SLIDE-IMAGES-TIFF-01 ────────────────────────────────────────────
//
// TIFF, BMP, GIF and WebP pictures cannot be put in the PDF the transcription runner reads, so they are converted to
// PNG first: first page / frame only, rotated by their own orientation, scaled to fit 2000 x 2000 (never enlarged),
// flattened onto white. Never throws: a picture sharp cannot read is simply not used (the caller reports it as
// unsupported). Input over MAX_CONVERT_INPUT_BYTES is not attempted.

/** The largest single picture that is converted; extract.ts reports a larger one as too large. */
export const MAX_CONVERT_INPUT_BYTES = 15 * 1024 * 1024;
export const CONVERT_MAX_DIMENSION = 2000;

/** The picture as PNG bytes, or null when it cannot be converted (sharp missing, unreadable or corrupt picture). */
export async function convertToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.byteLength > MAX_CONVERT_INPUT_BYTES) return null;
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes, { page: 0, pages: 1, limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: CONVERT_MAX_DIMENSION, height: CONVERT_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}
