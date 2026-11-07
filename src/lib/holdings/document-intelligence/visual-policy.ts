import type { VisualClass } from "./canonical";

// ── WHICH FORM OF A PICTURE ── COMPETEN-DIG-001 s3, PHASE 1 ───────────────────────────────────────────────────────────────
//
// Pure. A program looking at a picture's size and bytes cannot tell an ECG from a stock photograph, so nothing here tries to.
// Scholar is a clinical product: a picture counts as clinical until something says otherwise, and only two things can:
//
//   decorative   the existing rule (material-visuals.decorativeReason, isRepeated): an icon, a banner, a logo on many slides. Not shown in lessons.
//   general      a person with the authority said so (HQ, for content it owns). No automatic path, and no AI classification by default.
//
// A clinical or unknown picture is only ever losslessly re-encoded or, for a smaller screen, made smaller without any lossy step, with the
// original one tap away. A representation is only made when a smaller one would actually save something.

export const DISPLAY_WIDTHS = [480, 800, 1280] as const;
/** Formats a lossless WebP can often hold in fewer bytes with every pixel the same. A JPEG cannot: it grows. */
const REPACK = new Set(["png", "bmp", "tiff"]);
/** Not worth a second stored object for a saving under this. */
export const MIN_SAVING = 0.2;

export type PicturePlan = { display: { width: number; lossless: boolean; quality: number | null }[]; keepOriginalInSource: boolean };

/** Pure. The display forms a picture may have. `width` null: its size is unknown, so it is shown as it is. */
export function picturePlan(input: { class: VisualClass; width: number | null; format?: string }): PicturePlan {
  if (input.class === "decorative" || input.width === null) return { display: [], keepOriginalInSource: true };
  const lossless = input.class !== "general";
  const display = DISPLAY_WIDTHS.filter(w => w < input.width!).map(width => ({ width, lossless, quality: lossless ? null : 80 }));
  if (input.format && REPACK.has(input.format) && lossless) display.push({ width: input.width!, lossless, quality: null });
  return { display, keepOriginalInSource: true };
}

/** Pure. Keep a representation only when it is smaller than what it replaces by enough to justify storing it. */
export const worthKeeping = (bytes: number, originalBytes: number) => bytes <= originalBytes * (1 - MIN_SAVING);

/** Pure. Which stored form to send for a slot `cssWidth` wide on a screen of `dpr`: the smallest that still fills it. */
export function chooseRepresentation<T extends { width: number | null; bytes: number }>(options: readonly T[], cssWidth: number, dpr: number): T | null {
  const need = Math.ceil(cssWidth * dpr);
  const known = options.filter(o => o.width !== null).sort((a, b) => a.width! - b.width!);
  return known.find(o => o.width! >= need) ?? known[known.length - 1] ?? options[0] ?? null;
}
