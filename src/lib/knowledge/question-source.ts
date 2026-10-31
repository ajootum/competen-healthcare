// ── SOURCE RIGHTS ON LIBRARY QUESTIONS ── SQIE-COMPLETE-01 (owner GO 31 Oct 2026) ────────────────────────────────────────
//
// Stored as an optional `source` key INSIDE the version's content jsonb (revision_question only). No migration: 442's
// ckri_knowledge_content_ok checks only the keys it names, so an extra key is accepted, and because the content hash is
// md5(content::text) the declared source is part of what the independent clinical reviewer approves (an edit to the source
// clears educator review and invalidates earlier approvals, exactly like an edit to the stem). Scholar's learner copy
// (store.ts insertLibraryCopies) reads stem, options, correct_index and rationale only, so the key is invisible to learners.
//
// kinds
//   own_writing        the educator wrote it. No further field. (A question with NO source key is read the same way and
//                      shown as "not declared"; it can still be published, because every version before this change has none.)
//   governed_reference drawn from a governed reference (a CFCA or CKRI entry, a guideline Competen holds under licence):
//                      `reference` is required.
//   open_licence       adapted from an openly licensed work: `reference` and `licence` are required, and the licence must be
//                      one that permits reuse in a commercial product (CC0, CC BY, CC BY-SA, public domain, OGL, ...). NC,
//                      ND and unknown licences are refused at SUBMIT and again at PUBLISH.
//   permission         used with the rights holder's written permission: `reference` and `permissionNote` are required.
//
// ⚠ THIS IS THE APPLICATION LAYER ONLY. The database enforces review independence and the exact-content approval; it does
// not know about rights. publishVersion (educator.ts) calls sourceRefusal before the RPC.

export const SOURCE_KINDS = ["own_writing", "governed_reference", "open_licence", "permission"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  own_writing: "Own writing", governed_reference: "Governed reference", open_licence: "Open licence", permission: "Permission of the rights holder",
};

export type QuestionSource = { kind: SourceKind; reference?: string; licence?: string; permissionNote?: string };

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Pure. A licence that permits reuse in a commercial learning product. Anything unrecognised is not on the list. */
const REUSE_LICENCE = /^(cc0(?:[ -]1\.0)?|public[ -]domain|cc[ -]by(?:[ -]sa)?(?:[ -]\d\.\d)?|open[ -]government[ -]licen[cs]e(?:[ -]v?\d(?:\.\d)?)?|ogl(?:[ -]v?\d(?:\.\d)?)?|mit|apache[ -]2\.0)$/i;
const NC_OR_ND = /(^|[^a-z])(nc|nd)([^a-z]|$)|non[ -]?commercial|no[ -]?deriv/i;
export function licenceAllowed(licence: string | undefined): boolean {
  const l = (licence ?? "").trim().replace(/\s+/g, " ");
  return !!l && !NC_OR_ND.test(l) && REUSE_LICENCE.test(l);
}

/** Pure. The source normalised from form fields or stored content. null when none is declared (or the kind is not one of ours). */
export function normaliseSource(raw: unknown): QuestionSource | null {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (!(SOURCE_KINDS as readonly string[]).includes(s.kind as string)) return null;
  const kind = s.kind as SourceKind;
  if (kind === "own_writing") return { kind };
  const out: QuestionSource = { kind, reference: clip(s.reference, 500) };
  if (kind === "open_licence") out.licence = clip(s.licence, 80);
  if (kind === "permission") out.permissionNote = clip(s.permissionNote, 1000);
  return out;
}

/** Pure. The declared source of a stored version's content, or null (not declared). */
export const sourceOf = (content: unknown): QuestionSource | null => normaliseSource((content as Record<string, unknown> | null)?.source);

/**
 * Pure. The plain reason a declared source cannot be submitted or published, or null when it can. A question with no
 * source declared passes (legacy); one that declares material from a source must be complete and reusable.
 */
export function sourceRefusal(content: unknown): string | null {
  const raw = (content as Record<string, unknown> | null)?.source;
  if (raw === undefined || raw === null) return null;
  const s = normaliseSource(raw);
  if (!s) return "The source is not one of: own writing, governed reference, open licence, permission.";
  if (s.kind === "own_writing") return null;
  if (!s.reference) return "This question includes material from a source: name the source (a citation or a link).";
  if (s.kind === "open_licence") {
    if (!s.licence) return "This question is adapted from an openly licensed work: name the licence.";
    if (!licenceAllowed(s.licence)) return `The licence "${s.licence}" does not allow this question to be published. Non-commercial, no-derivatives and unrecognised licences are refused. Use CC0, CC BY, CC BY-SA, public domain or an open government licence, or get permission.`;
  }
  if (s.kind === "permission" && !s.permissionNote) return "Record the permission: who gave it, and when.";
  return null;
}

/** Pure. A citation-like pattern in the text (a link, a DOI, a copyright mark, "et al"). A prompt to declare a source, never a block. */
export const looksCited = (text: string) => /https?:\/\/|\bdoi:|\b10\.\d{4,}\/|©|\(c\)\s*\d{4}|\bet al\b/i.test(text ?? "");
