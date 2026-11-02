import { MODE_ASSESSOR, MODE_SELF } from "./vocab";

// ── WHAT A LEARNER IS OFFERED ── Checklist Studio S3, decision D10 ───────────────────────────────────────────────────
//
// Pure. The Assessments page offers an instrument only when ALL of these hold:
//   1. its code is in the HQ policy scholar_assessment_instruments (empty by default: nothing is offered);
//   2. it has a PUBLISHED version (retired, draft, in review and approved versions are never offered);
//   3. that version's delivery modes include self_assessment.
// An assessor-led card appears only beside a grant made for THIS learner that is not ended and is inside its dates:
// "awaiting your acceptance" until the learner accepts, then live. A grant never widens what the policy offers for
// self-assessment, and a self-assessment is never offered because a grant exists.

export type OfferVersion = {
  instrumentId: string; code: string; name: string; versionId: string; versionNo: number; state: string;
  title: string | null; summary: string | null; deliveryModes: readonly string[]; respondentRoles: readonly string[]; methodCodes: readonly string[];
};
export type OfferGrant = {
  id: string; instrumentId: string; acceptedAt: string | null; endedAt: string | null; validFrom: string; validUntil: string | null;
  respondentName: string | null; reason: string | null;
};
export type GrantStanding = "awaiting_acceptance" | "live";
export type OfferCard = {
  instrumentId: string; code: string; name: string; versionId: string; versionNo: number; title: string; summary: string | null;
  /** The permitted modes, as chips. */
  modes: string[]; methodCodes: string[];
  /** Start Self-Assessment is offered (the primary action). */
  selfAssessment: boolean;
  /** Present only with a grant for this learner. */
  assessorLed: { grantId: string; standing: GrantStanding; assessorName: string | null; reason: string | null } | null;
};

const within = (g: OfferGrant, nowMs: number) => Date.parse(g.validFrom) <= nowMs && (g.validUntil === null || Date.parse(g.validUntil) > nowMs);

/** The standing of a grant for the learner, or null when it offers nothing (ended, not yet valid, expired). */
export function grantStanding(g: OfferGrant, nowMs: number): GrantStanding | null {
  if (g.endedAt || !within(g, nowMs)) return null;
  return g.acceptedAt ? "live" : "awaiting_acceptance";
}

export function offerFilter(input: { policyCodes: readonly string[]; versions: readonly OfferVersion[]; grants: readonly OfferGrant[]; now: number }): OfferCard[] {
  const allowed = new Set(input.policyCodes);
  // The latest PUBLISHED version of each instrument.
  const latest = new Map<string, OfferVersion>();
  for (const v of input.versions) {
    if (v.state !== "published") continue;
    const cur = latest.get(v.instrumentId);
    if (!cur || v.versionNo > cur.versionNo) latest.set(v.instrumentId, v);
  }
  const grantFor = new Map<string, { g: OfferGrant; standing: GrantStanding }>();
  for (const g of input.grants) {
    const standing = grantStanding(g, input.now);
    if (!standing) continue;
    const cur = grantFor.get(g.instrumentId);
    // a live grant outranks one still awaiting acceptance
    if (!cur || (cur.standing === "awaiting_acceptance" && standing === "live")) grantFor.set(g.instrumentId, { g, standing });
  }
  const cards: OfferCard[] = [];
  for (const v of latest.values()) {
    const self = allowed.has(v.code) && v.deliveryModes.includes(MODE_SELF);
    const gr = grantFor.get(v.instrumentId);
    const assessor = gr && v.respondentRoles.includes("assessor") ? gr : undefined;
    if (!self && !assessor) continue;
    cards.push({
      instrumentId: v.instrumentId, code: v.code, name: v.name, versionId: v.versionId, versionNo: v.versionNo, title: v.title?.trim() || v.name, summary: v.summary,
      modes: [...v.deliveryModes].filter(m => m === MODE_SELF ? self : m === MODE_ASSESSOR ? !!assessor : allowed.has(v.code)),
      methodCodes: [...v.methodCodes], selfAssessment: self,
      assessorLed: assessor ? { grantId: assessor.g.id, standing: assessor.standing, assessorName: assessor.g.respondentName, reason: assessor.g.reason } : null,
    });
  }
  return cards.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}
