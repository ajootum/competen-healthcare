/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRequiredApprovals, reviewerAppointments } from "@/lib/competency/clinical-review";
import { dbRefusal } from "./governance";

// ── CKRI EDUCATOR KNOWLEDGE IMPROVEMENT ── COMPETEN-KNOWLEDGE-RESEARCH-01 s5 (K3), migration 442 ──────────────────────
//
// An educator sees ONLY the measures the published policy releases to educators (governance.ts educatorMeasures), as
// suppressed snapshot cells (441), raises a need from one REPORTED cell, and answers it through an existing governed
// path: a knowledge resource (here), a clinical case (the 422 studio) or a competency improvement (395).
//
// ⚠ THREE FACTS, NEVER ONE. origin (educator or ai_draft, frozen at creation), educator review (bound to the content
// hash, cleared by any edit) and clinical approval (395 decisions by an independent, scoped reviewer) are stored and
// shown separately. Publication needs approval of the exact version and hq.quality.knowledge.publish (442).
// ⚠ NO AI DRAFTING YET. A knowledge-resource AI workflow is not in the Holdings ATTRIBUTION table (consumption.ts, owned
// by IND-007), so nothing here calls AI. origin ai_draft exists in the schema for when that workflow is added.
// ⚠ NOTHING STUDENT-UPLOADED. Content is typed by the educator. No function here reads a student record.

