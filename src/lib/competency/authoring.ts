/* eslint-disable @typescript-eslint/no-explicit-any */
import { currentTraceId } from "@/lib/trace";

// ── CFCA COMPETENCY AUTHORING, AS A GOVERNED HQ WORKFLOW ── migration 465, owner CFCA PRODUCTION AUTHORING DIRECTION ──
//
// "Production will be the authoritative environment for actual CFCA content and clinical governance." A CFCA
// Competency Author (hq.quality.competency.author) creates and refines SHARED frameworks (hospital_id null), their
// domains and competencies -- every field the 395 clinical content hash covers: name, description, learning outcomes,
// expected level, risk -- and puts a competency forward for independent clinical review. No SQL for ordinary content.
//
//   Draft -> Submit for Review -> Clinical Approval -> Publication
//   authoring      here: create, edit, import a draft package
//   review         here: submitForReview (395). The curator becomes the submitter and an author, so the 395 trigger
//                  refuses any decision they make on it
//   approval       /super-admin/clinical-review, the Clinical Content Reviewer within their scopes (unchanged)
//   publication    the governed framework lifecycle (unchanged). Not this module.
//
// ⚠ AUTHORSHIP IS RECORDED BEFORE THE WRITE. 395's authorsOf reads audit_log rows whose entity is the competency or its
// framework. A write whose audit row failed would let its author review it later, so the audit row comes first and a
// failed one refuses the write (ids are made here so the row can name what does not exist yet).
//
// ⚠ A REVISION NEVER OVERWRITES AN APPROVAL. An approved version is an append-only 395 snapshot of the exact content,
// and a published framework is an append-only framework_versions snapshot. Editing a competency after approval makes
// it "Changed since its clinical approval" (stale) until a new version is approved -- it is never shown as approved.
//
// ⚠ NOT WHILE UNDER GOVERNANCE REVIEW. A framework that is in_review or approved is what its approver is looking at, so
// content edits are refused until it is published or reverted to draft. Archived frameworks are not edited.
//
// ⚠ SHARED ONLY. Hospital frameworks are the estate's (/api/studio/authoring) and are never touched here.

export const LAYERS = ["foundational", "profession", "advanced", "specialty", "context"] as const;
export const RISKS = ["low", "standard", "high", "critical"] as const;
export const EDITABLE = new Set(["draft", "published"]);

const CODE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){0,4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

type Ok<T> = { ok: true; value: T };
type Bad = { ok: false; error: string };

export type FrameworkInput = { code: string; name: string; description: string | null; layer: (typeof LAYERS)[number]; professionTermId: string | null; specialtyTermId: string | null; parentFrameworkId: string | null };
export type CompetencyInput = { code: string; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null; riskCategory: (typeof RISKS)[number] };

/** Pure: a shared framework's identity. A profession layer names its profession, any other layer names none. */
export function parseFramework(b: any): Ok<FrameworkInput> | Bad {
  const code = text(b?.code).toUpperCase(), name = text(b?.name), description = text(b?.description) || null;
  if (!CODE.test(code) || code.length > 40) return { ok: false, error: "A framework code is capitals, digits and hyphens, for example CF-FOUND." };
  if (name.length < 3 || name.length > 200) return { ok: false, error: "A framework name is 3 to 200 characters." };
  if (description && description.length > 2000) return { ok: false, error: "A framework description is at most 2,000 characters." };
  if (!(LAYERS as readonly string[]).includes(b?.layer)) return { ok: false, error: "Choose the framework layer." };
  const professionTermId = isId(b?.professionTermId) ? b.professionTermId : null, specialtyTermId = isId(b?.specialtyTermId) ? b.specialtyTermId : null;
  const parentFrameworkId = isId(b?.parentFrameworkId) ? b.parentFrameworkId : null;
  if (b.layer === "profession" && !professionTermId) return { ok: false, error: "A profession framework names its profession." };
  if (b.layer !== "profession" && professionTermId) return { ok: false, error: "Only a profession framework names a profession." };
  if (b.layer === "specialty" && !specialtyTermId) return { ok: false, error: "A specialty framework names its specialty." };
  return { ok: true, value: { code, name, description, layer: b.layer, professionTermId, specialtyTermId, parentFrameworkId } };
}

/** Pure: a competency's material content -- exactly the fields the 395 hash covers that authoring may set. */
export function parseCompetency(b: any): Ok<CompetencyInput> | Bad {
  const code = text(b?.code).toUpperCase(), name = text(b?.name), description = text(b?.description) || null;
  if (!CODE.test(code) || code.length > 40) return { ok: false, error: "A competency code is capitals, digits and hyphens, for example CF-CR-001." };
  if (name.length < 3 || name.length > 300) return { ok: false, error: "A competency name is 3 to 300 characters." };
  if (description && description.length > 4000) return { ok: false, error: "A competency description is at most 4,000 characters." };
  const raw = Array.isArray(b?.learningOutcomes) ? b.learningOutcomes : typeof b?.learningOutcomes === "string" ? b.learningOutcomes.split(/\r?\n/) : [];
  const learningOutcomes = raw.map(text).filter(Boolean);
  if (learningOutcomes.length > 20) return { ok: false, error: "At most 20 learning outcomes." };
  if (learningOutcomes.some((o: string) => o.length < 3 || o.length > 400)) return { ok: false, error: "Each learning outcome is 3 to 400 characters." };
  const expectedLevelId = b?.expectedLevelId == null || b.expectedLevelId === "" ? null : isId(b.expectedLevelId) ? b.expectedLevelId : undefined;
  if (expectedLevelId === undefined) return { ok: false, error: "That expected level is not valid." };
  const riskCategory = (b?.riskCategory ?? "standard") as CompetencyInput["riskCategory"];
  if (!(RISKS as readonly string[]).includes(riskCategory)) return { ok: false, error: "Choose the risk category." };
  return { ok: true, value: { code, name, description, learningOutcomes, expectedLevelId, riskCategory } };
}

export type Actor = { userId: string; name: string | null };
type Fail = { ok: false; status: number; error: string };
type Result<T extends object = object> = ({ ok: true } & T) | Fail;

/** The authorship record, FIRST. False = not recorded, so the caller must not write. */
export async function authored(admin: any, actor: Actor, action: string, entityType: "framework" | "framework_competency" | "framework_domain", entityId: string, entityName: string, detail: Record<string, unknown>): Promise<boolean> {
  const { error } = await admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: actor.userId, actor_name: actor.name, action,
    entity_type: entityType, entity_id: entityId, entity_name: entityName.slice(0, 200), new_value: detail,
  });
  return !error;
}
export const NOT_RECORDED: Fail = { ok: false, status: 503, error: "The authorship record could not be written, so nothing was changed. Try again shortly." };

