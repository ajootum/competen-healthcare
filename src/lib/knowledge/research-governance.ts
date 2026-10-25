/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbRefusal } from "./governance";

// ── CKRI RESEARCH GOVERNANCE: purposes and project approval ── COMPETEN-KNOWLEDGE-RESEARCH-01 s3, migration 440 ──────
//
// Thin by design. Every rule -- who may activate a purpose or decide a project, independence from the proposer, the
// lifecycle, the ethics record before recruitment, the agreement for an institution sponsor, aggregate-only access,
// the cohort floor -- is the 440 trigger's and CHECK's. This file sends the session's person as the actor and turns a
// refusal into its sentence. Nothing a browser sends picks the actor, the decider, a status time or the data access.

type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
const CODE = /^[a-z][a-z0-9_]{2,60}$/;
const PROJECT_CODE = /^[a-z][a-z0-9_-]{2,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPurpose(admin: any, me: string, p: { code: string; permission: string; label: string; description: string; requiresEthics: boolean }): Promise<R<{ id: string }>> {
  if (!CODE.test(p.code)) return { ok: false, error: "A purpose code is lowercase letters, digits and underscores." };
  if (p.permission !== "collective_analytics" && p.permission !== "research_study") return { ok: false, error: "A purpose rests on collective analytics or a research study." };
  const { data, error } = await admin.from("ckri_purpose").insert({
    code: p.code, permission: p.permission, label: p.label, description: p.description,
    requires_ethics: p.permission === "research_study" ? true : p.requiresEthics, created_by: me,
  }).select("id").single();
  return error ? { ok: false, error: dbRefusal(error, "The purpose could not be saved.") } : { ok: true, id: data.id };
}

export async function activatePurpose(admin: any, me: string, code: string): Promise<R> {
  const { data, error } = await admin.from("ckri_purpose").update({ status: "active", activated_by: me }).eq("code", code).eq("status", "draft").select("id");
  if (error) return { ok: false, error: dbRefusal(error, "The purpose could not be activated.") };
  return data?.length ? { ok: true } : { ok: false, error: "No draft purpose has that code." };
}

export async function retirePurpose(admin: any, code: string): Promise<R> {
  const { data, error } = await admin.from("ckri_purpose").update({ status: "retired" }).eq("code", code).eq("status", "active").select("id");
  if (error) return { ok: false, error: dbRefusal(error, "The purpose could not be retired.") };
  return data?.length ? { ok: true } : { ok: false, error: "No active purpose has that code." };
}

export async function proposeProject(admin: any, me: string, p: { code: string; title: string; purposeCode: string; sponsor: string; institutionRef: string | null; agreementRef: string | null; minCohort: number }): Promise<R<{ id: string }>> {
  if (!PROJECT_CODE.test(p.code)) return { ok: false, error: "A project code is lowercase letters, digits, hyphens and underscores." };
  if (p.sponsor !== "platform" && p.sponsor !== "institution") return { ok: false, error: "A project is sponsored by the platform or an institution." };
  if (p.sponsor === "institution" && !(p.institutionRef && UUID.test(p.institutionRef))) return { ok: false, error: "An institution project names the institution." };
  const { data, error } = await admin.from("ckri_research_project").insert({
    code: p.code, title: p.title, purpose_code: p.purposeCode, sponsor: p.sponsor,
    institution_ref: p.sponsor === "institution" ? p.institutionRef : null, agreement_ref: p.sponsor === "institution" ? p.agreementRef : null,
    min_cohort: p.minCohort, proposed_by: me, changed_by: me,
  }).select("id").single();
  return error ? { ok: false, error: dbRefusal(error, "The project could not be saved.") } : { ok: true, id: data.id };
}

export type ProjectMove = "submit" | "return" | "approve" | "reject" | "recruit" | "close" | "withdraw";
const TO: Record<ProjectMove, string> = { submit: "submitted", return: "draft", approve: "approved", reject: "rejected", recruit: "recruiting", close: "closed", withdraw: "withdrawn" };

/** Move a project one step. The database decides whether this person may make this move now (440). */
export async function moveProject(admin: any, me: string, projectId: string, move: ProjectMove, x: { note?: string | null; retainUntil?: string | null } = {}): Promise<R> {
  if (!UUID.test(projectId)) return { ok: false, error: "Unknown project." };
  const patch: Record<string, unknown> = { status: TO[move], changed_by: me };
  if (move === "approve" || move === "reject") {
    patch.decided_by = me;
    patch.decision_note = x.note ?? null;
  }
  if (move === "approve") {
    if (!x.retainUntil || !/^\d{4}-\d{2}-\d{2}$/.test(x.retainUntil)) return { ok: false, error: "An approval sets the date the project's outputs are kept until." };
    patch.retain_until = x.retainUntil;
  }
  const { data, error } = await admin.from("ckri_research_project").update(patch).eq("id", projectId).select("id");
  if (error) return { ok: false, error: dbRefusal(error, "That could not be done.") };
  return data?.length ? { ok: true } : { ok: false, error: "Unknown project." };
}

/** Record the ethics decision a research ethics committee made. Governors only (440). */
export async function recordEthics(admin: any, me: string, projectId: string, e: { body: string; ref: string; decidedOn: string }): Promise<R> {
  if (!UUID.test(projectId)) return { ok: false, error: "Unknown project." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.decidedOn)) return { ok: false, error: "Give the date of the ethics decision." };
  const { data, error } = await admin.from("ckri_research_project")
    .update({ ethics_body: e.body, ethics_ref: e.ref, ethics_decided_at: `${e.decidedOn}T00:00:00Z`, changed_by: me }).eq("id", projectId).select("id");
  if (error) return { ok: false, error: dbRefusal(error, "The ethics record could not be saved.") };
  return data?.length ? { ok: true } : { ok: false, error: "Unknown project." };
}

export async function governanceOverview(admin: any) {
  const [purposes, projects, part] = await Promise.all([
    admin.from("ckri_purpose").select("code, permission, label, description, requires_ethics, status, activated_at, retired_at").order("created_at"),
    admin.from("ckri_research_project").select("id, code, title, purpose_code, sponsor, status, min_cohort, ethics_ref, ethics_body, decided_at, opened_at, retain_until, updated_at").order("updated_at", { ascending: false }).limit(100),
    admin.from("ckri_participation").select("permission, scope_key, status"),
  ]);
  if (purposes.error || projects.error || part.error) return null;
  // Counts only. Who chose what is never listed to anyone but the person themselves.
  const counts: Record<string, { granted: number; withdrawn: number }> = {};
  for (const r of part.data ?? []) {
    const k = r.permission === "collective_analytics" ? "collective_analytics" : `study:${r.scope_key}`;
    counts[k] ??= { granted: 0, withdrawn: 0 };
    counts[k][r.status === "granted" ? "granted" : "withdrawn"]++;
  }
  return { purposes: purposes.data ?? [], projects: projects.data ?? [], counts };
}
