/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOwnRecords, type OwnRecord } from "./professional/passport-records";
import { loadPassportEvaluations, loadStudyAchievements, type Read } from "./scholar/store";
import type { PassportEvaluation } from "./scholar/passport-evaluations";
import type { StudyAchievement } from "./scholar/passport-items";
import { learningProvenance, loadProfessionalLearning } from "./professional/learning";
import { learningPassportItems } from "@/lib/learning/products";

// ── THE COMPETEN PASSPORT, AS COMPETEN INDIVIDUAL SHOWS IT ── COMPETEN-IND-003 s2(5), ADR-016 ──────────
//
// ⚠ A VIEW, NOT A RECORD. There is one Competen Passport per person, and it already exists: the
// competency decisions, credentials and employment history keyed on that person (migrations 011, 016,
// 027, 182), which /dashboard/passport and the public /verify page already compose. This module reads
// the SAME rows, by the subject's own id and nothing else, and writes nothing. "Do not create duplicate
// ... Passport records" (COMPETEN-IND-003 s2) is met by construction: there is no table here to
// duplicate into.
//
// ⚠ EVERY ITEM SAYS WHERE IT CAME FROM (COMPETEN-IND-002 s4.2). The person must always be able to tell
// what an organisation issued, what somebody verified and what was only declared:
//
//   institution_issued  a governed decision or record an organisation made about the person
//   institution_verified a credential the person declared that an organisation's staff then verified
//   self_declared       a credential on the record that nobody has verified, or a record the person
//                       added in Competen Professional with no document attached
//   source_linked       a record the person added in Competen Professional with a document attached.
//                       Still not verified -- attaching a document checks nothing (COMPETEN-IND-002 s4.2)
//   self_directed       a Competen Scholar study achievement the person CHOSE to show (migration 375):
//                       practice they did on their own notes. Not an assessment, and never verified.
//   platform_recorded   a Competen Learning course the person completed on the platform: "Course completion,
//                       issued by Competen Holdings" or "Assessed knowledge, issued by Competen Holdings"
//                       (COMPETEN-LEARNING-01 H2). What the course recorded, never a verified competence.
//
// ⚠ TWO CLASSES OF RECORD, LABELLED TWO WAYS (COMPETEN-IND-007 s5, owner ruling D3). The sections read
// here are what organisations issued, labelled by ISSUER. `own` is what the person recorded themselves
// (migration 373, src/lib/individual/professional/passport-records.ts), labelled by PROVENANCE. It
// belongs to the person, not to an experience, so it is read whichever experience shows the Passport.
// `study` is the same idea for Competen Scholar: only the achievements the person chose, one at a time
// (src/lib/individual/scholar/passport-items.ts), never their notes, answers or AI interactions.
// `learning` is the person's completed Competen Learning, read BY REFERENCE from the one Holdings learning record
// (src/lib/learning/products.ts): nothing is copied, and only while Learning is on. An external completion there keeps
// its own class -- self-declared, or with a document attached.
//
// ⚠ PROVISIONAL RULING D3 (COMPETEN-IND-002 s7). Showing institution-issued records to their subject,
// read-only, is the working assumption, not an owner ruling. Disclosure OUTWARD is never automatic --
// sharing stays the person's act, on the existing share surface.
//
// ⚠ "COULD NOT BE READ" IS NOT "NONE". Each section is null when its read failed and [] when it read
// zero rows, and the page renders those differently. A failed read shown as an empty Passport would be a
// claim that the person has no evidence.
//
// ⚠ CURRENT-COMPETENCE SEMANTICS ARE /verify's. The latest decision per competency counts as current when
// its outcome is `competent` and it has not passed its expiry date -- the rule src/app/verify/[token]
// applies, so the Passport cannot show a person something the verification page would not.

export type EvidenceClass = "institution_issued" | "institution_verified" | "self_declared" | "source_linked" | "self_directed" | "educational_evaluation" | "platform_recorded";

export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  institution_issued: "Issued by an organisation",
  institution_verified: "Verified by an organisation",
  self_declared: "Self-declared, not verified",
  source_linked: "Self-declared with a document attached, not verified",
  self_directed: "Self-directed study, not a verified competency",
  // PROGRESS-01 P5: an evaluation of the person's own learning (426) they chose to show (427). Formative, never verified.
  educational_evaluation: "Educational evaluation of own learning: formative, not verified",
  platform_recorded: "Issued by Competen Holdings through Competen Learning",
};

export type PassportCompetency = {
  competencyId: string;
  name: string;
  outcome: string;
  expiryDate: string | null;
  decidedAt: string | null;
  issuer: string | null;
  current: boolean;
};

export type PassportCredential = {
  title: string;
  type: string;
  issuingBody: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: string;
  evidence: EvidenceClass;
};

