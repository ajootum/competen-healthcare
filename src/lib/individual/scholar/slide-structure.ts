import { normaliseText, openOfficeZip, slidePartNames, type ExtractedPage } from "./extract";
import { VISUAL_DEFAULTS, decorativeReason, isRepeated } from "./material-visuals";
import { scanDeck } from "./material-visuals-io";
import { buildSlideFacts, slideContent, type SlideFacts, type SlideStructure } from "./slide-classify";

// ── READING A STORED PRESENTATION'S STRUCTURE ── SCHOLAR-PPTX-READING-01 ──
// No AI and no writes. The one reading used at upload and when a stored material is checked again, so both reach the same answer.

/**
 * The slide record for a presentation. `withText` says which slides gave native text: at upload from the pages just extracted, on a
 * stored material from the same extraction run again on its stored file. Null when the file cannot be opened: the caller keeps
 * the record it has, and nothing is called blank.
 */
export async function readSlideFacts(bytes: Uint8Array, pages: readonly ExtractedPage[], checkedAt: string): Promise<SlideFacts | null> {
  const z = await openOfficeZip(bytes);
  if (!z.ok) return null;
  try {
    const withText = new Set(pages.filter(p => p.page !== null && normaliseText(p.text)).map(p => p.page as number));
    const parts = slidePartNames(Object.keys(z.zip.files));
    const scan = await scanDeck(bytes);
    const slidesWith = new Map<string, number>();
    for (const p of scan?.pictures ?? []) slidesWith.set(p.media, (slidesWith.get(p.media) ?? 0) + 1);
    const structures: SlideStructure[] = [];
    for (const [i, name] of parts.entries()) {
      const slide = i + 1;
      const xml = await z.zip.file(name)!.async("string");
      const rels = await z.zip.file(name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels")?.async("string");
      const s = slideContent(slide, xml, rels ?? null, withText.has(slide));
      // Measured pictures: logos, bullets and banners are decorative. Unmeasured (the scan failed): every picture counts as content.
      const here = scan?.pictures.filter(p => p.n === slide);
      if (here) {
        const decorative = here.filter(p => decorativeReason(p, VISUAL_DEFAULTS.minPx) !== null || isRepeated(slidesWith.get(p.media) ?? 0, parts.length)).length;
        structures.push({ ...s, pictures: Math.max(0, s.pictures - decorative), decorative });
      } else structures.push(s);
    }
    return buildSlideFacts(structures, withText, checkedAt);
  } catch {
    return null;
  }
}
