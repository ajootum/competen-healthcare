import { findPatientIdentifiers } from "./extract";
import { groundingViolations, parseJsonArray } from "./generation";
import { searchTerms } from "./retrieval";
import type { CatalogueCompetency, Layer } from "./catalogue";

// ── CONCEPTS AND PROPOSED COMPETENCY MAPPINGS ── COMPETEN-SCHOLAR-01 S2, migration 388 ────────────────────
//
// The pure half. The model reads a few sections of the person's own notes and the competencies of their
// programme, and says which concepts each section covers and which competencies it PROPOSES each section
// supports. Nothing here is a fact about the person's competence. A mapping is a proposal until the
// person accepts or rejects it, and the decision is a new row (388's append-only trail), never an edit.
//
// ⚠ THE MODEL NEVER WRITES AN ID. Competencies are shown to it as tags [C1], [C2] ... and a section as
// [S1] ... A tag outside the list given is dropped, so a mapping can only ever point at a competency of the
// person's own programme that the catalogue offered -- never at an invented or hallucinated uuid.
//
// ⚠ A CONCEPT MUST BE IN THE SECTION. Every content word of a concept must appear in that section's text
// (by prefix, so "infarct" finds "infarction"). A concept the notes do not mention is dropped, not shown.
// A rationale that adds a number, month or clinical finding the section and competency do not contain is
// removed (the proposal stays, without its reason). Identifier-shaped text is dropped outright.

/** Sections analysed in one AI call. */
export const ANALYSE_SECTIONS_PER_CALL = 6;
/** Competencies shown to the model at once. A larger programme is shortlisted by overlap with the text. */
export const SHORTLIST_LIMIT = 60;
export const MAX_PROPOSALS_PER_SECTION = 4;
export const MAX_CONCEPTS_PER_SECTION = 12;
/** A proposal below this confidence is not stored -- too weak to put in front of a student. */
export const MIN_CONFIDENCE = 0.3;

export type AnalysisSection = { chunkId: string; content: string };

export type MapProposal = { competencyId: string; layer: Layer; confidence: number; rationale: string | null };
export type SectionAnalysis = { chunkId: string; concepts: string[]; proposals: MapProposal[] };
export type AnalysisDrop = { reason: "malformed" | "unknown_section" | "unknown_competency" | "low_confidence" | "concept_not_in_section" | "identifier" | "rationale_ungrounded" | "over_limit" };
export type AnalysisCheck = { sections: SectionAnalysis[]; dropped: AnalysisDrop[] };

export const competencyTag = (i: number) => `C${i + 1}`;
export const sectionTag = (i: number) => `S${i + 1}`;

/** Pure. The competencies worth showing the model for these sections: all of them, or the best-overlapping. */
export function shortlist(sections: AnalysisSection[], competencies: CatalogueCompetency[], limit = SHORTLIST_LIMIT): CatalogueCompetency[] {
  if (competencies.length <= limit) return competencies;
  const words = new Set(sections.flatMap(s => searchTerms(s.content.slice(0, 4000)).map(t => t.slice(0, 5))));
  const scored = competencies.map((c, i) => {
    const terms = searchTerms(`${c.title} ${c.outcomes.join(" ")}`).map(t => t.slice(0, 5));
    return { c, i, hits: terms.filter(t => words.has(t)).length };
  });
  scored.sort((a, b) => b.hits - a.hits || a.i - b.i);
  return scored.slice(0, limit).sort((a, b) => a.i - b.i).map(s => s.c);
}

export const MAP_SYSTEM = [
  "You help a healthcare student organise their OWN study notes against the competencies of their programme.",
  "You are given numbered competencies, tagged [C1], [C2] and so on, and numbered sections of the student's notes, tagged [S1], [S2] and so on.",
  "",
  "For EACH section:",
  `1. concepts: up to ${MAX_CONCEPTS_PER_SECTION} key concepts the section actually covers, each a short noun phrase using the section's own words. Never a concept the section does not mention.`,
  `2. competencies: up to ${MAX_PROPOSALS_PER_SECTION} competencies the section would help the student learn, using ONLY the tags you were given. Several are fine, across layers. None is fine if nothing fits.`,
  "   confidence is a number from 0 to 1: how directly the section supports that competency.",
  "   rationale is ONE short sentence, in the section's own terms, saying why. Do not add any number, dose, value or finding the section does not contain.",
  "3. Never include a name, NHS number, date of birth or anything that could identify a real person.",
  "",
  'Reply with JSON ONLY, no prose and no code fence: [{"section": "S1", "concepts": ["..."], "competencies": [{"tag": "C3", "confidence": 0.8, "rationale": "..."}]}]',
].join("\n");

export function mapUserPrompt(sections: AnalysisSection[], competencies: CatalogueCompetency[]): string {
  const comps = competencies.map((c, i) => {
    const out = c.outcomes.length ? ` -- ${c.outcomes.slice(0, 3).join("; ")}` : "";
    return `[${competencyTag(i)}] (${c.layer}) ${c.code ? `${c.code} ` : ""}${c.title}${out}`;
  });
  const secs = sections.map((s, i) => `[${sectionTag(i)}]\n${s.content}`);
  return `COMPETENCIES:\n${comps.join("\n")}\n\nSECTIONS OF MY NOTES:\n\n${secs.join("\n\n")}`;
}

const contentWords = (s: string) => s.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/).filter(w => w.length >= 4);

/** Pure. Every content word of the concept appears (by prefix) in the section. */
export function conceptInSection(concept: string, section: string): boolean {
  const have = contentWords(section);
  const need = contentWords(concept);
  if (!need.length) return false;
  return need.every(w => { const p = w.slice(0, Math.min(5, w.length)); return have.some(h => h.startsWith(p)); });
}