export type PassportEmployment = {
  roleTitle: string;
  organisation: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export type PassportLearning = ReturnType<typeof learningPassportItems>[number] & { recordId: string; label: string };

export type IndividualPassport = {
  competencies: PassportCompetency[] | null;
  credentials: PassportCredential[] | null;
  employment: PassportEmployment[] | null;
  /** The person's own Competen Professional records, labelled by provenance. */
  own: OwnRecord[] | null;
  /** The Competen Scholar study achievements the person chose to show, labelled self-directed. */
  study: Read<StudyAchievement[]>;
  /** PROGRESS-01 P5: the educational evaluations the person chose to show, labelled formative, never verified. */
  evaluations: Read<PassportEvaluation[]>;
  /** Completed Competen Learning, by reference. enabled false = Learning is off here, and the section is not shown.
   *  Optional only so fixtures from before Learning still type: loadIndividualPassport always sets it. */
  learning?: { enabled: boolean; items: PassportLearning[] | null };
};

const nameOf = (row: any): string => {
  const fc = row?.framework_competencies;
  return (Array.isArray(fc) ? fc[0]?.name : fc?.name) ?? "Unnamed competency";
};

/** Pure: latest decision per competency, newest first, each marked current or not. */
export function latestDecisions(rows: any[], today: string, issuerName: (row: any) => string | null): PassportCompetency[] {
  const latest = new Map<string, any>();
  for (const d of rows) if (d?.competency_id && !latest.has(d.competency_id)) latest.set(d.competency_id, d);
  return [...latest.values()].map(d => ({
    competencyId: d.competency_id,
    name: nameOf(d),
    outcome: String(d.outcome ?? "unknown"),
    expiryDate: d.expiry_date ?? null,
    decidedAt: d.created_at ?? null,
    issuer: issuerName(d),
    current: d.outcome === "competent" && (!d.expiry_date || d.expiry_date > today),
  }));
}

/** Pure: a credential's evidence class. Verified means an organisation's staff verified it. */
export function credentialEvidence(row: any): EvidenceClass {
  return row?.verified === true ? "institution_verified" : "self_declared";
}

export async function loadIndividualPassport(admin: any, userId: string, today: string): Promise<IndividualPassport> {
  const settle = async (p: PromiseLike<any>) => {
    try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; }
  };
  const [decRows, credRows, empRows, own, study, evaluations, learning] = await Promise.all([
    settle(admin.from("competency_decisions")
      .select("competency_id, outcome, expiry_date, created_at, hospital_id, organisation_id, framework_competencies(name)")
      .eq("nurse_id", userId).order("created_at", { ascending: false }).limit(3000)),
    settle(admin.from("professional_credentials")
      .select("title, credential_type, issuing_body, expiry_date, status, verified, issue_date")
      .eq("nurse_id", userId).order("issue_date", { ascending: false }).limit(100)),
    settle(admin.from("employment_records")
      .select("role_title, status, start_date, end_date, hospital_id, organisation_id")
      .eq("nurse_id", userId).order("start_date", { ascending: false }).limit(50)),
    loadOwnRecords(admin, userId).catch(() => null),
    loadStudyAchievements(admin, userId).catch((): Read<StudyAchievement[]> => ({ ok: false, notProvisioned: false })),
    loadPassportEvaluations(admin, userId).catch((): Read<PassportEvaluation[]> => ({ ok: false, notProvisioned: false })),
    loadProfessionalLearning(admin, userId).catch(() => ({ enabled: true, refs: null })),
  ]);

  // Issuer names: the organisations and facilities stamped on this person's own rows, and no others.
  const hospitalIds = new Set<string>();
  const orgIds = new Set<string>();
  for (const r of [...(decRows ?? []), ...(empRows ?? [])]) {
    if (r?.hospital_id) hospitalIds.add(r.hospital_id);
    if (r?.organisation_id) orgIds.add(r.organisation_id);
  }
  const [hosp, orgs] = await Promise.all([
    hospitalIds.size ? settle(admin.from("hospitals").select("id, name").in("id", [...hospitalIds])) : Promise.resolve([]),
    orgIds.size ? settle(admin.from("organisations").select("id, name").in("id", [...orgIds])) : Promise.resolve([]),
  ]);
  const names = new Map<string, string>();
  for (const r of [...(hosp ?? []), ...(orgs ?? [])]) if (r?.id && r?.name) names.set(r.id, r.name);
  const issuerName = (r: any): string | null => names.get(r?.hospital_id) ?? names.get(r?.organisation_id) ?? null;

  return {
    competencies: decRows === null ? null : latestDecisions(decRows, today, issuerName),
    credentials: credRows === null ? null : credRows.map((c: any) => ({
      title: c.title,
      type: String(c.credential_type ?? "credential"),
      issuingBody: c.issuing_body ?? null,
      issueDate: c.issue_date ?? null,
      expiryDate: c.expiry_date ?? null,
      status: String(c.status ?? "unknown"),
      evidence: credentialEvidence(c),
    })),
    employment: empRows === null ? null : empRows.map((e: any) => ({
      roleTitle: e.role_title ?? "Role not recorded",
      organisation: issuerName(e),
      status: String(e.status ?? "unknown"),
      startDate: e.start_date ?? null,
      endDate: e.end_date ?? null,
    })),
    own,
    study,
    evaluations,
    learning: {
      enabled: learning.enabled,
      items: learning.refs === null ? null
        : learningPassportItems(learning.refs).map((p, i) => ({ ...p, recordId: learning.refs![i].recordId, label: learningProvenance(learning.refs![i]) })),
    },
  };
}
