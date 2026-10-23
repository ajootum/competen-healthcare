import drafts from "./interim-drafts.json";

// THE PUBLISHED LEGAL DOCUMENTS -- COMPETEN-LEGAL-001 s4 URL structure, owner instruction 2026-10-23.
//
// ⚠ THESE ARE THE OWNER'S DRAFTS, PUBLISHED AS-IS FOR THE INTERNAL STAFF PILOT. The text is the owner's
// file "COMPETEN HOLDINGS and INDIVIDUAL.docx" converted word for word into interim-drafts.json; nothing
// here writes, edits or completes legal text, and the bracketed placeholders are left exactly as drafted.
// Every page says the documents are drafts under legal review and apply to the internal staff pilot only.
//
// ONE UMBRELLA (owner 2026-10-23): Scholar and Professional are both Competen Individual, so the Terms set
// is the Holdings Platform Terms plus the Individual Terms, and the Privacy set is the two Notices. Both
// operating entities in src/lib/individual/legal.ts point at the same set through INDIVIDUAL_LEGAL_*.
//
// A VERSION IS PERMANENT. /legal/<kind>/<version> keeps serving that exact text after a newer version is
// published, because that is the URL stored with a person's acceptance. Publishing counsel's final text
// means adding a new version here and moving CURRENT to it; the old entry stays.

export type LegalBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };
export type LegalSection = { heading: string; blocks: LegalBlock[] };
export type LegalDraft = { key: string; kind: LegalKind; title: string; preamble: string[]; sections: LegalSection[] };
export type LegalKind = "terms" | "privacy";

export type LegalVersion = {
  version: string;
  published: string;
  status: string;
  documents: Record<LegalKind, LegalDraft[]>;
};

const ALL = drafts as LegalDraft[];
const byKind = (kind: LegalKind) => ALL.filter(d => d.kind === kind);

export const LEGAL_VERSIONS: LegalVersion[] = [
  {
    version: "draft-2026-10-23",
    published: "23 October 2026",
    status: "Draft under legal review. Applies to the internal staff pilot only.",
    documents: { terms: byKind("terms"), privacy: byKind("privacy") },
  },
];

export const CURRENT_LEGAL_VERSION = LEGAL_VERSIONS[LEGAL_VERSIONS.length - 1];

export const LEGAL_KIND_LABEL: Record<LegalKind, string> = { terms: "Terms of Use", privacy: "Privacy Notice" };

export function isLegalKind(k: string): k is LegalKind { return k === "terms" || k === "privacy"; }

export function legalVersion(version: string): LegalVersion | null {
  return LEGAL_VERSIONS.find(v => v.version === version) ?? null;
}

/** The permanent URL path of one kind at one version -- what INDIVIDUAL_LEGAL_*_URL should hold. */
export const legalPath = (kind: LegalKind, version: string) => `/legal/${kind}/${version}`;
