/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CompetencyRef, EvidenceRef } from "./competency-store";

// ── THE C5 BOUNDARY, READ SIDE ── COMPETEN-PROFESSIONAL-COMPETENCY-01 C5 (Verification Studio, COMPETEN-IND-007) ─────
//
// Stage 5 never writes a verification request, an assessor, a decision or an expiry: the Verification Studio owns them
// (migrations 510-519) and enforces their integrity in the database. Professional only HANDS a request its competency
// and evidence references (competency-store evidenceForVerification) and READS decisions back, through the Studio's
// own exported functions. Until the Studio is present this adapter answers "not provisioned", and every page says
// verification is not available yet, rather than showing an empty list that reads like "never verified".

/** The kind of outcome, fixed by C5. The CODE is per-method configuration ("verified_at_level"), so no rule reads it. */
export type OutcomeClass = "verified" | "partial" | "further_evidence" | "not_demonstrated" | "unable_to_determine";
export type Standing = "current" | "expired" | "revoked" | "superseded" | "not_a_verification";

export type VerificationDecision = {
  outcomeCode: string; outcomeClass: OutcomeClass | null; standing?: Standing; outcomeLabel: string; level: string | null; assessorName: string; authority: string; criteriaVersion: string | null;
  decidedAt: string; validUntil: string | null; revokedAt: string | null; supersededBy: string | null;
};
export type VerificationSummary = {
  requestId: string; status: string; competency: CompetencyRef; method: string | null; requestedAt: string; evidence: EvidenceRef[]; decisions: VerificationDecision[];
};
export type VerificationRead = { provisioned: false } | { provisioned: true; items: VerificationSummary[] | null };

type Studio = {
  listVerifications: (admin: any, userId: string, f: { frameworkCompetencyId?: string }) => Promise<VerificationRead>;
  requestVerification: (admin: any, userId: string, r: { competency: CompetencyRef; evidence: EvidenceRef[]; methodCode?: string; note?: string }) => Promise<{ ok: true; requestId: string } | { ok: false; status: number; error: string }>;
};

/** The Studio, once present. Registered by its own module (see registerVerificationStudio), never imported here. */
let studio: Studio | null = null;
export function registerVerificationStudio(s: Studio) { studio = s; }

/** A decision that stands now as a verification outcome (verified or partial): C5's own standing when it gives one, else
 *  not revoked, superseded or expired. A decision without a class never stands. */
export const currentDecision = (d: VerificationDecision, today: string) =>
  (d.outcomeClass === "verified" || d.outcomeClass === "partial")
  && (d.standing ? d.standing === "current" : !d.revokedAt && !d.supersededBy && (!d.validUntil || d.validUntil >= today));

/** THE rule for "independently verified" (agreed with C5): current, of class verified, at a level. Never the outcome code. */
export const verifiedNow = (d: VerificationDecision, today: string) => currentDecision(d, today) && d.outcomeClass === "verified" && !!d.level;

export async function loadVerifications(admin: any, userId: string, frameworkCompetencyId?: string): Promise<VerificationRead> {
  if (!studio) return { provisioned: false };
  try { return await studio.listVerifications(admin, userId, { frameworkCompetencyId }); } catch { return { provisioned: true, items: null }; }
}

export async function requestVerification(admin: any, userId: string, r: { competency: CompetencyRef; evidence: EvidenceRef[]; methodCode?: string; note?: string }) {
  if (!studio) return { ok: false as const, status: 409, error: "Independent verification is not available yet." };
  return studio.requestVerification(admin, userId, r);
}