/** A shared framework the curator may edit now, or why not. */
export async function editableFramework(admin: any, frameworkId: string): Promise<Result<{ fw: { id: string; name: string; pub_status: string; governed?: boolean } }>> {
  if (!isId(frameworkId)) return { ok: false, status: 400, error: "Choose a framework." };
  const { data: fw, error } = await admin.from("frameworks").select("id, name, pub_status, hospital_id, competency_layer").eq("id", frameworkId).maybeSingle();
  if (error) return { ok: false, status: 503, error: "The framework could not be read just now. Nothing has changed." };
  if (!fw || fw.hospital_id !== null) return { ok: false, status: 404, error: "That is not a shared framework." };
  const status = fw.pub_status ?? "draft";
  if (!EDITABLE.has(status)) return { ok: false, status: 409, error: status === "archived" ? "This framework is archived and is not edited." : "This framework is under governance review. Its content is what the approver is looking at, so it is not edited until it is published or returned to draft." };
  return { ok: true, fw: { id: fw.id, name: fw.name, pub_status: status, governed: typeof fw.competency_layer === "string" && fw.competency_layer.length > 0 } };
}

/**
 * FRAMEWORK-DESIGN-STUDIO-02 S5 (D2, migration 770): content of a PUBLISHED, centrally governed framework changes only in
 * its revision draft (framework-revision.ts, which the route tries first). Reaching a live write here is refused.
 */
export const REVISION_ONLY: Fail = { ok: false, status: 409, error: "Changes to a published framework go through its revision draft. Nothing has changed." };
const revisionOnly = (fw: { pub_status: string; governed?: boolean }) => fw.pub_status === "published" && !!fw.governed;

export async function frameworkOfDomain(admin: any, domainId: string) {
  if (!isId(domainId)) return null;
  const { data } = await admin.from("framework_domains").select("id, framework_id, name").eq("id", domainId).maybeSingle();
  return data ?? null;
}
export async function domainOfCompetency(admin: any, competencyId: string) {
  if (!isId(competencyId)) return null;
  const { data } = await admin.from("framework_competencies").select("id, domain_id, name, code").eq("id", competencyId).maybeSingle();
  return data ?? null;
}

/** A code already used by another competency of a SHARED framework (codes are how content travels). */
export async function competencyCodeTaken(admin: any, code: string, exceptId: string | null): Promise<boolean | null> {
  const { data, error } = await admin.from("framework_competencies").select("id, framework_domains!inner(frameworks!inner(hospital_id))").eq("code", code).is("framework_domains.frameworks.hospital_id", null).limit(5);
  if (error) return null;
  return (data ?? []).some((r: any) => r.id !== exceptId);
}

export async function createFramework(admin: any, actor: Actor, b: any): Promise<Result<{ id: string }>> {
  const p = parseFramework(b);
  if (!p.ok) return { ok: false, status: 422, error: p.error };
  const { data: same, error } = await admin.from("frameworks").select("id").eq("code", p.value.code).is("hospital_id", null).limit(1);
  if (error) return { ok: false, status: 503, error: "Frameworks could not be read just now. Nothing has changed." };
  if (same?.length) return { ok: false, status: 409, error: `A shared framework with the code ${p.value.code} already exists.` };
  if (p.value.parentFrameworkId && !(await sharedFramework(admin, p.value.parentFrameworkId))) return { ok: false, status: 422, error: "The framework it extends must be a shared framework." };
  const id = crypto.randomUUID();
  if (!(await authored(admin, actor, "cfca_framework_created", "framework", id, p.value.name, { code: p.value.code, layer: p.value.layer }))) return NOT_RECORDED;
  const { error: insErr } = await admin.from("frameworks").insert({
    id, code: p.value.code, name: p.value.name, description: p.value.description, library: "core", hospital_id: null, scope: "master", is_active: true,
    pub_status: "draft", competency_layer: p.value.layer, profession_term_id: p.value.professionTermId, specialty_term_id: p.value.specialtyTermId,
    parent_framework_id: p.value.parentFrameworkId,
  });
  return insErr ? { ok: false, status: 422, error: "The framework could not be created." } : { ok: true, id };
}

export async function updateFramework(admin: any, actor: Actor, b: any): Promise<Result> {
  const g = await editableFramework(admin, b?.frameworkId);
  if (!g.ok) return g;
  const name = text(b?.name), description = text(b?.description) || null;
  if (name.length < 3 || name.length > 200) return { ok: false, status: 422, error: "A framework name is 3 to 200 characters." };
  if (description && description.length > 2000) return { ok: false, status: 422, error: "A framework description is at most 2,000 characters." };
  if (!(await authored(admin, actor, "cfca_framework_updated", "framework", g.fw.id, name, { name, description_set: !!description }))) return NOT_RECORDED;
  const { error } = await admin.from("frameworks").update({ name, description }).eq("id", g.fw.id).is("hospital_id", null);
  return error ? { ok: false, status: 422, error: "The framework could not be saved." } : { ok: true };
}

async function sharedFramework(admin: any, id: string): Promise<boolean> {
  const { data } = await admin.from("frameworks").select("id, hospital_id").eq("id", id).maybeSingle();
  return !!data && data.hospital_id === null;
}

/**
 * The catalogue's IDENTITY -- code, layer, profession, specialty, the framework it extends -- set by configuration, and
 * only while it is a draft: once published, what it is was what its approvers saw.
 */