type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_-]{2,60}$/;
export const RESOURCE_KINDS = ["explanation", "revision_question", "targeted_resource"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
const refusal = (error: any, fb: string) => dbRefusal({ message: String(error?.message ?? "").replace(/^ckri_knowledge_(submit|review|publish|retire): /, "ckri_knowledge: ") }, fb);

/** Pure: the content of a kind, from form fields. Shape is enforced again by 442 (ckri_knowledge_content_ok). */
export function contentOf(kind: ResourceKind, f: Record<string, unknown>): Record<string, unknown> {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  if (kind === "revision_question") {
    const options = Array.isArray(f.options) ? f.options.slice(0, 4).map(o => s(o, 500)) : [];
    return { stem: s(f.stem, 2000), options, correct_index: Number.isInteger(f.correctIndex) ? f.correctIndex : Number(f.correctIndex), rationale: s(f.rationale, 4000) };
  }
  const body = { body: s(f.body, 20000) };
  return kind === "targeted_resource" && Array.isArray(f.links) ? { ...body, links: f.links.slice(0, 20).map(l => s(l, 500)).filter(l => /^https:\/\//.test(l)) } : body;
}

export async function raiseNeed(admin: any, me: string, n: { snapshotId: string; subjectKind: string; subjectRef: string; cohort: string; period: string; summary: string; responseKind: string }): Promise<R<{ id: string }>> {
  if (!UUID.test(n.snapshotId) || !UUID.test(n.subjectRef)) return { ok: false, error: "Choose a reported cell of a snapshot." };
  const { data, error } = await admin.from("ckri_learning_need").insert({
    snapshot_id: n.snapshotId, subject_kind: n.subjectKind, subject_ref: n.subjectRef, cohort_value: n.cohort, period_start: n.period,
    summary: n.summary, response_kind: n.responseKind, raised_by: me, changed_by: me,
  }).select("id").single();
  return error ? { ok: false, error: dbRefusal(error, "The need could not be saved.") } : { ok: true, id: data.id };
}

export async function moveNeed(admin: any, me: string, id: string, status: string, x: { responseRef?: string | null; note?: string | null }): Promise<R> {
  if (!UUID.test(id) || !["in_progress", "addressed", "declined"].includes(status)) return { ok: false, error: "Unknown need or status." };
  const patch: Record<string, unknown> = { status, changed_by: me };
  if (status === "addressed") patch.response_ref = x.responseRef && UUID.test(x.responseRef) ? x.responseRef : null;
  if (x.note) patch.response_note = x.note;
  const { data, error } = await admin.from("ckri_learning_need").update(patch).eq("id", id).select("id");
  if (error) return { ok: false, error: dbRefusal(error, "The need could not be updated.") };
  return data?.length ? { ok: true } : { ok: false, error: "Unknown need." };
}

export async function createResource(admin: any, me: string, r: { code: string; kind: string; title: string; needId: string | null; fields: Record<string, unknown> }): Promise<R<{ resourceId: string; versionId: string }>> {
  if (!CODE.test(r.code)) return { ok: false, error: "A resource code is lowercase letters, digits, hyphens and underscores." };
  if (!(RESOURCE_KINDS as readonly string[]).includes(r.kind)) return { ok: false, error: "Choose an explanation, a revision question or a targeted resource." };
  const { data: res, error } = await admin.from("ckri_knowledge_resource").insert({ code: r.code, kind: r.kind, title: r.title, created_by: me, need_id: r.needId && UUID.test(r.needId) ? r.needId : null }).select("id").single();
  if (error) return { ok: false, error: dbRefusal(error, "The resource could not be created.") };
  const { data: v, error: ve } = await admin.from("ckri_knowledge_version").insert({ resource_id: res.id, version_no: 1, content: contentOf(r.kind as ResourceKind, r.fields), origin: "educator", authored_by: [me] }).select("id").single();
  if (ve) { await admin.from("ckri_knowledge_resource").update({ status: "retired" }).eq("id", res.id); return { ok: false, error: dbRefusal(ve, "The content does not have the shape this kind needs.") }; }
  return { ok: true, resourceId: res.id, versionId: v.id };
}

export async function saveDraft(admin: any, me: string, versionId: string, fields: Record<string, unknown>): Promise<R> {
  if (!UUID.test(versionId)) return { ok: false, error: "Unknown version." };
  const { data: v } = await admin.from("ckri_knowledge_version").select("id, state, authored_by, ckri_knowledge_resource(kind)").eq("id", versionId).maybeSingle();
  if (!v) return { ok: false, error: "Unknown version." };
  const kind = (v.ckri_knowledge_resource?.kind ?? "explanation") as ResourceKind;
  const authors = (v.authored_by ?? []).includes(me) ? v.authored_by : [...(v.authored_by ?? []), me];
  const { error } = await admin.from("ckri_knowledge_version").update({ content: contentOf(kind, fields), authored_by: authors }).eq("id", versionId);
  return error ? { ok: false, error: dbRefusal(error, "The draft could not be saved.") } : { ok: true };
}

export async function newVersion(admin: any, me: string, resourceId: string): Promise<R<{ versionId: string }>> {
  if (!UUID.test(resourceId)) return { ok: false, error: "Unknown resource." };
  const { data: last } = await admin.from("ckri_knowledge_version").select("id, version_no, content").eq("resource_id", resourceId).order("version_no", { ascending: false }).limit(1).maybeSingle();
  if (!last) return { ok: false, error: "Unknown resource." };
  const { data, error } = await admin.from("ckri_knowledge_version").insert({ resource_id: resourceId, version_no: last.version_no + 1, content: last.content, origin: "educator", authored_by: [me], parent_version_id: last.id }).select("id").single();
  return error ? { ok: false, error: dbRefusal(error, "A new version could not be started.") } : { ok: true, versionId: data.id };
}

export async function setCompetencies(admin: any, versionId: string, ids: string[]): Promise<R> {
  if (!UUID.test(versionId)) return { ok: false, error: "Unknown version." };
  const want = [...new Set(ids.filter(i => UUID.test(i)))].slice(0, 20);
  const { error: d } = await admin.from("ckri_knowledge_version_competency").delete().eq("version_id", versionId);
  if (d) return { ok: false, error: dbRefusal(d, "The competencies could not be changed.") };
  if (!want.length) return { ok: true };
  const { error } = await admin.from("ckri_knowledge_version_competency").insert(want.map(competency_id => ({ version_id: versionId, competency_id })));
  return error ? { ok: false, error: dbRefusal(error, "The competencies could not be saved. Use CFCA competency identifiers.") } : { ok: true };
}

export async function reviewDraft(admin: any, me: string, versionId: string): Promise<R> {
  const { error } = await admin.rpc("ckri_knowledge_review", { p_version: versionId, p_educator: me });
  return error ? { ok: false, error: refusal(error, "The review could not be recorded.") } : { ok: true };
}

export async function submitDraft(admin: any, me: string, versionId: string): Promise<R<{ reviewVersionId: string; required: number }>> {
  const { data: v } = await admin.from("ckri_knowledge_version").select("risk").eq("id", versionId).maybeSingle();
  if (!v) return { ok: false, error: "Unknown version." };
  const required = (await loadRequiredApprovals(admin))[v.risk === "high" ? "high" : "standard"];
  const { data, error } = await admin.rpc("ckri_knowledge_submit", { p_version: versionId, p_submitter: me, p_required: required });
  return error ? { ok: false, error: refusal(error, "The resource could not be submitted.") } : { ok: true, reviewVersionId: data as string, required };
}

export async function publishVersion(admin: any, me: string, versionId: string): Promise<R> {
  const { error } = await admin.rpc("ckri_knowledge_publish", { p_version: versionId, p_publisher: me });
  return error ? { ok: false, error: refusal(error, "The resource could not be published.") } : { ok: true };
}

export async function retireResource(admin: any, resourceId: string): Promise<R> {
  const { error } = await admin.rpc("ckri_knowledge_retire", { p_resource: resourceId });
  return error ? { ok: false, error: refusal(error, "The resource could not be retired.") } : { ok: true };
}

export type ClinicalState = "draft" | "in_review" | "approved" | "rejected";
/** Pure: where a version stands clinically. Draft until submitted. Approval is counted, never stored. */
export function clinicalState(state: string, decisions: { decision: string }[], required: number | null): ClinicalState {
  if (state === "draft") return "draft";
  if (decisions.some(d => d.decision === "rejected")) return "rejected";
  return required !== null && decisions.filter(d => d.decision === "approved").length >= required ? "approved" : "in_review";
}

export type VersionView = { id: string; versionNo: number; content: Record<string, unknown>; origin: string; state: string; educatorReviewed: boolean; competencies: string[]; clinical: ClinicalState; approvals: number; required: number | null };
export type ResourceView = { id: string; code: string; kind: ResourceKind; title: string; status: string; need_id: string | null; created_at: string; versions: VersionView[] };
export type ReviewItem = { versionId: string; title: string; kind: string; origin: string; content: unknown; competencies: string[]; approvals: number; required: number };

export async function listResources(admin: any): Promise<ResourceView[] | null> {
  const [res, vers] = await Promise.all([
    admin.from("ckri_knowledge_resource").select("id, code, kind, title, status, need_id, created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("ckri_knowledge_version").select("id, resource_id, version_no, content, origin, state, educator_reviewed_by, educator_reviewed_hash, content_hash, submitted_at, published_at").order("version_no", { ascending: false }).limit(1000),
  ]);
  if (res.error || vers.error) return null;
  const ids = (vers.data ?? []).map((v: any) => v.id);
  const [links, ccv] = await Promise.all([
    ids.length ? admin.from("ckri_knowledge_version_competency").select("version_id, competency_id").in("version_id", ids) : { data: [] },
    ids.length ? admin.from("clinical_content_version").select("id, knowledge_version_id, required_approvals").in("knowledge_version_id", ids) : { data: [] },
  ]);
  const ccvIds = (ccv.data ?? []).map((c: any) => c.id);
  const { data: decisions } = ccvIds.length ? await admin.from("clinical_review_decision").select("version_id, decision").in("version_id", ccvIds) : { data: [] };
  return (res.data ?? []).map((r: any) => ({
    ...r,
    versions: (vers.data ?? []).filter((v: any) => v.resource_id === r.id).map((v: any) => {
      const review = (ccv.data ?? []).filter((c: any) => c.knowledge_version_id === v.id);
      const ds = (decisions ?? []).filter((d: any) => review.some((c: any) => c.id === d.version_id));
      return { id: v.id, versionNo: v.version_no, content: v.content, origin: v.origin, state: v.state, educatorReviewed: !!v.educator_reviewed_by && v.educator_reviewed_hash === v.content_hash,
        competencies: (links.data ?? []).filter((l: any) => l.version_id === v.id).map((l: any) => l.competency_id),
        clinical: clinicalState(v.state, ds, review[0]?.required_approvals ?? null), approvals: ds.filter((d: any) => d.decision === "approved").length, required: review[0]?.required_approvals ?? null };
    }),
  }));
}

export async function listNeeds(admin: any) {
  const { data, error } = await admin.from("ckri_learning_need").select("id, measure, subject_kind, subject_ref, cohort_value, period_start, evidence, summary, response_kind, status, response_ref, response_note, created_at").order("created_at", { ascending: false }).limit(200);
  return error ? null : (data ?? []);
}

/**
 * Knowledge resources a clinical reviewer may decide now: independent of the author and submitter, current (the hash
 * still matches), not yet decided by them. Scope is checked by the 442 trigger on the decision itself, which is
 * written through the existing /api/hq/clinical-review route (395).
 */
export async function resourceReviewQueue(admin: any, reviewerId: string): Promise<{ appointments: { id: string }[]; items: ReviewItem[] } | null> {
  const appts = await reviewerAppointments(admin, reviewerId);
  if (appts === null) return null;
  const { data: vs, error } = await admin.from("clinical_content_version").select("id, knowledge_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, created_at")
    .eq("content_kind", "resource").order("created_at", { ascending: false }).limit(200);
  if (error) return null;
  const mine = (vs ?? []).filter((v: any) => v.submitted_by !== reviewerId && !(v.authored_by ?? []).includes(reviewerId));
  if (!mine.length) return { appointments: appts, items: [] };
  const [kv, ds, links] = await Promise.all([
    admin.from("ckri_knowledge_version").select("id, content_hash, state, origin, ckri_knowledge_resource(kind, title)").in("id", mine.map((v: any) => v.knowledge_version_id)),
    admin.from("clinical_review_decision").select("version_id, reviewer_id, decision").in("version_id", mine.map((v: any) => v.id)),
    admin.from("ckri_knowledge_version_competency").select("version_id, competency_id").in("version_id", mine.map((v: any) => v.knowledge_version_id)),
  ]);
  if (kv.error || ds.error || links.error) return null;
  const items: ReviewItem[] = mine.flatMap((v: any): ReviewItem[] => {
    const k = (kv.data ?? []).find((x: any) => x.id === v.knowledge_version_id);
    const d = (ds.data ?? []).filter((x: any) => x.version_id === v.id);
    if (!k || k.state !== "submitted" || k.content_hash !== v.content_hash) return [];
    if (d.some((x: any) => x.decision === "rejected" || x.reviewer_id === reviewerId)) return [];
    const approvals = d.filter((x: any) => x.decision === "approved").length;
    if (approvals >= v.required_approvals) return [];
    return [{ versionId: v.id, title: k.ckri_knowledge_resource?.title ?? "Knowledge resource", kind: k.ckri_knowledge_resource?.kind ?? "", origin: k.origin, content: v.content_snapshot,
      competencies: (links.data ?? []).filter((l: any) => l.version_id === v.knowledge_version_id).map((l: any) => l.competency_id), approvals, required: v.required_approvals }];
  });
  return { appointments: appts, items };
}
