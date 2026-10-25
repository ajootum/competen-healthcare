/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpdHours, normaliseBlueprint, RELATION_LABEL, type Relation } from "./blueprint";
import { EVIDENCE_LABEL, OUTCOME_LABEL } from "./record";

// ── LEARNING RECORDS, BY REFERENCE, FOR PROFESSIONAL, SCHOLAR AND THE PASSPORT ── COMPETEN-LEARNING-01 S4 ──────────────
//
// The one authoritative record is learning_record (462). Professional CPD, evidence and progress, the Passport and
// Scholar READ it through these functions, by the subject's own id only. Nothing is copied into
// individual_professional_cpd or any other table, so there is no duplicate entry to drift (product definition s12).
//
// ⚠ COMPLETED RECORDS ONLY, LABELLED BY WHAT THEY ARE. A hosted completion is "Recorded by Competen Learning" (the
// platform recorded the learner completing the course, or passing its assessment). An external completion is
// self-declared, or self-declared with a document attached. None of them is "verified" and none claims competence.
//
// ⚠ LEARNING IS NOT THE ONLY ROUTE. Professional keeps its own CPD entries for conferences, independent study,
// mentorship, research and workplace learning. These references sit beside them (product definition s13).
//
// null = could not be read (render "could not be read"), [] = none (render nothing).

export type LearningReference = {
  recordId: string; offeringId: string; code: string; title: string; versionNo: number; delivery: "hosted" | "external";
  provider: string | null; completedOn: string; completionKind: "course_completion" | "assessed_knowledge" | "external_completion";
  outcomeLabel: string; evidenceClass: "platform_recorded" | "self_declared" | "source_linked"; evidenceLabel: string;
  hours: number | null; cpdNote: string;
  certificates: { no: string; outcome: string; verificationCode: string; revoked: boolean }[];
  competencies: { id: string; name: string; relation: Relation; relationLabel: string }[];
};

/** Every COMPLETED learning record of this person, newest first, as a reference. */
export async function loadLearningRecords(admin: any, userId: string): Promise<LearningReference[] | null> {
  try {
    const { data: rs, error } = await admin.from("learning_record")
      .select("id, offering_id, version_id, delivery, completed_at, completion_kind, evidence_class, external_completed_on, external_hours, learning_offering!inner(code, title), learning_offering_version!inner(version_no, content, delivery_provider_id)")
      .eq("user_id", userId).eq("status", "completed").order("completed_at", { ascending: false }).limit(500);
    if (error) return /does not exist|schema cache|could not find/i.test(error.message ?? "") ? [] : null;
    if (!rs?.length) return [];
    const vids = [...new Set(rs.map((r: any) => r.version_id))];
    const [certs, links, provs] = await Promise.all([
      admin.from("learning_certificate").select("record_id, certificate_no, outcome, verification_code, revoked_at").eq("user_id", userId),
      admin.from("learning_offering_version_outcome").select("version_id, competency_id, relation").in("version_id", vids),
      admin.from("learning_provider").select("id, name"),
    ]);
    if (certs.error || links.error || provs.error) return null;
    const compIds = [...new Set((links.data ?? []).map((l: any) => l.competency_id))];
    const { data: comps, error: cErr } = compIds.length ? await admin.from("framework_competencies").select("id, name").in("id", compIds) : { data: [], error: null };
    if (cErr) return null;
    const compName = new Map<string, string>((comps ?? []).map((c: any) => [c.id, c.name]));
    const prov = new Map<string, string>((provs.data ?? []).map((p: any) => [p.id, p.name]));
    return rs.map((r: any) => {
      const b = normaliseBlueprint(r.learning_offering_version.content, r.delivery);
      const seen = new Set<string>();
      const mine = (links.data ?? []).filter((l: any) => {
        const k = `${l.competency_id}:${l.relation}`;
        if (l.version_id !== r.version_id || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return {
        recordId: r.id, offeringId: r.offering_id, code: r.learning_offering.code, title: r.learning_offering.title, versionNo: r.learning_offering_version.version_no, delivery: r.delivery,
        provider: prov.get(r.learning_offering_version.delivery_provider_id) ?? null,
        completedOn: (r.external_completed_on ?? r.completed_at ?? "").slice(0, 10), completionKind: r.completion_kind,
        outcomeLabel: OUTCOME_LABEL[r.completion_kind as keyof typeof OUTCOME_LABEL] ?? r.completion_kind,
        evidenceClass: r.evidence_class, evidenceLabel: EVIDENCE_LABEL[r.evidence_class as keyof typeof EVIDENCE_LABEL] ?? r.evidence_class,
        hours: r.delivery === "hosted" ? cpdHours(b) : (r.external_hours != null ? Number(r.external_hours) : null), cpdNote: b.cpd.note,
        certificates: (certs.data ?? []).filter((c: any) => c.record_id === r.id).map((c: any) => ({ no: c.certificate_no, outcome: c.outcome, verificationCode: c.verification_code, revoked: !!c.revoked_at })),
        competencies: mine.map((l: any) => ({ id: l.competency_id, name: compName.get(l.competency_id) ?? "A CFCA competency", relation: l.relation, relationLabel: RELATION_LABEL[l.relation as Relation] ?? l.relation })),
      };
    });
  } catch { return null; }
}

/**
 * Pure: the CPD lines learning contributes, in the shape a CPD log shows -- for Professional CPD and Progress to list
 * BESIDE its own entries, labelled "From Competen Learning". Hours are the course's own figure (or its lesson time),
 * never an accredited CPD value.
 */
export function learningCpdLines(refs: readonly LearningReference[]): { recordId: string; activityType: "course"; title: string; provider: string | null; hours: number | null; activityDate: string; evidenceClass: LearningReference["evidenceClass"]; evidenceLabel: string; source: "learning" }[] {
  return refs.map(r => ({ recordId: r.recordId, activityType: "course", title: r.title, provider: r.provider, hours: r.hours, activityDate: r.completedOn, evidenceClass: r.evidenceClass, evidenceLabel: r.evidenceLabel, source: "learning" }));
}

/**
 * Pure: which completed learning serves which development need or goal -- by the CFCA competencies they share (a need
 * or goal's competencies come from Professional's own mapping, 393). A reference, computed on read: nothing is linked
 * or stored, and a need is never marked met by this.
 */
export function learningForCompetencies(refs: readonly LearningReference[], competencyIds: readonly string[]): LearningReference[] {
  const want = new Set(competencyIds);
  return refs.filter(r => r.competencies.some(c => want.has(c.id)));
}

/** Pure: the Passport items -- one per completed record, with its certificates. Evidence class in words, never "verified". */
export function learningPassportItems(refs: readonly LearningReference[]): { kind: "learning"; title: string; detail: string; date: string; evidence: LearningReference["evidenceClass"]; evidenceLabel: string; certificateNos: string[] }[] {
  return refs.map(r => ({
    kind: "learning", title: r.title, date: r.completedOn, evidence: r.evidenceClass, evidenceLabel: r.evidenceLabel,
    detail: [r.outcomeLabel, r.provider ? `provided by ${r.provider}` : null, `version ${r.versionNo}`].filter(Boolean).join(", "),
    certificateNos: r.certificates.filter(c => !c.revoked).map(c => c.no),
  }));
}