export async function setFrameworkIdentity(admin: any, actor: Actor, b: any): Promise<Result> {
  const g = await editableFramework(admin, b?.frameworkId);
  if (!g.ok) return g;
  if (g.fw.pub_status !== "draft") return { ok: false, status: 409, error: "A framework's code, layer, profession, specialty and parent are changed only while it is a draft." };
  const p = parseFramework({ ...b, name: g.fw.name });
  if (!p.ok) return { ok: false, status: 422, error: p.error };
  if (p.value.parentFrameworkId === g.fw.id) return { ok: false, status: 422, error: "A framework cannot extend itself." };
  const { data: same, error } = await admin.from("frameworks").select("id").eq("code", p.value.code).is("hospital_id", null).limit(5);
  if (error) return { ok: false, status: 503, error: "Frameworks could not be read just now. Nothing has changed." };
  if ((same ?? []).some((r: any) => r.id !== g.fw.id)) return { ok: false, status: 409, error: `A shared framework with the code ${p.value.code} already exists.` };
  if (p.value.parentFrameworkId && !(await sharedFramework(admin, p.value.parentFrameworkId))) return { ok: false, status: 422, error: "The framework it extends must be a shared framework." };
  if (!(await authored(admin, actor, "cfca_framework_identity_set", "framework", g.fw.id, g.fw.name, { code: p.value.code, layer: p.value.layer }))) return NOT_RECORDED;
  const { error: uErr } = await admin.from("frameworks").update({
    code: p.value.code, competency_layer: p.value.layer, profession_term_id: p.value.professionTermId, specialty_term_id: p.value.specialtyTermId, parent_framework_id: p.value.parentFrameworkId,
  }).eq("id", g.fw.id).is("hospital_id", null);
  return uErr ? { ok: false, status: 422, error: "The framework identity could not be saved." } : { ok: true };
}

const optCode = (v: unknown): string | null | undefined => {
  const c = text(v).toUpperCase();
  if (!c) return null;
  return CODE.test(c) && c.length <= 40 ? c : undefined;
};

export async function createDomain(admin: any, actor: Actor, b: any): Promise<Result<{ id: string }>> {
  const g = await editableFramework(admin, b?.frameworkId);
  if (!g.ok) return g;
  const name = text(b?.name);
  if (name.length < 2 || name.length > 200) return { ok: false, status: 422, error: "A domain name is 2 to 200 characters." };
  const { data: last } = await admin.from("framework_domains").select("sort_order").eq("framework_id", g.fw.id).order("sort_order", { ascending: false }).limit(1);
  const id = crypto.randomUUID();
  // A domain belongs to its framework's content, so its authorship is recorded on the framework.
  const code = optCode(b?.code);
  if (code === undefined) return { ok: false, status: 422, error: "A domain code is capitals, digits and hyphens." };
  if (!(await authored(admin, actor, "cfca_domain_created", "framework", g.fw.id, g.fw.name, { domain_id: id, name, code }))) return NOT_RECORDED;
  const { error } = await admin.from("framework_domains").insert({ id, framework_id: g.fw.id, name, code, sort_order: (last?.[0]?.sort_order ?? 0) + 1 });
  return error ? { ok: false, status: 422, error: "The domain could not be created." } : { ok: true, id };
}

export async function renameDomain(admin: any, actor: Actor, b: any): Promise<Result> {
  const d = await frameworkOfDomain(admin, b?.domainId);
  if (!d) return { ok: false, status: 404, error: "That domain does not exist." };
  const g = await editableFramework(admin, d.framework_id);
  if (!g.ok) return g;
  const name = text(b?.name);
  if (name.length < 2 || name.length > 200) return { ok: false, status: 422, error: "A domain name is 2 to 200 characters." };
  const code = optCode(b?.code);
  if (code === undefined) return { ok: false, status: 422, error: "A domain code is capitals, digits and hyphens." };
  if (!(await authored(admin, actor, "cfca_domain_renamed", "framework", g.fw.id, g.fw.name, { domain_id: d.id, name, code }))) return NOT_RECORDED;
  const { error } = await admin.from("framework_domains").update({ name, code }).eq("id", d.id);
  return error ? { ok: false, status: 422, error: "The domain could not be saved." } : { ok: true };
}

// ── PRACTICES AND CLINICAL PRACTICE UNITS (migration 011) ── a practice belongs to a domain, a CPU to a practice ──
// A competency names its CPU (and through it its practice): both are in the 395 hash by id, so linking or unlinking one
// is a material change. A CPU's own risk raises the number of independent approvals its competencies need (395).

export async function createPractice(admin: any, actor: Actor, b: any): Promise<Result<{ id: string }>> {
  const d = await frameworkOfDomain(admin, b?.domainId);
  if (!d) return { ok: false, status: 404, error: "That domain does not exist." };
  const g = await editableFramework(admin, d.framework_id);
  if (!g.ok) return g;
  const name = text(b?.name), description = text(b?.description) || null, code = optCode(b?.code);
  if (name.length < 2 || name.length > 200) return { ok: false, status: 422, error: "A practice name is 2 to 200 characters." };
  if (code === undefined || !code) return { ok: false, status: 422, error: "A practice has a code of capitals, digits and hyphens, for example PRA-OXY-001." };
  const id = crypto.randomUUID();
  if (!(await authored(admin, actor, "cfca_practice_created", "framework", g.fw.id, g.fw.name, { practice_id: id, code, domain_id: d.id }))) return NOT_RECORDED;
  const { error } = await admin.from("practices").insert({ id, domain_id: d.id, name, description, code, sort_order: 1 });
  return error ? { ok: false, status: 422, error: "The practice could not be created." } : { ok: true, id };
}

async function practiceInFramework(admin: any, practiceId: string): Promise<{ id: string; domain_id: string; framework_id: string } | null> {
  if (!isId(practiceId)) return null;
  const { data } = await admin.from("practices").select("id, domain_id, framework_domains!inner(framework_id)").eq("id", practiceId).maybeSingle();
  return data ? { id: data.id, domain_id: data.domain_id, framework_id: data.framework_domains.framework_id } : null;
}

