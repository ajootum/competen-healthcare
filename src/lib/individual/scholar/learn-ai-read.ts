// ── SCHOLAR-LEARN-GAPS-02 item 5: THE AI-READ MARK ON A LEARN SOURCE ─────────────────────────────────────────────────────
//
// Pure, no AI. A section whose text was read from a slide or page PICTURE by AI (extract.ts aiReadSlides over the material's
// extraction_quality) carries `aiRead: true` and the existing aiReadLabel wording in the Learn act/open response sources.
// Server-side only (extract.ts pulls in the document readers): the browser receives the finished note.

import { aiReadLabel, aiReadSlides, type ExtractionQuality } from "./extract";

type Cited = { materialId: string; pageFrom: number | null; pageTo: number | null; unit?: "page" | "slide" | "section" };
export type AiReadMark = { aiRead: true; aiReadNote: string } | Record<string, never>;

const MAX_SPAN = 60;

/** Pure. The units a section spans, from pageFrom to pageTo (bounded). */
function unitsOf(p: Pick<Cited, "pageFrom" | "pageTo">): number[] {
  if (p.pageFrom === null) return [];
  const to = p.pageTo !== null && p.pageTo >= p.pageFrom ? Math.min(p.pageTo, p.pageFrom + MAX_SPAN) : p.pageFrom;
  return Array.from({ length: to - p.pageFrom + 1 }, (_, i) => (p.pageFrom as number) + i);
}

/** Pure. The mark for one section given its material's AI-read units: the flag and the shared label, or {} (spread into a source). */
export function aiReadMark(read: ReadonlySet<number> | undefined, p: Cited): AiReadMark {
  if (!read?.size || (p.unit ?? "page") === "section") return {};
  const hit = unitsOf(p).find(u => read.has(u));
  return hit === undefined ? {} : { aiRead: true, aiReadNote: aiReadLabel(p.unit === "slide" ? "slide" : "page", hit) };
}

/** Pure. materialId -> the units read by AI, from the extraction quality of each (materials with none are left out). */
export function aiReadByMaterial(quality: ReadonlyMap<string, ExtractionQuality | null>): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const [id, q] of quality) { const s = aiReadSlides(q); if (s.size) out.set(id, s); }
  return out;
}
