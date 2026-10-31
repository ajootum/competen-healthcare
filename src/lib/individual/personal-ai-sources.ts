import { citeChunk } from "./scholar/extract";

// ── SCHOLAR-PAI-RESEARCH-01: THE STUDY PASSAGES, NUMBERED, FOR THE LEARN-STEP PERSONAL AI ────────────────────────────
//
// Route B (/api/individual/scholar/learn/assistant) hands the model the current step's sections. They are numbered
// [S1]..[Sn] -- the tag Learn's own explanations use (generation.ts passageTag) -- so the model can cite what it takes from
// the notes and the learner can see which note it was. Route A (/api/individual/assistant) has no study material and is
// never numbered. Pure; the 6000-character cap on the material is kept, shared out across the sections so that every
// section keeps its tag and a little of its text rather than the last ones being cut off entirely.

export const STUDY_MATERIAL_CAP = 6000;
const MIN_PER_PASSAGE = 200;

export type PersonalAiSource = { tag: string; materialTitle: string; citation: string };
type PassageIn = { materialTitle: string; ordinal: number; pageFrom: number | null; pageTo: number | null; content: string; unit?: "page" | "slide" | "section" };

/** Pure. The numbered material text (capped) and the sources the tags refer to, in tag order. */
export function numberPassages(passages: readonly PassageIn[], cap: number = STUDY_MATERIAL_CAP): { text: string; sources: PersonalAiSource[] } {
  const sources: PersonalAiSource[] = passages.map((p, i) => ({ tag: `S${i + 1}`, materialTitle: p.materialTitle, citation: `${p.materialTitle}, ${citeChunk(p, p.unit)}` }));
  const heads = sources.map(s => `[${s.tag}] (${s.citation})\n`);
  let room = Math.max(0, cap - heads.reduce((n, h) => n + h.length, 0) - 2 * Math.max(0, passages.length - 1));
  const blocks = passages.map((p, i) => {
    const share = Math.max(MIN_PER_PASSAGE, Math.floor(room / (passages.length - i)));
    const body = p.content.length > share ? p.content.slice(0, share).trimEnd() : p.content;
    room = Math.max(0, room - body.length);
    return `${heads[i]}${body}`;
  });
  return { text: blocks.join("\n\n").slice(0, Math.max(cap, 0)), sources };
}

/** Pure. The tags the answer actually cites, in numeric order, each only if it names a real source. */
export function citedSources(answer: string, sources: readonly PersonalAiSource[]): PersonalAiSource[] {
  const used = new Set<string>();
  for (const m of answer.matchAll(/\[S(\d{1,3})\]/g)) used.add(`S${Number(m[1])}`);
  return sources.filter(s => used.has(s.tag));
}

/** Pure. The answer with any [S n] tag that names no real source removed, so a chip never points at nothing. */
export function dropUnknownTags(answer: string, count: number): string {
  return answer.replace(/ ?\[S(\d{1,3})\]/g, (all, n) => (Number(n) >= 1 && Number(n) <= count ? all : ""));
}