export async function createCpu(admin: any, actor: Actor, b: any): Promise<Result<{ id: string }>> {
  const pr = await practiceInFramework(admin, b?.practiceId);
  if (!pr) return { ok: false, status: 404, error: "That practice does not exist." };
  const g = await editableFramework(admin, pr.framework_id);
  if (!g.ok) return g;
  const name = text(b?.name), description = text(b?.description) || null, code = optCode(b?.code);
  const risk = (b?.riskCategory ?? "standard") as string, complexity = Number(b?.complexity ?? 2), months = Number(b?.reassessmentMonths ?? 12);
  if (name.length < 3 || name.length > 200) return { ok: false, status: 422, error: "A CPU name is 3 to 200 characters." };
  if (code === undefined || !code) return { ok: false, status: 422, error: "A CPU has a code of capitals, digits and hyphens, for example CPU-OXYSAFE-001." };
  if (!(RISKS as readonly string[]).includes(risk)) return { ok: false, status: 422, error: "Choose the CPU risk category." };
  if (!Number.isInteger(complexity) || complexity < 1 || complexity > 5) return { ok: false, status: 422, error: "CPU complexity is 1 to 5." };
  if (!Number.isInteger(months) || months < 1 || months > 120) return { ok: false, status: 422, error: "Reassessment is 1 to 120 months." };
  const id = crypto.randomUUID();
  if (!(await authored(admin, actor, "cfca_cpu_created", "framework", g.fw.id, g.fw.name, { cpu_id: id, code, practice_id: pr.id }))) return NOT_RECORDED;
  const { error } = await admin.from("clinical_practice_units").insert({ id, practice_id: pr.id, name, description, code, risk_category: risk, complexity, reassessment_months: months, pub_status: "draft", sort_order: 1 });
  return error ? { ok: false, status: 422, error: "The CPU could not be created." } : { ok: true, id };
}

/** The CPU a competency may name: a CPU of a practice in the SAME framework. Returns its practice, or why not. */
export async function cpuFor(admin: any, frameworkId: string, cpuId: unknown): Promise<{ ok: true; practiceId: string | null; cpuId: string | null } | { ok: false; error: string }> {
  if (cpuId == null || cpuId === "") return { ok: true, practiceId: null, cpuId: null };
  if (!isId(cpuId)) return { ok: false, error: "That CPU is not valid." };
  const { data } = await admin.from("clinical_practice_units").select("id, practice_id").eq("id", cpuId).maybeSingle();
  const pr = data ? await practiceInFramework(admin, data.practice_id) : null;
  if (!data || !pr || pr.framework_id !== frameworkId) return { ok: false, error: "A competency names a CPU of its own framework." };
  return { ok: true, practiceId: pr.id, cpuId: data.id };
}

export const competencyRow = (v: CompetencyInput) => ({ code: v.code, name: v.name, description: v.description, learning_outcomes: v.learningOutcomes, expected_level_id: v.expectedLevelId, risk_category: v.riskCategory });

export async function createCompetency(admin: any, actor: Actor, b: any): Promise<Result<{ id: string }>> {
  const d = await frameworkOfDomain(admin, b?.domainId);
  if (!d) return { ok: false, status: 404, error: "That domain does not exist." };
  const g = await editableFramework(admin, d.framework_id);
  if (!g.ok) return g;
  if (revisionOnly(g.fw)) return REVISION_ONLY;
  const p = parseCompetency(b);
  if (!p.ok) return { ok: false, status: 422, error: p.error };
  const taken = await competencyCodeTaken(admin, p.value.code, null);
  if (taken === null) return { ok: false, status: 503, error: "Competency codes could not be checked just now. Nothing has changed." };
  if (taken) return { ok: false, status: 409, error: `A shared competency with the code ${p.value.code} already exists.` };
  const cpu = await cpuFor(admin, g.fw.id, b?.cpuId);
  if (!cpu.ok) return { ok: false, status: 422, error: cpu.error };
  const { data: last } = await admin.from("framework_competencies").select("sort_order").eq("domain_id", d.id).order("sort_order", { ascending: false }).limit(1);
  const id = crypto.randomUUID();
  if (!(await authored(admin, actor, "cfca_competency_created", "framework_competency", id, p.value.name, { code: p.value.code, framework_id: g.fw.id }))) return NOT_RECORDED;
  const { error } = await admin.from("framework_competencies").insert({ id, domain_id: d.id, sort_order: (last?.[0]?.sort_order ?? 0) + 1, ...competencyRow(p.value), practice_id: cpu.practiceId, cpu_id: cpu.cpuId });
  return error ? { ok: false, status: 422, error: "The competency could not be created." } : { ok: true, id };
}

/** Edit a competency's material content. After approval this makes it stale (never approved) until re-approved. */
export async function updateCompetency(admin: any, actor: Actor, b: any): Promise<Result> {
  const c = await domainOfCompetency(admin, b?.competencyId);
  if (!c) return { ok: false, status: 404, error: "That competency does not exist." };
  const d = await frameworkOfDomain(admin, c.domain_id);
  if (!d) return { ok: false, status: 404, error: "That competency's domain does not exist." };
  const g = await editableFramework(admin, d.framework_id);
  if (!g.ok) return g;
  if (revisionOnly(g.fw)) return REVISION_ONLY;
  const p = parseCompetency(b);
  if (!p.ok) return { ok: false, status: 422, error: p.error };
  const taken = await competencyCodeTaken(admin, p.value.code, c.id);
  if (taken === null) return { ok: false, status: 503, error: "Competency codes could not be checked just now. Nothing has changed." };
  if (taken) return { ok: false, status: 409, error: `A shared competency with the code ${p.value.code} already exists.` };
  // The CPU only changes when the request names one (or null to unlink it): absent keeps what is there.
  const cpu = b && "cpuId" in b ? await cpuFor(admin, g.fw.id, b.cpuId) : null;
  if (cpu && !cpu.ok) return { ok: false, status: 422, error: cpu.error };
  if (!(await authored(admin, actor, "cfca_competency_updated", "framework_competency", c.id, p.value.name, { code: p.value.code, framework_id: g.fw.id }))) return NOT_RECORDED;
  const { error } = await admin.from("framework_competencies").update({ ...competencyRow(p.value), ...(cpu && cpu.ok ? { practice_id: cpu.practiceId, cpu_id: cpu.cpuId } : {}) }).eq("id", c.id);
  return error ? { ok: false, status: 422, error: "The competency could not be saved." } : { ok: true };
}

