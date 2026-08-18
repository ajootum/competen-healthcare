// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-CORE-MOS-001 §3 — THE CANONICAL SUBJECT RESOLVER.
//
// ⚠ IDENTITY ONLY, AND THAT IS AN ENFORCED BOUNDARY RATHER THAN A STYLE. The owner's phase 1 condition:
// "keep the subject layer identity-only at this stage. Do not allow it to become a shadow source of
// truth for Practice metadata, entitlements, governance state, incidents or commercial state."
//
// So this module answers exactly two questions — WHAT is this subject, and WHAT is it inside — and no
// others. It has no status, no plan, no entitlement, no counts. A caller wanting a Practice's state
// reads the Practice; a caller wanting its entitlement reads the entitlement. The subject layer says
// only that the subject exists, what it is called, and where it sits in the chain.
//
// The temptation this guards against is real and cheap to fall into: the subject view already joins to
// practice_workspace, so adding `status` to it would cost one line and would immediately make this the
// most convenient place to read a Practice's state. It would then be a second source of truth for a
// fact that already has one, and mos-phase1-harness pins the column list to prevent exactly that.
//
// ⚠ AND THE REGISTRY IS DERIVED, SO THERE IS NOTHING TO REFRESH. mos_subject is a view over
// practice_workspace. A rename, an archive or a deletion is visible on the next read because there is no
// copy to update — which is the property phase 1 is accepted against, not an implementation detail.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** §3's canonical subject types. The database holds the same list in mos_subject_type. */
export type SubjectType =
  | "platform" | "product" | "market" | "plan_segment"
  | "practice" | "practitioner" | "service" | "integration";

export const SUBJECT_TYPES: SubjectType[] = [
  "platform", "product", "market", "plan_segment", "practice", "practitioner", "service", "integration",
];

/** The singletons — a subject of this type has no id of its own. */
export const SINGLETON_TYPES: SubjectType[] = ["platform", "product"];

/**
 * ⚠ THE COMPLETE SHAPE OF A SUBJECT, AND IT IS DELIBERATELY FIVE FIELDS.
 *
 * Anything added here is a claim that the subject layer owns that fact. Nothing about a Practice's
 * state, plan, health or governance belongs on this type.
 */
export type Subject = {
  subjectType: string;
  subjectId: string;
  label: string;
  parentType: string | null;
  parentId: string | null;
};

/** The columns the view exposes. Pinned by the harness so the layer cannot quietly widen. */
export const SUBJECT_COLUMNS = ["subject_type", "subject_id", "label", "parent_type", "parent_id"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

type Row = { subject_type: string; subject_id: string; label: string; parent_type: string | null; parent_id: string | null };
const toSubject = (r: Row): Subject => ({
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  label: r.label,
  parentType: r.parent_type,
  parentId: r.parent_id,
});

/**
 * Every subject the estate can currently address.
 *
 * ⚠ RETURNS null ON A FAILED READ RATHER THAN AN EMPTY ARRAY. "No subjects exist" and "the registry
 * could not be read" are different answers, and an empty array collapses them into the reassuring one.
 */
export async function loadSubjects(admin: Admin): Promise<Subject[] | null> {
  const res = await admin.from("mos_subject")
    .select("subject_type, subject_id, label, parent_type, parent_id");
  if (res.error || !Array.isArray(res.data)) return null;
  return (res.data as Row[]).map(toSubject);
}

/** One subject, or null when it does not exist. */
export async function resolveSubject(admin: Admin, subjectType: string, subjectId: string): Promise<Subject | null> {
  const res = await admin.from("mos_subject")
    .select("subject_type, subject_id, label, parent_type, parent_id")
    .eq("subject_type", subjectType).eq("subject_id", subjectId).limit(1);
  if (res.error || !Array.isArray(res.data) || res.data.length === 0) return null;
  return toSubject(res.data[0] as Row);
}

/** The canonical subject for a Practice workspace id. */
export const practiceSubject = (admin: Admin, practiceId: string) =>
  resolveSubject(admin, "practice", practiceId);

/**
 * §3's parent/context chain, from the subject up to the root.
 *
 * ⚠ IT IS BOUNDED, AND NOT BECAUSE THE DATA IS UNTRUSTED. The chain is derived from a view whose
 * parentage is written in SQL, so a cycle would be a bug in that view rather than bad data — but a
 * resolver that loops forever on one is a far worse failure than one that stops and says so. The bound
 * is the number of subject types, because no honest chain can be longer than that.
 */
export async function subjectChain(admin: Admin, subjectType: string, subjectId: string): Promise<Subject[] | null> {
  const chain: Subject[] = [];
  let type: string | null = subjectType;
  let id: string | null = subjectId;

  for (let depth = 0; depth < SUBJECT_TYPES.length; depth++) {
    if (!type || !id) break;
    const s: Subject | null = await resolveSubject(admin, type, id);
    if (!s) break;
    chain.push(s);
    type = s.parentType;
    id = s.parentId;
  }
  return chain.length === 0 ? null : chain;
}

/** The vocabulary, read from the database rather than from the constant above. */
export async function loadSubjectTypes(admin: Admin): Promise<{ code: string; description: string; singleton: boolean }[] | null> {
  const res = await admin.from("mos_subject_type").select("code, description, singleton");
  if (res.error || !Array.isArray(res.data)) return null;
  return res.data as { code: string; description: string; singleton: boolean }[];
}
