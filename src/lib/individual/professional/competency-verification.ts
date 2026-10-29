/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CompetencyRef, EvidenceRef } from "./competency-store";
import * as c5 from "@/lib/competency/verification";
import { NOT_A_DECLARATION, STANDING_LABEL, STATE_LABEL, isAssessorEvidence, type EvidenceKind, type RequestState } from "@/lib/competency/verification-config";

// ── THE C5 BOUNDARY, READ SIDE ── COMPETEN-PROFESSIONAL-COMPETENCY-01 C5 (Verification Studio, COMPETEN-IND-007) ─────
//
// Stage 5 never writes a verification request, an assessor, a decision or an expiry: the Verification Studio owns them
// (migrations 510-519) and enforces their integrity in the database. Professional only HANDS a request its competency
// and evidence references (competency-store evidenceForVerification) and READS decisions back, through the Studio's
// own exported functions. Until the Studio is present this adapter answers "not provisioned", and every page says
// verification is not available yet, rather than showing an empty list that reads like "never verified".

/** The kind of outcome, fixed by C5. The CODE is per-method configuration ("verified_at_level"), so no rule reads it. */
export type OutcomeClass = "verified" | "partial" | "further_evidence" | "not_demonstrated" | "unable_to_determine";
export type Standing = "current" | "expired" | "revoked" | "superseded" | "awaiting_confirmation" | "not_confirmed" | "not_a_verification";

export type VerificationDecision = {
  outcomeCode: string; outcomeClass: OutcomeClass | null; standing?: Standing; outcomeLabel: string; level: string | null; assessorName: string; authority: string; criteriaVersion: string | null;
  decidedAt: string; validUntil: string | null; revokedAt: string | null; supersededBy: string | null;
  /** 690: the stage at decision (published mapping), and the second assessor confirmation where the method needs one. */
  decisionId?: string; stage?: string | null; confirmation?: "awaiting" | "confirmed" | "not_confirmed" | null;
};
export type VerificationSummary = {
  requestId: string; status: string; statusLabel?: string; competency: CompetencyRef; method: string | null; requestedAt: string; evidence: EvidenceRef[]; decisions: VerificationDecision[];
  /** 690: a programme lead asked for it, and what the latest outcome leaves to develop (offered to the person, never written). */
  requestedByOther?: boolean; developmentNeed?: { reason: string; detail: string[]; decidedAt: string } | null;
};
export type VerificationRead = { provisioned: false } | { provisioned: true; items: VerificationSummary[] | null };

type Studio = {
  listVerifications: (admin: any, userId: string, f: { frameworkCompetencyId?: string }) => Promise<VerificationRead>;
  requestVerification: (admin: any, userId: string, r: { competency: CompetencyRef; evidence: EvidenceRef[]; methodCode?: string; note?: string; renewsDecisionId?: string }) => Promise<{ ok: true; requestId: string } | { ok: false; status: number; error: string }>;
};

/** The Studio (COMPETEN-IND-007), adapted at the foot of this file. Its own readiness check answers "not provisioned"
 *  where 510/511 are absent. registerVerificationStudio replaces it in tests. */
let studio: Studio | null = c5Studio();
export function registerVerificationStudio(s: Studio) { studio = s; }

