// ── SCHOLAR-ASK-SOURCES-01: WHERE ONE QUESTION LOOKS ── owner GO 5 Nov 2026 ──────────────────────────────────────────────
//
// Pure and client-safe. A learner chooses, for each question, where Ask across your library looks. The choice is the
// request's own: nothing about it is remembered between questions, and it goes back to the learner's materials after each one.
//
//   materials  the learner's uploads, by the existing search. Alone, this is the existing explain route, unchanged.
//   saved      the learner's saved teaching and their own notes on it. Learner-owned, so cited with the materials as [S n].
//   library    approved Competen Library entries (the recovery tier's source). External to the learner, listed as they stand and
//              never given to the model: they are competency titles and outcomes, not teaching text. Offered only to a learner
//              who can reach some: it matches their programme's catalogue, or HQ's reference collections.
//   research   the Research & Evidence Engine. External. Keywords from the question leave Competen, never the notes. Cited [E n].
//   web        named for the record only and NEVER offered: Ask has no web path. Scholar's web research is the examination
//              tool (exam-research.ts), off in production, and turning it on is an owner decision (processor, cost, funding).

export const ASK_SOURCES = ["materials", "saved", "library", "research", "web"] as const;
export type AskSource = (typeof ASK_SOURCES)[number];

export const ASK_SOURCE_LABEL: Record<AskSource, string> = {
  materials: "My learning materials", saved: "My saved learning", library: "Competen Library", research: "Research literature", web: "Web sources",
};
export const DEFAULT_ASK_SOURCES: readonly AskSource[] = ["materials"];

/** Said beside the choice whenever research is chosen. */
export const RESEARCH_LEAVES = "Keywords from your question are sent to the research sources. Your notes are not.";

/** Pure. A request's sources: known ones, once each, in the fixed order. Anything else is ignored. */
export function parseAskSources(raw: unknown): AskSource[] {
  if (!Array.isArray(raw)) return [];
  return ASK_SOURCES.filter(s => raw.includes(s));
}

/** Pure. Materials alone is the default path, which the existing explain route serves. */
export const isDefaultSources = (s: readonly AskSource[]): boolean => s.length === 1 && s[0] === "materials";

export type AskOfferInput = {
  savedReady: boolean; sourceModes: readonly string[]; researchOperational: boolean;
  /** This learner can reach approved library content (evidence-recovery askLibraryReady). Without it the source could only ever find nothing. */
  libraryReady: boolean;
};

/** Pure. What is offered now. Only what can run: a source that cannot is not shown at all. Web is never offered (see above). */
export function offeredAskSources(i: AskOfferInput): AskSource[] {
  return [
    "materials",
    ...(i.savedReady ? ["saved" as const] : []),
    ...(i.sourceModes.includes("library") && i.libraryReady ? ["library" as const] : []),
    ...(i.sourceModes.includes("research") && i.researchOperational ? ["research" as const] : []),
  ];
}

/** Pure. Turn one source on or off. The last one stays on: a question has to look somewhere. */
export function toggleAskSource(selected: readonly AskSource[], s: AskSource): AskSource[] {
  if (!selected.includes(s)) return ASK_SOURCES.filter(x => x === s || selected.includes(x));
  return selected.length > 1 ? selected.filter(x => x !== s) : [...selected];
}

/** What happened to one chosen source for this question. Reported for every source chosen, so the learner sees what was actually searched. */
export type SearchedState = "used" | "listed" | "no_match" | "found_only" | "withheld" | "not_run";
export type Searched = { source: AskSource; state: SearchedState; count: number; note: string | null };

const STATE_WORDS: Record<SearchedState, string> = {
  used: "searched and used", listed: "searched, matching entries listed", no_match: "searched, nothing matched", found_only: "searched, sources found but none read",
  withheld: "searched, but that part was not shown", not_run: "not searched",
};
/** Pure. One source's line under the answer. */
export const searchedLine = (s: Searched): string => `${ASK_SOURCE_LABEL[s.source]}: ${STATE_WORDS[s.state]}${s.note ? ` (${s.note})` : ""}`;

const RESEARCH_NOT_RUN: Record<string, string> = {
  off: "research is not available at the moment", refused: "the question looks like it identifies a patient, or has no topic to search",
  limit: "today's research allowance is used", failed: "the research sources could not be reached",
};

/** Pure. How the research source went. Found is not read: only an abstract the engine verified is evidence, and Scholar never reads full text. */
export function researchSearched(r: { state: string; evidence: number; items: number; shown: boolean; withheld: boolean }): Searched {
  const base = { source: "research" as const, count: r.evidence };
  if (RESEARCH_NOT_RUN[r.state]) return { ...base, state: "not_run", note: RESEARCH_NOT_RUN[r.state] };
  if (r.shown) return { ...base, state: "used", note: "abstracts only, full text not read" };
  if (r.withheld) return { ...base, state: "withheld", note: null };
  return r.items > 0 ? { ...base, state: "found_only", note: null } : { ...base, state: "no_match", note: null };
}

/** Pure. How Competen Library went: its entries are listed, never written from. */
export function libraryListed(failed: boolean, found: number): Searched {
  if (failed) return { source: "library", state: "not_run", count: 0, note: "it could not be read just now" };
  return { source: "library", state: found ? "listed" : "no_match", count: found, note: null };
}

/** Pure. How a source inside Competen went. */
export function internalSearched(source: AskSource, r: { failed: boolean; found: number; shown: boolean; withheld: boolean }): Searched {
  if (r.failed) return { source, state: "not_run", count: 0, note: "it could not be read just now" };
  if (!r.found) return { source, state: "no_match", count: 0, note: null };
  if (r.shown) return { source, state: "used", count: r.found, note: null };
  return { source, state: r.withheld ? "withheld" : "no_match", count: r.found, note: null };
}
