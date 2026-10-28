import type { ResearchItem } from "./providers";

// ── THE COMMON EVIDENCE MODEL ── COMPETEN-RESEARCH-01 ADDENDUM V2 item 6 ───────────────────────────────────────────────
//
// One vendor-neutral record per piece of evidence, whichever source it came from. Two halves that never mix:
//   `verified`        copied from a provider response and checked (identity, dates, provenance). Never written by AI.
//   `interpretation`  what an AI step later reads into it (population, findings, limitations ...), always labelled as AI
//                     interpretation. Phase 1 has no such step, so it is null: nothing is inferred and nothing is claimed.
// An abstract is an abstract (`abstract`), never full text; `fullTextRefs` holds only links to full text the licence
// permits, and nothing is fetched from them.

export type EvidenceRecord = {
  question: string | null;
  query: string;
  strategy: string;
  verified: {
    provider: string;
    sourceId: string;
    source: string | null;
    title: string;
    authors: string[];
    year: number | null;
    doi: string | null;
    pmid: string | null;
    url: string;
    abstract: string | null;
    fullTextRefs: string[];
    evidenceType: string | null;
    identity: { pmid: boolean; doi: boolean | null };
    retrievedAt: string;
    sourceVersion: string;
    licensing: string;
    reuse: "private_evidence_excerpt_only" | "metadata_only";
  };
  interpretation: null | {
    label: string; population: string | null; setting: string | null; findings: string | null; limitations: string | null;
    relevance: string | null; clinicalApplicability: string | null; conflicts: string | null;
  };
};

/** Pure. A provider item as an evidence record. `sourceVersion` is the registry record's version it was retrieved under. */
export function toEvidenceRecord(i: ResearchItem, ctx: { question: string | null; query: string; strategy: string; sourceVersion: string; licensing: string }): EvidenceRecord {
  return {
    question: ctx.question, query: ctx.query, strategy: ctx.strategy,
    verified: {
      provider: i.provider, sourceId: i.sourceId, source: i.journal, title: i.title, authors: i.authors, year: i.year, doi: i.doi, pmid: i.pmid, url: i.url,
      abstract: i.abstract, fullTextRefs: [], evidenceType: null, identity: i.verified, retrievedAt: i.retrievedAt, sourceVersion: ctx.sourceVersion, licensing: ctx.licensing,
      reuse: i.abstract ? "private_evidence_excerpt_only" : "metadata_only",
    },
    interpretation: null,
  };
}
