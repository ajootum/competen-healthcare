/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadIndividualPassport } from "../passport";
import { loadProfessionalRecord } from "./record";
import { loadProfessionalLearning } from "./learning";
import { loadProfessionalProfile } from "./profile-store";
import { isIndependentlyVerified, loadVerifications as loadProfileVerifications } from "./profile-verification";
import { loadStage5, loadVerification } from "./evaluation-stage5";
import { loadEvaluationHistory } from "./evaluation-store";
import { CONFIDENCE_LABEL } from "./evaluation-vocabulary";
import { CPD_ACTIVITY_LABEL } from "./vocabulary";
import { experienceHref } from "../experiences";
import { trustOfClass, validityOf } from "../documents/trust";
import type { DocRecord } from "../documents/model";
import type { SectionCode } from "../documents-config";

// ── THE RECORDS A PERSON MAY PLACE IN A DOCUMENT ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.4, s10.7, s10.8 ──────────────
//
// Read through each OWNER's reader, by the person's own id, at the moment of preview or export: the profile (450, with
// 451 verification), CPD (373), Competen Learning (462), evidence (373 with 520 types), My Competencies (520) and C5
// decisions (through Stage 5's adapter), the Passport's organisation records, Scholar study shown on the Passport, and
// Stage 6 evaluations. Nothing is copied: a draft names a record by its key, and this rebuilds it every time.
//
// ⚠ NEVER OFFERED: private reflections and goal reviews, notes, development needs and plans, AI conversations, documents
// themselves, and anything of another person. A withdrawn or superseded profile record is not offered, so it cannot reach
// a document by an old key.
//
// ⚠ MEANING FROM THE OWNER. trust and validity come from the record's class, its owner's verification state and its own
// dates (documents/trust.ts). A competency entry is never stronger than self-declared: its independent decisions are
// separate records, from C5 or an organisation, beside it.

export type Catalogue = { records: DocRecord[]; unreadable: string[]; person: { name: string; email: string | null; headline: string | null } };

const SECTION_OF_ITEM: Record<string, SectionCode[]> = {
  qualification: ["education", "qualifications"], registration: ["registrations"], employment: ["employment"], specialty: ["specialties"],
  interest: ["career_interests"], aspiration: ["career_interests"],
};
const CPD_EXTRA: Record<string, SectionCode> = { teaching: "teaching", research: "research", quality_improvement: "quality_improvement" };