// 690: validity, reassessment and stage, decided here so no Professional page names an outcome class (harness E6).
const lapsedOn = (d: VerificationDecision, today: string) => d.standing === "expired" || (!d.standing && !!d.validUntil && d.validUntil < today);
/** Pure: "valid" while a verified or partial outcome stands with an end date, "expired" once lapsed, else null. */
export function decisionValidity(d: VerificationDecision, today: string): "valid" | "expired" | null {
  if (!d.validUntil || (d.outcomeClass !== "verified" && d.outcomeClass !== "partial") || d.revokedAt || d.supersededBy) return null;
  if (lapsedOn(d, today)) return "expired";
  return currentDecision(d, today) ? "valid" : null;
}
/** Pure: a verified outcome current and ending within the window, or expired, and not replaced, may be reassessed. */
export function mayAskReassessment(d: VerificationDecision, today: string, windowDays = 90): boolean {
  if (d.outcomeClass !== "verified" || !d.decisionId || !d.validUntil || d.revokedAt || d.supersededBy) return false;
  if (lapsedOn(d, today)) return true;
  return currentDecision(d, today) && Math.round((Date.parse(`${d.validUntil.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) <= windowDays;
}
/** Pure: whether the stage at decision is shown (a verified or partial outcome that states one). */
export const showsStage = (d: VerificationDecision) => !!d.stage && (d.outcomeClass === "verified" || d.outcomeClass === "partial");

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

export async function requestVerification(admin: any, userId: string, r: { competency: CompetencyRef; evidence: EvidenceRef[]; methodCode?: string; note?: string; renewsDecisionId?: string }) {
  if (!studio) return { ok: false as const, status: 409, error: "Independent verification is not available yet." };
  return studio.requestVerification(admin, userId, r);
}

// ── THE STUDIO, ADAPTED ── through src/lib/competency/verification.ts only (its labels from its pure config) ─────────
//
// Professional reads what C5 decided and hands it requests, further evidence and withdrawals. C5's database guards do
// the rest: who may decide, independence, the method, expiry and revocation. A withdrawal or further evidence names a
// request by (id, person) -- 510's composite keys -- so nobody can act on another person's request.

const OUTCOME_CLASS_SET: readonly string[] = ["verified", "partial", "further_evidence", "not_demonstrated", "unable_to_determine"];

/** What a decision's standing means, and the sentence C5 requires beside every outcome. */
export const DECISION_STANDING_LABEL: Record<Standing, string> = STANDING_LABEL;
export const ONE_ASSESSMENT = NOT_A_DECLARATION;

const toRef = (e: EvidenceRef) => ({ kind: e.kind, sourceId: e.sourceId, linkId: e.linkId || undefined, learningOutcome: e.learningOutcome });

function toSummary(i: c5.VerificationItem): VerificationSummary {
  return {
    requestId: i.requestId, status: i.status, statusLabel: STATE_LABEL[i.status as RequestState] ?? i.status,
    competency: { frameworkId: i.competency.frameworkId ?? "", frameworkCompetencyId: i.competency.frameworkCompetencyId, frameworkVersion: i.competency.frameworkVersion,
      title: i.competency.title, learningOutcomes: i.competency.learningOutcomes },
    method: i.method.name, requestedAt: i.requestedAt,
    // C5 keeps its own snapshot of each piece and returns the portfolio link, not the source record's id.
    // 680 assessor observations and exam results are the assessor's record, not portfolio evidence: they are not listed here.
    evidence: i.evidence.filter((e): e is typeof e & { kind: EvidenceKind } => !isAssessorEvidence(e.kind)).map(e => ({ linkId: e.linkId ?? "", kind: e.kind, sourceId: "", title: e.title, evidenceClass: e.evidenceClass ?? "", issuer: e.issuer,
      occurredOn: e.occurredOn, learningOutcome: e.learningOutcomes[0] ?? null, relation: "", frameworkVersion: null })),
    decisions: i.decisions.map(d => ({
      outcomeCode: d.outcomeCode, outcomeClass: OUTCOME_CLASS_SET.includes(d.outcomeClass ?? "") ? d.outcomeClass as OutcomeClass : null, standing: d.standing,
      outcomeLabel: d.outcomeLabel, level: d.level?.label ?? null, assessorName: d.assessorName ?? "An appointed assessor", authority: d.authority,
      criteriaVersion: d.criteriaVersion.versionNo === null ? null : `version ${d.criteriaVersion.versionNo}`,
      decidedAt: d.decidedAt, validUntil: d.validUntil, revokedAt: d.revokedAt, supersededBy: d.supersededBy,
      decisionId: d.decisionId, stage: d.stage?.label ?? null,
      confirmation: !d.confirmation?.required ? null : d.confirmation.result ?? "awaiting",
    })),
    requestedByOther: i.requestedByOther,
    developmentNeed: i.developmentNeed ? { reason: i.developmentNeed.reason, detail: i.developmentNeed.detail, decidedAt: i.developmentNeed.decidedAt } : null,
  };
}

function c5Studio(): Studio {
  return {
    async listVerifications(admin, userId, f) {
      const r = await c5.listVerifications(admin, userId, { frameworkCompetencyId: f.frameworkCompetencyId });
      if (r === null) return { provisioned: true, items: null };
      return r.provisioned ? { provisioned: true, items: r.items.map(toSummary) } : { provisioned: false };
    },
    requestVerification: (admin, userId, r) => c5.requestVerification(admin, userId, { competency: r.competency, methodCode: r.methodCode, note: r.note, renewsDecisionId: r.renewsDecisionId, evidence: r.evidence.map(toRef) }),
  };
}

/** The methods C5 offers for one catalogue competency: name and kind only. A person chooses one when there are several. */
export async function verificationMethods(admin: any, frameworkCompetencyId: string): Promise<{ provisioned: false } | { provisioned: true; methods: { code: string; name: string }[] } | null> {
  try {
    const r = await c5.verificationMethodsFor(admin, frameworkCompetencyId);
    if (r === null || !r.provisioned) return r;
    return { provisioned: true, methods: r.methods.map(m => ({ code: m.code, name: m.name })) };
  } catch { return null; }
}

/** Further evidence on the person's own open request, or where the assessor asked for more. Never a reflection unticked. */
export async function addVerificationEvidence(admin: any, userId: string, requestId: string, evidence: EvidenceRef[]) {
  return c5.addRequestEvidence(admin, userId, requestId, evidence.map(toRef));
}

/** The person withdraws their own request. C5 records it as an event; nothing is deleted. */
export async function withdrawVerification(admin: any, userId: string, requestId: string, reason?: string) {
  if (!(await c5.verificationReady(admin))) return c5.NOT_PROVISIONED;
  return c5.withdrawRequest(admin, userId, requestId, reason);
}