/** Pure. Model reply → what may be stored, and why everything else was not. */
export function checkAnalysis(raw: string, sections: AnalysisSection[], competencies: CatalogueCompetency[]): AnalysisCheck {
  const out: AnalysisCheck = { sections: [], dropped: [] };
  const arr = parseJsonArray(raw);
  if (!arr) { out.dropped.push({ reason: "malformed" }); return out; }
  const seen = new Set<string>();
  for (const item of arr) {
    const r = item as Record<string, unknown>;
    const sm = typeof r?.section === "string" ? /^\[?S(\d+)\]?$/i.exec(r.section.trim()) : null;
    const si = sm ? Number(sm[1]) - 1 : -1;
    if (si < 0 || si >= sections.length) { out.dropped.push({ reason: "unknown_section" }); continue; }
    const section = sections[si];
    if (seen.has(section.chunkId)) { out.dropped.push({ reason: "malformed" }); continue; }
    seen.add(section.chunkId);

    const concepts: string[] = [];
    for (const c of Array.isArray(r.concepts) ? r.concepts : []) {
      const t = typeof c === "string" ? c.replace(/\s+/g, " ").trim() : "";
      if (t.length < 2 || t.length > 80) { out.dropped.push({ reason: "malformed" }); continue; }
      if (findPatientIdentifiers(t).length) { out.dropped.push({ reason: "identifier" }); continue; }
      if (!conceptInSection(t, section.content)) { out.dropped.push({ reason: "concept_not_in_section" }); continue; }
      if (concepts.some(x => x.toLowerCase() === t.toLowerCase())) continue;
      if (concepts.length >= MAX_CONCEPTS_PER_SECTION) { out.dropped.push({ reason: "over_limit" }); continue; }
      concepts.push(t);
    }

    const proposals: MapProposal[] = [];
    for (const p of Array.isArray(r.competencies) ? r.competencies : []) {
      const q = p as Record<string, unknown>;
      const cm = typeof q?.tag === "string" ? /^\[?C(\d+)\]?$/i.exec(q.tag.trim()) : null;
      const ci = cm ? Number(cm[1]) - 1 : -1;
      if (ci < 0 || ci >= competencies.length) { out.dropped.push({ reason: "unknown_competency" }); continue; }
      const comp = competencies[ci];
      const conf = typeof q.confidence === "number" && Number.isFinite(q.confidence) ? Math.round(Math.min(1, Math.max(0, q.confidence)) * 100) / 100 : NaN;
      if (Number.isNaN(conf)) { out.dropped.push({ reason: "malformed" }); continue; }
      if (conf < MIN_CONFIDENCE) { out.dropped.push({ reason: "low_confidence" }); continue; }
      if (proposals.some(x => x.competencyId === comp.id)) continue;
      if (proposals.length >= MAX_PROPOSALS_PER_SECTION) { out.dropped.push({ reason: "over_limit" }); continue; }
      let rationale = typeof q.rationale === "string" ? q.rationale.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      if (rationale && findPatientIdentifiers(rationale).length) { out.dropped.push({ reason: "identifier" }); rationale = ""; }
      if (rationale && groundingViolations(rationale, [section.content, comp.title, ...comp.outcomes]).length) {
        out.dropped.push({ reason: "rationale_ungrounded" });
        rationale = "";
      }
      proposals.push({ competencyId: comp.id, layer: comp.layer, confidence: conf, rationale: rationale || null });
    }
    proposals.sort((a, b) => b.confidence - a.confidence);
    out.sections.push({ chunkId: section.chunkId, concepts, proposals });
  }
  return out;
}

// ── THE STATE OF A MAPPING ── its latest decision, or proposed ───────────────────────────────────────

export type MapState = "proposed" | "accepted" | "rejected";
export type MapSource = "ai" | "student" | "reviewer";
export type DecisionRow = { mapId: string; decision: "accepted" | "rejected"; decidedBy: "student" | "reviewer"; createdAt: string };

/** Pure. The latest decision for each mapping. No decision is "proposed". Ties go to the later row in input. */
export function mapStates(decisions: DecisionRow[]): Map<string, { state: MapState; decidedBy: DecisionRow["decidedBy"]; at: string; history: number }> {
  const out = new Map<string, { state: MapState; decidedBy: DecisionRow["decidedBy"]; at: string; history: number }>();
  for (const d of decisions) {
    const prev = out.get(d.mapId);
    const history = (prev?.history ?? 0) + 1;
    if (!prev || d.createdAt >= prev.at) out.set(d.mapId, { state: d.decision, decidedBy: d.decidedBy, at: d.createdAt, history });
    else out.set(d.mapId, { ...prev, history });
  }
  return out;
}

export type ChunkMapping = { id: string; competencyId: string; source: MapSource; confidence: number | null; state: MapState };

/**
 * Pure. The competency a question from this section practises: an accepted mapping first, then a
 * proposed one, by confidence (a person's own mapping counts as certain). A rejected mapping never.
 * Null when the section maps to nothing -- the question is then simply not tied to a competency.
 */
export function primaryCompetency(mappings: ChunkMapping[]): string | null {
  const rank = (m: ChunkMapping) => (m.state === "accepted" ? 2 : 1) * 10 + (m.source === "ai" ? (m.confidence ?? 0) : 1);
  const live = mappings.filter(m => m.state !== "rejected").sort((a, b) => rank(b) - rank(a));
  return live[0]?.competencyId ?? null;
}
