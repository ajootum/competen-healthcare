/* eslint-disable @typescript-eslint/no-explicit-any */
import { linkKind, linkSourceId, loadCompetencyWorkspace } from "./competency-store";
import { currentDecision, loadVerifications } from "./competency-verification";
import type { Stage5Input, VerificationDecision, VerificationInput } from "./evaluation";

// ── STAGE 5 AND C5, READ THROUGH THEIR OWN EXPORTS ── COMPETEN-PROFESSIONAL-EVALUATION-01 x COMPETEN-PROFESSIONAL-COMPETENCY-01 ──
//
// The ONLY place Stage 6 touches Stage 5. My Competencies, self-assessments and evidence links come from Stage 5's
// reader (competency-store.ts, migration 520). Verification decisions come from Stage 5's C5 read adapter
// (competency-verification.ts), which the Verification Studio (C5, migrations 510-519) registers with. Nothing here
// writes, names a Stage 5 or C5 table, or makes, changes or revokes a decision.
//
// ⚠ DEGRADES, NEVER FAILS. Before 520 is applied, or before the Studio registers, `available` is false and the
// evaluation says so. A failed read is null and the evaluation says it could not be read.

export async function loadStage5(admin: any, userId: string): Promise<Stage5Input> {
  try {
    const ws = await loadCompetencyWorkspace(admin, userId);
    if (!ws.provisioned) return { available: false, entries: [], assessments: [], links: [] };
    return {
      available: true,
      entries: ws.entries?.map(e => ({ id: e.id, kind: e.kind, framework_competency_id: e.framework_competency_id ?? null, framework_version: e.framework_version ?? null,
        title: e.title, removed_at: e.removed_at, interest: !!e.interest })) ?? null,
      assessments: ws.assessments?.map(a => ({ id: a.id, my_competency_id: a.my_competency_id, learning_outcome: a.learning_outcome, framework_version: a.framework_version,
        scale_label: a.scale_label, level_label: a.level_label, confidence_label: a.confidence_label, development_interest: a.development_interest, assessed_at: a.assessed_at })) ?? null,
      links: ws.links?.map(l => ({ id: l.id, my_competency_id: l.my_competency_id, kind: linkKind(l), sourceId: linkSourceId(l), learning_outcome: l.learning_outcome,
        framework_version: l.framework_version, relation_code: l.relation_code, relation_label: l.relation_label, source: l.source, linked_at: l.linked_at, unlinked_at: l.unlinked_at })) ?? null,
    };
  } catch { return { available: true, entries: null, assessments: null, links: null }; }
}

/** C5 decisions, read only, each with whether it is a CURRENT VERIFIED outcome (the only thing called verified). */
export async function loadVerification(admin: any, userId: string, today: string, competenciesHref: string): Promise<VerificationInput> {
  try {
    const read = await loadVerifications(admin, userId);
    if (!read.provisioned) return { available: false, decisions: [] };
    if (read.items === null) return { available: true, decisions: null };
    const decisions: VerificationDecision[] = read.items.flatMap(it => it.decisions.map(d => {
      const current = currentDecision(d, today);
      // C5 (IND-007): the outcome CLASS is the fixed meaning (510 CHECK, set by the decision trigger from the published method
      // version); outcome CODES are per-method configuration. Verified = current AND class verified AND a level (510 requires one).
      // A decision read without its class is never called verified.
      const outcomeClass = (d as { outcomeClass?: unknown }).outcomeClass;
      return {
        id: `${it.requestId}.${d.decidedAt.slice(0, 19).replace(/[^0-9]/g, "")}`, myCompetencyId: null, frameworkCompetencyId: it.competency.frameworkCompetencyId,
        title: it.competency.title, outcomeLabel: d.outcomeLabel, current, verified: current && outcomeClass === "verified" && !!d.level,
        state: d.revokedAt ? "revoked" : d.supersededBy ? "superseded" : d.validUntil && d.validUntil < today ? "expired" : d.outcomeLabel,
        decidedOn: d.decidedAt.slice(0, 10), assessor: d.assessorName, method: it.method, frameworkVersion: d.criteriaVersion ?? it.competency.frameworkVersion,
        learningOutcomes: it.competency.learningOutcomes, href: competenciesHref,
      };
    }));
    return { available: true, decisions };
  } catch { return { available: true, decisions: null }; }
}