// ── A DRAFT PACKAGE: one framework, its domains and competencies, created in one governed act ─────────────────────
//
// For bringing existing content (CF-FOUND's eight) into production as a DRAFT, NOT CLINICALLY REVIEWED, without SQL.
// The expected level travels as (default scale, score), because level ids differ between environments. Provenance
// (where it came from, its source ids) is recorded in the authorship row, never in the content. Nothing is approved,
// put forward or published by an import: approvals that do not exist are not imported, and none are implied.

// CFCA-STUDIO-P1 (migration 670): a competency may carry its assessment CRITERIA, each kept as its own skill row in
// its source wording, classified by component (Clinical Skills, Knowledge, Knowledge Application) with where it
// came from -- never compressed into learning outcomes. It may name PARENTS: existing shared competencies it
// extends, by framework and competency name (ids differ between environments). A parent is linked by a
// Holdings-scope "inherited" dependency, so the parent record is neither copied nor changed. A profession may be
// named by its taxonomy value instead of an id, for the same reason.
export type PackageCriterion = { component: string; text: string; sourceRef?: string | null };
/** frameworkId (optional) settles a framework name that is not unique on an environment (staging holds two Core Nursing). */
export type PackageParent = { framework: string; competency: string; frameworkId?: string };
export type DraftPackage = {
  framework: { code: string; name: string; description: string | null; layer: string; professionTermId?: string | null; specialtyTermId?: string | null; profession?: string };
  /** area: the Area the domain sits in (FRAMEWORK-DESIGN-STUDIO-02 D1). Carried through, not yet written (S3 adds Areas). */
  domains: { name: string; area?: string | null; competencies: { code: string; name: string; description: string | null; learningOutcomes: string[]; expectedLevel: { score: number } | null; riskCategory: string;
    criteria?: PackageCriterion[]; parents?: PackageParent[] }[] }[];
  provenance: Record<string, unknown>;
};
const COMPONENT = /^[a-z][a-z0-9_]{2,40}$/;
export const MAX_CRITERIA = 300;

/** Pure: a competency's criteria and parents in a package, or the first reason they are not acceptable. */
export function checkCriteria(c: any): string | null {
  const criteria = c?.criteria ?? [];
  if (!Array.isArray(criteria) || criteria.length > MAX_CRITERIA) return `at most ${MAX_CRITERIA} criteria, as a list.`;
  for (const [i, k] of criteria.entries()) {
    if (!COMPONENT.test(String(k?.component ?? ""))) return `criterion ${i + 1} needs a component code.`;
    const t = typeof k?.text === "string" ? k.text.trim() : "";
    if (t.length < 3 || t.length > 2000) return `criterion ${i + 1} is 3 to 2,000 characters.`;
    if (k?.sourceRef != null && (typeof k.sourceRef !== "string" || k.sourceRef.length > 300)) return `criterion ${i + 1} has a source reference of at most 300 characters.`;
  }
  const parents = c?.parents ?? [];
  if (!Array.isArray(parents) || parents.length > 10) return "at most 10 parents, as a list.";
  for (const p of parents) if (text(p?.framework).length < 2 || text(p?.competency).length < 2) return "each parent names its framework and competency.";
  return null;
}


/** Pure: a package's domains and competencies are whole and valid, or the first reason they are not. */
export function checkPackageBody(pkg: any): Bad | null {
  const domains = Array.isArray(pkg?.domains) ? pkg.domains : [];
  if (!domains.length || domains.length > 40) return { ok: false, error: "A package has 1 to 40 domains." };
  const codes = new Set<string>();
  for (const d of domains) {
    if (text(d?.name).length < 2) return { ok: false, error: "Every domain has a name." };
    if (d?.area != null && (typeof d.area !== "string" || text(d.area).length > 200)) return { ok: false, error: "A domain's area is a name of at most 200 characters." };
    const comps = Array.isArray(d?.competencies) ? d.competencies : [];
    if (comps.length > 200) return { ok: false, error: "At most 200 competencies in one domain." };
    for (const c of comps) {
      const p = parseCompetency({ ...c, expectedLevelId: null });
      if (!p.ok) return { ok: false, error: `${text(c?.code) || "A competency"}: ${p.error}` };
      if (codes.has(p.value.code)) return { ok: false, error: `The code ${p.value.code} appears twice in the package.` };
      codes.add(p.value.code);
      const crit = checkCriteria(c);
      if (crit) return { ok: false, error: `${p.value.code}: ${crit}` };
      if (c?.expectedLevel != null && !(Number.isInteger(c.expectedLevel.score) && c.expectedLevel.score >= 0 && c.expectedLevel.score <= 10)) return { ok: false, error: `${p.value.code}: the expected level is a score on the default scale.` };
    }
  }
  if (pkg?.provenance != null && (typeof pkg.provenance !== "object" || JSON.stringify(pkg.provenance).length > 8000)) return { ok: false, error: "The provenance is a small object." };
  return null;
}

/** Pure: a package is whole and valid, or the first reason it is not. Nothing is written for a bad package. */
export function checkPackage(pkg: any): Ok<DraftPackage> | Bad {
  const f = parseFramework(pkg?.framework);
  if (!f.ok) return f;
  const body = checkPackageBody(pkg);
  if (body) return body;
  return { ok: true, value: pkg as DraftPackage };
}

type ImportResult = Result<{ id: string; competencies: number; criteria: number; parents: number; resumed: boolean; appended?: boolean }>;
type Refs = { levels: Map<number, string>; comps: string[]; parentIds: Map<string, string> };
type Have = { domains: Map<string, string>; comps: Map<string, string>; skills: Map<string, number>; deps: Map<string, number> };
const parentKey = (x: PackageParent) => `${text(x.framework)}\u0000${text(x.competency)}\u0000${isId(x.frameworkId) ? x.frameworkId : ""}`;