export async function loadDocumentCatalogue(admin: any, userId: string, profileName: { fullName: string | null; email: string | null }, today: string): Promise<Catalogue> {
  const [profile, verifications, record, learning, passport, stage5, c5, evals] = await Promise.all([
    loadProfessionalProfile(admin, userId), loadProfileVerifications(admin, userId, today), loadProfessionalRecord(admin, userId),
    loadProfessionalLearning(admin, userId), loadIndividualPassport(admin, userId, today), loadStage5(admin, userId),
    loadVerification(admin, userId, today, experienceHref("professional", "competencies")), loadEvaluationHistory(admin, userId, 100),
  ]);
  const records: DocRecord[] = [];
  const unreadable: string[] = [];
  const push = (r: DocRecord) => { if (!records.some(x => x.key === r.key)) records.push(r); };

  // Professional profile (450) with its 451 verification state.
  if (profile.items === null) unreadable.push("Professional profile");
  for (const i of (profile.items ?? []).filter(i => !i.superseded_at && !i.withdrawn_at)) {
    const v = verifications?.[i.id];
    const decided = v && isIndependentlyVerified(v.state);
    const lapsed = v && !decided && v.verifiedAt && v.history.some(h => h.event === "revoked") ? "revoked" : undefined;
    push({
      key: `profile_item:${i.id}`, kind: "profile_item", sections: SECTION_OF_ITEM[i.section] ?? ["career_interests"], title: i.title,
      subtitle: i.organisation, from: i.started_on, to: i.ended_on, date: i.started_on ? null : i.created_at.slice(0, 10),
      trust: decided ? "independent" : trustOfClass(i.evidence_class),
      validity: lapsed === "revoked" ? "revoked" : validityOf(decided ? v!.validUntil ?? i.expires_on : i.expires_on, today), source: "Professional profile",
      facts: [
        ...(i.type_label ? [{ code: "type", label: "Type", value: i.type_label }] : []),
        ...(i.jurisdiction ? [{ code: "jurisdiction", label: "Jurisdiction", value: i.jurisdiction }] : []),
        ...(i.self_declared_identifier ? [{ code: "identifier", label: "Number", value: i.self_declared_identifier, defaultHidden: true }] : []),
        ...(i.expires_on ? [{ code: "expires", label: "Expires", value: i.expires_on }] : []),
        ...(decided && v?.method ? [{ code: "verification", label: "Checked by Competen", value: `${v.verifiedAt?.slice(0, 10) ?? ""}`.trim() || "yes" }] : []),
      ],
    });
  }

  // CPD (373, Stage 4). Never its reflection.
  if (record.cpd === null) unreadable.push("CPD log");
  for (const c of record.cpd ?? []) push({
    key: `cpd:${c.id}`, kind: "cpd", sections: ["learning_cpd", ...(CPD_EXTRA[c.activity_type] ? [CPD_EXTRA[c.activity_type]] : [])],
    title: c.title, subtitle: c.provider, from: null, to: null, date: c.activity_date, trust: trustOfClass(c.evidence_class), validity: "not_applicable", source: "CPD log",
    facts: [{ code: "type", label: "Activity", value: CPD_ACTIVITY_LABEL[c.activity_type as keyof typeof CPD_ACTIVITY_LABEL] ?? c.activity_type },
      ...(c.hours != null ? [{ code: "hours", label: "Hours", value: String(c.hours) }] : []), ...(c.cpd_points != null ? [{ code: "points", label: "CPD points", value: String(c.cpd_points) }] : [])],
  });

  // Competen Learning (462), by reference.
  if (learning.enabled && learning.refs === null) unreadable.push("Competen Learning");
  for (const r of learning.refs ?? []) push({
    key: `learning_record:${r.recordId}`, kind: "learning_record",
    sections: ["learning_cpd", "qualifications", ...(r.completionKind === "assessed_knowledge" ? ["assessments_evidence" as const] : [])],
    title: r.title, subtitle: r.provider, from: null, to: null, date: r.completedOn,
    trust: r.completionKind === "assessed_knowledge" ? "formative" : trustOfClass(r.evidenceClass), validity: "not_applicable", source: "Competen Learning",
    facts: [{ code: "outcome", label: "Outcome", value: r.outcomeLabel }, ...(r.hours != null ? [{ code: "hours", label: "Hours", value: String(r.hours) }] : []),
      ...r.certificates.filter(x => !x.revoked).map(x => ({ code: "certificate", label: "Certificate", value: x.no }))],
  });

  // Evidence items (373 with Stage 5 types): the person decides which section each belongs in.
  if (record.evidence === null) unreadable.push("Evidence");
  for (const e of record.evidence ?? []) push({
    key: `evidence:${e.id}`, kind: "evidence", sections: ["assessments_evidence", "research", "teaching", "quality_improvement"],
    title: e.title, subtitle: e.issuing_body, from: null, to: null, date: e.issued_on ?? e.created_at.slice(0, 10),
    trust: trustOfClass(e.evidence_class), validity: validityOf(e.expires_on, today), source: "Evidence", facts: [],
  });

  // My Competencies (520): the entry, self-assessed only. Independent decisions are separate records below.
  if (stage5.available && (stage5.entries === null || stage5.assessments === null)) unreadable.push("My Competencies");
  for (const e of (stage5.entries ?? []).filter(e => !e.removed_at)) {
    const sa = (stage5.assessments ?? []).filter(a => a.my_competency_id === e.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at))[0];
    const linked = (stage5.links ?? []).filter(l => l.my_competency_id === e.id && !l.unlinked_at && l.kind !== "reflection").length;
    push({
      key: `competency:${e.id}`, kind: "competency", sections: ["competencies"], title: e.title, subtitle: e.kind === "personal" ? "In my own words" : e.framework_version ? `Framework ${e.framework_version}` : null,
      from: null, to: null, date: sa?.assessed_at.slice(0, 10) ?? null, trust: "self_declared", validity: "not_applicable", source: "My Competencies",
      facts: [...(sa ? [{ code: "self_assessment", label: "Self-assessed (self-reported)", value: sa.level_label }] : []),
        ...(linked ? [{ code: "evidence", label: "Linked evidence records", value: String(linked) }] : [])],
    });
  }
  // C5 decisions (through Stage 5's adapter). Only a current verified outcome is "independent" and current.
  if (c5.available && c5.decisions === null) unreadable.push("Competen verification");
  for (const d of c5.decisions ?? []) push({
    key: `verification:${d.id}`, kind: "verification", sections: ["verified_achievements", "competencies"], title: d.title, subtitle: d.assessor ? `Decided by ${d.assessor}` : null,
    from: null, to: null, date: d.decidedOn, trust: d.verified ? "independent" : "formative",
    validity: d.verified ? "current" : /revoked/i.test(d.state) ? "revoked" : /superseded/i.test(d.state) ? "superseded" : /expired/i.test(d.state) ? "expired" : "not_applicable",
    source: "Competen verification", facts: [{ code: "outcome", label: "Outcome of one assessment", value: d.outcomeLabel }, ...(d.method ? [{ code: "method", label: "Method", value: d.method }] : []),
      ...(d.frameworkVersion ? [{ code: "version", label: "Criteria version", value: d.frameworkVersion }] : [])],
  });

  // The Passport's organisation records: assessed competencies, credentials, employment.
  if (passport.competencies === null || passport.credentials === null) unreadable.push("Competen Passport");
  for (const p of passport.competencies ?? []) push({
    key: `org_assessment:${p.competencyId}`, kind: "org_assessment", sections: ["verified_achievements", "competencies"], title: p.name, subtitle: p.issuer,
    from: null, to: p.expiryDate, date: p.decidedAt?.slice(0, 10) ?? null, trust: "institution", validity: p.current ? "current" : "expired", source: "Competen Passport",
    facts: [{ code: "outcome", label: "Outcome", value: p.outcome.replace(/_/g, " ") }],
  });
  (passport.credentials ?? []).forEach((c, n) => push({
    key: `credential:${n}:${c.title}`.slice(0, 200), kind: "credential", sections: ["qualifications", "registrations", "verified_achievements"], title: c.title, subtitle: c.issuingBody,
    from: null, to: c.expiryDate, date: c.issueDate, trust: trustOfClass(c.evidence), validity: validityOf(c.expiryDate, today), source: "Competen Passport",
    facts: [{ code: "type", label: "Type", value: c.type.replace(/_/g, " ") }],
  }));
  (passport.employment ?? []).forEach((e, n) => push({
    key: `org_employment:${n}:${e.roleTitle}`.slice(0, 200), kind: "profile_item", sections: ["employment"], title: e.roleTitle, subtitle: e.organisation,
    from: e.startDate, to: e.endDate, date: null, trust: "institution", validity: "not_applicable", source: "Competen Passport", facts: [],
  }));

  // Scholar study the person chose to show on their Passport (375): educational, formative.
  if (passport.study.ok) for (const s of passport.study.data) if (s.itemId) push({
    key: `study:${s.itemId}`, kind: "study", sections: ["education"], title: s.label, subtitle: "Competen Scholar", from: null, to: null,
    date: s.lastStudied?.slice(0, 10) ?? null, trust: "formative", validity: "not_applicable", source: "Competen Scholar",
    facts: [{ code: "answered", label: "Practice answered", value: String(s.answered) }],
  });

  // Stage 6 evaluations: formative, never verification. Their notes and AI text never travel.
  if (evals.evaluations === null) unreadable.push("Professional evaluations");
  for (const v of evals.evaluations ?? []) push({
    key: `evaluation:${v.id}`, kind: "evaluation", sections: ["evaluations"], title: `Evaluation: ${v.scope_label}`, subtitle: null, from: null, to: null,
    date: v.evaluated_at.slice(0, 10), trust: "formative", validity: "not_applicable", source: "My Professional Evaluation",
    facts: v.findings?.evidence_confidence?.confidence ? [{ code: "confidence", label: "Evidence confidence", value: CONFIDENCE_LABEL[v.findings.evidence_confidence.confidence] }] : [],
  });

  const pt = profile.pointer ?? null;
  const headline = [pt?.self_declared_professional_title ?? pt?.self_declared_profession ?? record.profile?.self_declared_profession, pt?.self_declared_primary_specialty].filter(Boolean).join(", ") || null;
  return { records, unreadable, person: { name: profileName.fullName?.trim() || "Name not recorded", email: profileName.email, headline } };
}