/**
 * Everything a package names on THIS environment -- expected levels by score, assessment components, parent
 * competencies -- resolved BEFORE anything is written, so a package that names an unknown one changes nothing.
 */
async function resolveRefs(admin: any, p: DraftPackage): Promise<Refs | Fail> {
  const scores = [...new Set(p.domains.flatMap(d => d.competencies.map(c => c.expectedLevel?.score)).filter((s): s is number => typeof s === "number"))];
  const levels = new Map<number, string>();
  if (scores.length) {
    const { data: lv, error: lErr } = await admin.from("scoring_levels").select("id, score, scoring_scales!inner(is_default)").eq("scoring_scales.is_default", true).in("score", scores);
    if (lErr) return { ok: false, status: 503, error: "The expected levels could not be read just now. Nothing has changed." };
    for (const l of lv ?? []) levels.set(l.score, l.id);
    const missing = scores.filter(s => !levels.has(s));
    if (missing.length) return { ok: false, status: 422, error: `The default scale has no level with score ${missing.join(", ")}.` };
  }
  const all = p.domains.flatMap(d => d.competencies);
  const comps = [...new Set(all.flatMap(c => (c.criteria ?? []).map(k => k.component)))];
  if (comps.length) {
    const { data: reg, error: rErr } = await admin.from("competency_assessment_component").select("code, is_active").in("code", comps);
    if (rErr) return { ok: false, status: 503, error: "The assessment components could not be read just now (migration 660). Nothing has changed." };
    const live = new Set((reg ?? []).filter((r: any) => r.is_active !== false).map((r: any) => r.code));
    const unknown = comps.filter(c => !live.has(c));
    if (unknown.length) return { ok: false, status: 422, error: `Unknown or retired assessment component: ${unknown.join(", ")}.` };
  }
  const parentIds = new Map<string, string>();
  for (const k of new Set(all.flatMap(c => (c.parents ?? []).map(parentKey)))) {
    const [fw, name, fwId] = k.split("\u0000");
    let q = admin.from("framework_competencies").select("id, framework_domains!inner(framework_id, frameworks!inner(name, hospital_id))")
      .eq("name", name).eq("framework_domains.frameworks.name", fw).is("framework_domains.frameworks.hospital_id", null);
    if (fwId) q = q.eq("framework_domains.framework_id", fwId);
    const { data: hit, error: hErr } = await q.limit(2);
    if (hErr) return { ok: false, status: 503, error: "The parent competencies could not be read just now. Nothing has changed." };
    if ((hit ?? []).length !== 1) return { ok: false, status: 422, error: `The parent "${name}" in ${fw} was ${hit?.length ? "found more than once" : "not found"} among shared frameworks. Nothing has changed.` };
    parentIds.set(k, hit[0].id);
  }
  return { levels, comps, parentIds };
}

export async function importDraftPackage(admin: any, actor: Actor, raw: any, opts: { mode?: "resume" | "append" } = {}): Promise<ImportResult> {
  if (opts.mode === "append" || raw?.mode === "append") return appendToDraft(admin, actor, raw);
  // A profession named by its value is resolved here, before anything is checked or written.
  let pkg = raw;
  if (raw?.framework && !raw.framework.professionTermId && typeof raw.framework.profession === "string" && raw.framework.profession.trim()) {
    const { data: t, error: tErr } = await admin.from("taxonomy_terms").select("id, taxonomies!inner(kind)").eq("value", raw.framework.profession.trim()).eq("taxonomies.kind", "profession").limit(2);
    if (tErr) return { ok: false, status: 503, error: "The profession could not be read just now. Nothing has changed." };
    if ((t ?? []).length !== 1) return { ok: false, status: 422, error: `No single profession is called "${raw.framework.profession.trim()}".` };
    pkg = { ...raw, framework: { ...raw.framework, professionTermId: t[0].id } };
  }
  const v = checkPackage(pkg);
  if (!v.ok) return { ok: false, status: 422, error: v.error };
  const p = v.value;
  const { data: same, error: sErr } = await admin.from("frameworks").select("id, name, pub_status").eq("code", p.framework.code.toUpperCase()).is("hospital_id", null).limit(1);
  if (sErr) return { ok: false, status: 503, error: "Frameworks could not be read just now. Nothing has changed." };
  // RESUME (CFCA-STUDIO-P1, 29 Oct 2026). A large package can outlast one request: the first NUR-CCF import in
  // production stopped cleanly after 24 of 30 competencies. Pasting the SAME package again continues the same DRAFT:
  // its domains are reused by name, competencies already there are kept, and only what is missing is written. It is
  // refused unless the framework is still a draft and holds nothing the package does not name, so it never merges
  // into a framework someone has edited or put forward.
  const existing = same?.[0] ?? null;
  const have: Have = { domains: new Map<string, string>(), comps: new Map<string, string>(), skills: new Map<string, number>(), deps: new Map<string, number>() };
  if (existing) {
    if ((existing.pub_status ?? "draft") !== "draft") return { ok: false, status: 409, error: `A shared framework with the code ${p.framework.code.toUpperCase()} already exists and is no longer a draft. Edit it instead of importing again.` };
    const { data: ds, error: dErr } = await admin.from("framework_domains").select("id, name").eq("framework_id", existing.id);
    if (dErr) return { ok: false, status: 503, error: "The existing draft could not be read just now. Nothing has changed." };
    for (const d of ds ?? []) have.domains.set(d.name, d.id);
    const { data: cs, error: cErr } = (ds ?? []).length ? await admin.from("framework_competencies").select("id, code, domain_id").in("domain_id", (ds ?? []).map((d: any) => d.id)) : { data: [], error: null };
    if (cErr) return { ok: false, status: 503, error: "The existing draft could not be read just now. Nothing has changed." };
    const named = new Set(p.domains.flatMap(d => d.competencies.map(c => String(c.code).toUpperCase())));
    const foreign = (cs ?? []).filter((c: any) => !named.has(String(c.code ?? "").toUpperCase()));
    if (foreign.length) return { ok: false, status: 409, error: `The draft ${p.framework.code.toUpperCase()} holds ${foreign.length} competenc${foreign.length === 1 ? "y" : "ies"} this package does not name, so it is not continued. Edit it on the authoring page instead, or add new competencies with an append import.` };
    for (const c of cs ?? []) have.comps.set(String(c.code).toUpperCase(), c.id);
    const ids = [...have.comps.values()];
    if (ids.length) {
      const [sk, dp] = await Promise.all([
        admin.from("competency_skills").select("competency_id").in("competency_id", ids).limit(20000),
        admin.from("competency_dependencies").select("source_competency_id").in("source_competency_id", ids).limit(20000),
      ]);
      if (sk.error || dp.error) return { ok: false, status: 503, error: "The existing draft could not be read just now. Nothing has changed." };
      for (const r of sk.data ?? []) have.skills.set(r.competency_id, (have.skills.get(r.competency_id) ?? 0) + 1);
      for (const r of dp.data ?? []) have.deps.set(r.source_competency_id, (have.deps.get(r.source_competency_id) ?? 0) + 1);
    }
  }
  for (const d of p.domains) for (const c of d.competencies) {
    if (have.comps.has(String(c.code).toUpperCase())) continue;
    const t = await competencyCodeTaken(admin, String(c.code).toUpperCase(), null);
    if (t !== false) return { ok: false, status: t === null ? 503 : 409, error: t === null ? "Competency codes could not be checked just now. Nothing has changed." : `A shared competency with the code ${String(c.code).toUpperCase()} already exists.` };
  }
  const refs = await resolveRefs(admin, p);
  if ("ok" in refs) return refs;

  let frameworkId: string;
  if (existing) {
    frameworkId = existing.id;
    await authored(admin, actor, "cfca_draft_import_resumed", "framework", existing.id, existing.name, { provenance: p.provenance ?? null, kept: have.comps.size });
  } else {
    const created = await createFramework(admin, actor, p.framework);
    if (!created.ok) return created;
    frameworkId = created.id;
    // The package's provenance, on the framework's authorship trail (never in its content).
    await authored(admin, actor, "cfca_draft_imported", "framework", created.id, p.framework.name, { provenance: p.provenance ?? null, domains: p.domains.length });
  }
  const w = await writePackage(admin, actor, frameworkId, p, have, refs, {
    stopped: "The framework is a draft: paste the same package again to continue.",
    paused: n => `Paused to stay within the time limit, with ${n} more competenc${n === 1 ? "y" : "ies"} imported. The draft is safe and complete so far: paste the same package again to continue.`,
  });
  return w.ok ? { ...w, id: frameworkId, resumed: !!existing } : w;
}

/** The domains, competencies, criteria and parent links of a checked package, each competency after its authorship row. */
async function writePackage(admin: any, actor: Actor, frameworkId: string, p: DraftPackage, have: Have, refs: Refs,
  say: { stopped: string; paused: (n: number, codes: string[]) => string }): Promise<Result<{ competencies: number; criteria: number; parents: number }>> {
  // One request has a time limit. The import pauses cleanly between competencies well before it.
  const started = Date.now(), BUDGET_MS = 40_000;
  let n = 0, nCriteria = 0, nParents = 0;
  const added: string[] = [];
  for (const d of p.domains) {
    let domainId = have.domains.get(d.name);
    if (!domainId) {
      const dom = await createDomain(admin, actor, { frameworkId, name: d.name });
      if (!dom.ok) return { ok: false, status: dom.status, error: `Stopped at domain "${d.name}": ${dom.error} ${say.stopped}` };
      domainId = dom.id; have.domains.set(d.name, dom.id);
    }
    for (const c of d.competencies) {
      if (Date.now() - started > BUDGET_MS) return { ok: false, status: 503, error: say.paused(n, added) };
      const code = String(c.code).toUpperCase();
      let compId = have.comps.get(code);
      if (!compId) {
        const r = await createCompetency(admin, actor, { ...c, domainId, expectedLevelId: c.expectedLevel ? refs.levels.get(c.expectedLevel.score) : null });
        if (!r.ok) return { ok: false, status: r.status, error: `Stopped at ${c.code}: ${r.error} ${say.stopped}` };
        compId = r.id; n++; added.push(code);
      }
      const r = { id: compId };
      const allCriteria = c.criteria ?? [], allParents = [...new Set((c.parents ?? []).map(parentKey))];
      // A competency already holding exactly the package's criteria (or links) is complete. One holding a
      // different number was changed by hand, and is left for the author rather than guessed at.
      const hasK = have.skills.get(compId) ?? 0, hasP = have.deps.get(compId) ?? 0;
      if (hasK && hasK !== allCriteria.length) return { ok: false, status: 409, error: `${c.code} already holds ${hasK} criteria and the package names ${allCriteria.length}. Finish it on the authoring page.` };
      if (hasP && hasP !== allParents.length) return { ok: false, status: 409, error: `${c.code} already holds ${hasP} parent links and the package names ${allParents.length}. Finish it on the authoring page.` };
      const criteria = hasK ? [] : allCriteria, parents = hasP ? [] : allParents;
      if (criteria.length || parents.length) {
        if (!(await authored(admin, actor, "cfca_criteria_imported", "framework_competency", r.id, c.name, {
          criteria: criteria.length, by_component: Object.fromEntries(refs.comps.map(k => [k, criteria.filter(x => x.component === k).length])), parents: parents.map(k => refs.parentIds.get(k)),
        }))) return { ...NOT_RECORDED, error: `Stopped at ${c.code}: ${NOT_RECORDED.error}` };
      }
      if (criteria.length) {
        const { error: kErr } = await admin.from("competency_skills").insert(criteria.map((k, i) => ({
          competency_id: r.id, name: k.text.trim(), sort_order: i + 1, component_code: k.component, source_ref: k.sourceRef ?? null, is_active: true,
        })));
        if (kErr) return { ok: false, status: 422, error: `Stopped at ${c.code}: its criteria could not be saved (migration 670 is needed). The framework is a draft: finish it on the authoring page.` };
        nCriteria += criteria.length;
      }
      if (parents.length) {
        const { error: dErr } = await admin.from("competency_dependencies").insert(parents.map(k => ({
          hospital_id: null, source_competency_id: r.id, target_competency_id: refs.parentIds.get(k), dependency_type: "inherited",
          notes: "Extends this competency (draft import).", created_by: actor.userId, created_by_name: actor.name,
        })));
        if (dErr) return { ok: false, status: 422, error: `Stopped at ${c.code}: its parent links could not be saved. The framework is a draft: finish it on the authoring page.` };
        nParents += parents.length;
      }
    }
  }
  return { ok: true, competencies: n, criteria: nCriteria, parents: nParents };
}

// ── APPEND (FRAMEWORK-DESIGN-STUDIO-02 S1) ── new competencies into an existing DRAFT, nothing existing touched ──────
//
// The package names the framework by its code and lists ONLY new competencies (and, if needed, new domains). Its
// framework identity comes from the framework itself, so it is never re-declared. Existing competencies are neither
// required nor read for change: they are counted, never written. Refused whole when the framework is not a draft or
// any listed code already exists on a shared framework. Every competency gets the same authorship rows as any import.

export type AppendPlan = {
  framework: { id: string; code: string; name: string };
  package: DraftPackage;
  /** Competencies already in the draft: untouched. */
  unchanged: number;
  /** The draft's domains: a package domain of the same name is reused. */
  existingDomains: { id: string; name: string }[];
  /** Domain names the package adds (the rest are existing domains, matched by name). */
  newDomains: string[];
  /** Why the package cannot be appended (empty = it can). code names the competency where there is one. */
  problems: { code: string | null; message: string }[];
};

/** Read-only: what an append would do, and why it could not. Used by the preview and by the append itself. */
export async function planAppend(admin: any, raw: any): Promise<Fail | AppendPlan> {
  const code = text(raw?.framework?.code).toUpperCase();
  if (!CODE.test(code)) return { ok: false, status: 422, error: "Name the framework to add to by its code." };
  const { data: fws, error } = await admin.from("frameworks").select("id, code, name, description, pub_status, competency_layer").eq("code", code).is("hospital_id", null).limit(1);
  if (error) return { ok: false, status: 503, error: "Frameworks could not be read just now. Nothing has changed." };
  const fw = fws?.[0];
  if (!fw) return { ok: false, status: 404, error: `No shared framework has the code ${code}.` };
  if ((fw.pub_status ?? "draft") !== "draft") return { ok: false, status: 409, error: `${code} is not a draft, so nothing is appended to it. Changes to a published framework go through a revision draft.` };
  const body = checkPackageBody(raw);
  if (body) return { ok: false, status: 422, error: body.error };
  const pkg: DraftPackage = { ...raw, framework: { code, name: fw.name, description: fw.description ?? null, layer: fw.competency_layer ?? "" } };
  const listed = pkg.domains.flatMap(d => d.competencies.map(c => String(c.code).toUpperCase()));
  if (!listed.length) return { ok: false, status: 422, error: "The package lists no new competencies." };
  const { data: ds, error: dErr } = await admin.from("framework_domains").select("id, name").eq("framework_id", fw.id);
  if (dErr) return { ok: false, status: 503, error: "The draft could not be read just now. Nothing has changed." };
  const domainIds = (ds ?? []).map((d: any) => d.id);
  const { data: cs, error: cErr } = domainIds.length ? await admin.from("framework_competencies").select("id").in("domain_id", domainIds) : { data: [], error: null };
  if (cErr) return { ok: false, status: 503, error: "The draft could not be read just now. Nothing has changed." };
  const names = new Set((ds ?? []).map((d: any) => d.name));
  const problems: AppendPlan["problems"] = [];
  for (const c of listed) {
    const t = await competencyCodeTaken(admin, c, null);
    if (t === null) return { ok: false, status: 503, error: "Competency codes could not be checked just now. Nothing has changed." };
    if (t) problems.push({ code: c, message: `A shared competency with the code ${c} already exists. An append adds only new competencies.` });
  }
  return {
    framework: { id: fw.id, code, name: fw.name }, package: pkg, unchanged: (cs ?? []).length,
    newDomains: [...new Set(pkg.domains.map(d => d.name).filter(n => !names.has(n)))], problems,
    existingDomains: (ds ?? []).map((d: any) => ({ id: d.id, name: d.name })),
  };
}

async function appendToDraft(admin: any, actor: Actor, raw: any): Promise<ImportResult> {
  const plan = await planAppend(admin, raw);
  if ("ok" in plan) return plan;
  if (plan.problems.length) return { ok: false, status: 409, error: `${plan.problems.map(x => x.message).join(" ")} Nothing has changed.` };
  const p = plan.package;
  const refs = await resolveRefs(admin, p);
  if ("ok" in refs) return refs;
  const have: Have = { domains: new Map(plan.existingDomains.map(d => [d.name, d.id])), comps: new Map(), skills: new Map(), deps: new Map() };
  await authored(admin, actor, "cfca_draft_import_appended", "framework", plan.framework.id, plan.framework.name, {
    provenance: p.provenance ?? null, adds: p.domains.reduce((n, d) => n + d.competencies.length, 0), new_domains: plan.newDomains, unchanged: plan.unchanged,
  });
  const w = await writePackage(admin, actor, plan.framework.id, p, have, refs, {
    stopped: "The framework is a draft: what was added before it is kept.",
    paused: (n, codes) => `Paused to stay within the time limit, with ${n} competenc${n === 1 ? "y" : "ies"} added${codes.length ? ` (${codes.join(", ")})` : ""}. The draft is safe: append the rest in a package without these codes.`,
  });
  return w.ok ? { ...w, id: plan.framework.id, resumed: false, appended: true } : w;
}

/** Read-only: planAppend plus the environment references (levels, components, parents), all as problems. */
export async function previewAppend(admin: any, raw: any): Promise<Fail | AppendPlan> {
  const plan = await planAppend(admin, raw);
  if ("ok" in plan) return plan;
  const refs = await resolveRefs(admin, plan.package);
  if ("ok" in refs) {
    if (refs.status === 503) return refs;
    return { ...plan, problems: [...plan.problems, { code: null, message: refs.error }] };
  }
  return plan;
}
