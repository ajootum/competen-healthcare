/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { runOwnedAi, isBudgetRefusal } from "@/lib/ai/allowance";
import { resolveOwner } from "@/lib/ai/consumption";
import { loadRequiredApprovals } from "@/lib/competency/clinical-review";
import { BLUEPRINT_SCHEMA, blueprintCompetencies, classificationProblems, professionsOf, validateBlueprint, type Blueprint, type CompetencyVersion } from "./blueprint";
import { screenBlueprint, SCREEN_LABEL } from "./screen";
import { loadCasePolicy } from "./policy";

// ── C2: THE EDUCATOR CASE REVIEW STUDIO, AND C3 ON THE HQ SIDE ── COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s8-s9 ──────────
//
// Behind hq.quality.case.author (Clinical Case Educator). Publication is hq.quality.case.publish (Quality Council
// Member). Approval is the existing 395 review, hq.quality.clinical.approve, on the existing review page.
//
// ⚠ THE QUEUE IS STORED RECORDS ONLY (s8, s14.10). It reads case_candidate_queue -- eligible and in-development
// candidates, their de-identified content and the metadata 423 took from it -- with date, facet and status filters
// in the query. Opening or filtering it makes no AI call. Reuse potential is a deterministic score from metadata.
//
// ⚠ NO STUDENT, EVER (s7, C-e). The view has no user and no source reference, and this module reads nothing else
// about a candidate. A promoted case is a NEW library draft the educator authors, on the rights the student attested.
//
// ⚠ AI DRAFTING IS THE PLATFORM'S (s4, s8). case.educator_develop resolves to a platform or authorised institution
// budget on the server (resolveOwner); nothing the browser sends picks the owner. An AI draft is returned for the
// educator to read and save. It is never saved, submitted or approved by itself.
//
// ⚠ THE DATABASE REFUSES, THIS MODULE EXPLAINS. Freezing at submission, independence, scope, version-exact approval,
// approval-before-publication and supersession are 422's and 395's.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CASE_CODE = /^CASE-[A-Z0-9][A-Z0-9-]{2,40}$/;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(e?.message ?? "");
type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

// ── The queue ───────────────────────────────────────────────────────────────────────────────────────────

export type QueueFilters = {
  window: "24h" | "7d" | "30d" | "custom"; from?: string | null; to?: string | null;
  status?: "eligible" | "in_development" | null; level?: string | null; risk?: string | null;
  professionTermId?: string | null; specialtyTermId?: string | null; domainId?: string | null; cpuId?: string | null;
};
export type QueueItem = {
  id: string; status: string; title: string; level: string | null; complexity: number | null; risk: string | null;
  competencyIds: string[]; cfcaDomainIds: string[]; cpuIds: string[]; specialtyTermIds: string[]; professionTermId: string | null;
  offeredAt: string; mine: boolean; takenBy: string | null; attestation: string;
  reuse: { band: "high" | "medium" | "low"; reasons: string[] }; snapshot: Blueprint | null;
};

/** Pure: the window as an ISO range. Custom needs both ends, in order, at most a year apart. */
export function windowRange(f: Pick<QueueFilters, "window" | "from" | "to">, now = new Date()): { from: string; to: string } | null {
  const hours = { "24h": 24, "7d": 168, "30d": 720 } as const;
  if (f.window !== "custom") return { from: new Date(now.getTime() - hours[f.window] * 3_600_000).toISOString(), to: now.toISOString() };
  const a = Date.parse(f.from ?? ""), b = Date.parse(f.to ?? "");
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || b - a > 366 * 86_400_000) return null;
  return { from: new Date(a).toISOString(), to: new Date(b).toISOString() };
}

/** Pure: reuse potential, from stored metadata only. What it teaches that the library lacks, and how complete it is. */
export function reusePotential(c: { competencyIds: string[]; snapshot: any }, covered: ReadonlySet<string>): QueueItem["reuse"] {
  const reasons: string[] = []; let score = 0;
  const gap = c.competencyIds.filter(id => !covered.has(id));
  if (gap.length) { score += 2; reasons.push(`teaches ${gap.length} competenc${gap.length === 1 ? "y" : "ies"} no published case covers`); }
  else if (c.competencyIds.length) reasons.push("its competencies already have published cases");
  else reasons.push("names no CFCA competency yet");
  const dps = Array.isArray(c.snapshot?.decisionPoints) ? c.snapshot.decisionPoints.length : 0;
  if (dps >= 3) { score += 1; reasons.push(`${dps} decision points`); }
  if (Array.isArray(c.snapshot?.safetyCriteria) && c.snapshot.safetyCriteria.length) { score += 1; reasons.push("machine-checkable safety criteria"); }
  if (Array.isArray(c.snapshot?.progression) && c.snapshot.progression.length) { score += 1; reasons.push("branching progression"); }
  return { band: score >= 3 ? "high" : score === 2 ? "medium" : "low", reasons };
}

/** The candidate queue. Stored records only, no AI. null = could not be read. */
export async function candidateQueue(admin: any, educatorId: string, f: QueueFilters): Promise<QueueItem[] | null> {
  const range = windowRange(f);
  if (!range) return [];
  let q = admin.from("case_candidate_queue").select("id, status, snapshot, title, level, complexity, risk, profession_term_id, specialty_term_ids, cfca_domain_ids, cpu_ids, competency_ids, attestation, offered_at, decided_by")
    .gte("offered_at", range.from).lte("offered_at", range.to).order("offered_at", { ascending: false }).limit(200);
  if (f.status) q = q.eq("status", f.status);
  if (f.level) q = q.eq("level", f.level);
  if (f.risk) q = q.eq("risk", f.risk);
  if (f.professionTermId && UUID.test(f.professionTermId)) q = q.eq("profession_term_id", f.professionTermId);
  if (f.specialtyTermId && UUID.test(f.specialtyTermId)) q = q.contains("specialty_term_ids", [f.specialtyTermId]);
  if (f.domainId && UUID.test(f.domainId)) q = q.contains("cfca_domain_ids", [f.domainId]);
  if (f.cpuId && UUID.test(f.cpuId)) q = q.contains("cpu_ids", [f.cpuId]);
  const [{ data, error }, cov] = await Promise.all([q, publishedCoverage(admin)]);
  if (error) return missing(error) ? [] : null;
  if (cov === null) return null;
  return (data ?? []).map((r: any) => ({
    id: r.id, status: r.status, title: r.title ?? "Untitled case", level: r.level, complexity: r.complexity, risk: r.risk,
    competencyIds: r.competency_ids ?? [], cfcaDomainIds: r.cfca_domain_ids ?? [], cpuIds: r.cpu_ids ?? [], specialtyTermIds: r.specialty_term_ids ?? [],
    professionTermId: r.profession_term_id, offeredAt: r.offered_at, mine: r.decided_by === educatorId, takenBy: r.decided_by, attestation: r.attestation,
    reuse: reusePotential({ competencyIds: r.competency_ids ?? [], snapshot: r.snapshot }, cov), snapshot: r.snapshot,
  }));
}

/** The competencies at least one published case teaches. */
async function publishedCoverage(admin: any): Promise<Set<string> | null> {
  const { data: v, error } = await admin.from("case_library_version").select("id").eq("state", "published").limit(1000);
  if (error) return missing(error) ? new Set() : null;
  if (!v?.length) return new Set();
  const { data: l, error: lErr } = await admin.from("case_library_version_competency").select("competency_id").in("version_id", v.map((x: any) => x.id));
  return lErr ? null : new Set((l ?? []).map((x: any) => x.competency_id));
}

const candidateRefusal = (m: string | undefined) =>
  /cannot move from/i.test(m ?? "") ? "That candidate has moved on since you opened it." : "The candidate could not be changed just now.";

/** Take an eligible candidate into development (it is then yours to promote, release or decline). */
export async function takeCandidate(admin: any, educatorId: string, id: string): Promise<R> {
  if (!UUID.test(id)) return { ok: false, error: "No such candidate." };
  const { data, error } = await admin.from("case_candidate").update({ status: "in_development", decided_by: educatorId }).eq("id", id).eq("status", "eligible").select("id");
  if (error) return { ok: false, error: candidateRefusal(error.message) };
  return data?.length ? { ok: true } : { ok: false, error: "That candidate is no longer waiting." };
}
/** Release a candidate you took, back to the queue. */
export async function releaseCandidate(admin: any, educatorId: string, id: string): Promise<R> {
  if (!UUID.test(id)) return { ok: false, error: "No such candidate." };
  const { data, error } = await admin.from("case_candidate").update({ status: "eligible" }).eq("id", id).eq("status", "in_development").eq("decided_by", educatorId).select("id");
  if (error) return { ok: false, error: candidateRefusal(error.message) };
  return data?.length ? { ok: true } : { ok: false, error: "Only the educator who took it can release it." };
}
/** Decline a candidate, saying why. The database purges its content. */
export async function declineCandidate(admin: any, educatorId: string, id: string, reason: string): Promise<R> {
  if (!UUID.test(id)) return { ok: false, error: "No such candidate." };
  const why = (reason ?? "").trim().slice(0, 500);
  if (why.length < 2) return { ok: false, error: "Say why it is declined." };
  const { data, error } = await admin.from("case_candidate").update({ status: "declined", decided_by: educatorId, decline_reason: why }).eq("id", id).in("status", ["eligible", "in_development"]).select("id");
  if (error) return { ok: false, error: candidateRefusal(error.message) };
  return data?.length ? { ok: true } : { ok: false, error: "That candidate is no longer waiting." };
}

/** Pure: the library draft a promoted candidate starts as. Provenance names the candidate and the attested rights. */
export function promotedDraft(snapshot: any, candidateId: string, attestation: string): Blueprint {
  const b = JSON.parse(JSON.stringify(snapshot ?? {}));
  b.schema = BLUEPRINT_SCHEMA;
  b.decisionPoints = (b.decisionPoints ?? []).map((d: any) => { const { sourceRefs: _drop, ...rest } = d ?? {}; void _drop; return rest; });
  b.metadata = { ...(b.metadata ?? {}), provenance: { kind: "candidate", candidateId, rights: attestation, note: null } };
  return b as Blueprint;
}

/** Promote a candidate you took into a new library case, as a draft you author. Checked first, so nothing half-forms. */
export async function promoteCandidate(admin: any, educatorId: string, candidateId: string, args: { code: string; title?: string | null })
  : Promise<R<{ caseId: string; versionId: string }>> {
  if (!UUID.test(candidateId)) return { ok: false, error: "No such candidate." };
  if (!CASE_CODE.test(args.code ?? "")) return { ok: false, error: "A case code is CASE- then capitals, digits and hyphens." };
  const { data: c, error } = await admin.from("case_candidate_queue").select("id, status, snapshot, title, attestation, decided_by").eq("id", candidateId).maybeSingle();
  if (error) return { ok: false, error: "The candidate could not be read just now." };
  if (!c || c.status !== "in_development" || c.decided_by !== educatorId) return { ok: false, error: "Take the candidate into development first." };
  const { data: dup } = await admin.from("case_library_case").select("id").eq("code", args.code).limit(1);
  if (dup?.length) return { ok: false, error: "That case code is taken." };
  const content = promotedDraft(c.snapshot, candidateId, c.attestation);
  const title = (args.title ?? c.title ?? "Clinical case").trim().slice(0, 200);
  const { data: kase, error: kErr } = await admin.from("case_library_case").insert({ code: args.code, title, created_by: educatorId }).select("id").single();
  if (kErr) return { ok: false, error: "The case could not be created just now." };
  const { data: v, error: vErr } = await admin.from("case_library_version").insert({
    case_id: kase.id, version_no: 1, content, authored_by: [educatorId], origin_kind: "candidate", origin_candidate_id: candidateId,
    level: levelOf(content), risk: riskOf(content),
  }).select("id").single();
  if (vErr) {
    await admin.rpc("case_library_retire", { p_case: kase.id });
    return { ok: false, error: "The draft could not be created, so the empty case was retired." };
  }
  await syncLinks(admin, v.id, content);
  return { ok: true, caseId: kase.id, versionId: v.id };
}

// ── Authoring ─────────────────────────────────────────────────────────────────────────────────────────────

const levelOf = (b: any) => (["foundation", "intermediate", "advanced"].includes(b?.metadata?.level) ? b.metadata.level : "intermediate");
const riskOf = (b: any) => (b?.metadata?.risk === "high" ? "high" : "standard");

/** A new, empty case-blueprint/1 draft: one stage, one decision. Everything is then the educator's to fill. */
export function caseTemplate(title: string): Blueprint {
  return {
    schema: BLUEPRINT_SCHEMA, title, summary: "", learnerIntro: "", patient: { ageBand: "", sex: "unspecified", setting: "", presentingComplaint: "", background: [] },
    facts: [], stages: [{ id: "s1", title: "Stage 1", reveals: [], decisionPointIds: ["d1"] }],
    decisionPoints: [{ id: "d1", stageId: "s1", kind: "single", dimension: "recognition", prompt: "", permittedReveals: [], options: [
      { id: "a", text: "", correct: true, rationale: "" }, { id: "b", text: "", correct: false, rationale: "" }] }],
    progression: [], learningObjectives: [], safetyCriteria: [], feedback: { debrief: "", onSafetyEvent: "" }, assessment: null, references: [],
    variation: { rules: [] }, aiBoundary: { patientVoice: false, phraseReveals: false, explain: true },
    metadata: { level: "intermediate", complexity: 2, risk: "standard", professionTermId: null, specialtyTermIds: [], cfcaDomainIds: [], cpuIds: [],
      professionTermIds: [], proficiencyLevelIds: [], provenance: { kind: "educator", rights: "educator_original" } },
  };
}

/** Create a case by hand, with its first draft. */
export async function createCase(admin: any, educatorId: string, args: { code: string; title: string; content?: Blueprint | null }): Promise<R<{ caseId: string; versionId: string }>> {
  if (!CASE_CODE.test(args.code ?? "")) return { ok: false, error: "A case code is CASE- then capitals, digits and hyphens." };
  const title = (args.title ?? "").trim();
  if (title.length < 2 || title.length > 200) return { ok: false, error: "Give the case a title." };
  const { data: dup } = await admin.from("case_library_case").select("id").eq("code", args.code).limit(1);
  if (dup?.length) return { ok: false, error: "That case code is taken." };
  const content = args.content && typeof args.content === "object" ? { ...args.content, schema: BLUEPRINT_SCHEMA, metadata: { ...args.content.metadata, provenance: { kind: "educator", rights: "educator_original" } } } as Blueprint : caseTemplate(title);
  const { data: kase, error: kErr } = await admin.from("case_library_case").insert({ code: args.code, title, created_by: educatorId }).select("id").single();
  if (kErr) return { ok: false, error: missing(kErr) ? "The case library is not available on this environment yet." : "The case could not be created just now." };
  const { data: v, error: vErr } = await admin.from("case_library_version").insert({ case_id: kase.id, version_no: 1, content, authored_by: [educatorId], level: levelOf(content), risk: riskOf(content) }).select("id").single();
  if (vErr) { await admin.rpc("case_library_retire", { p_case: kase.id }); return { ok: false, error: "The draft could not be created, so the empty case was retired." }; }
  await syncLinks(admin, v.id, content);
  return { ok: true, caseId: kase.id, versionId: v.id };
}

/** Start a new draft from a case's latest version: a revision, or a governed variation. One open draft per case. */
export async function newDraft(admin: any, educatorId: string, caseId: string, kind: "revision" | "variation"): Promise<R<{ versionId: string }>> {
  if (!UUID.test(caseId)) return { ok: false, error: "No such case." };
  const { data: vs, error } = await admin.from("case_library_version").select("id, version_no, state, content, authored_by").eq("case_id", caseId).order("version_no", { ascending: false });
  if (error || !vs?.length) return { ok: false, error: "The case could not be read just now." };
  if (vs.some((v: any) => v.state === "draft")) return { ok: false, error: "This case already has a draft. Finish or delete it first." };
  const base = vs[0];
  // The parent's record of competency content is the parent's: the new draft is recorded afresh when it is submitted.
  const { competencyVersions: _parentRecord, ...parentMd } = base.content?.metadata ?? {};
  void _parentRecord;
  const content = { ...base.content, metadata: { ...parentMd, provenance: { ...(base.content?.metadata?.provenance ?? {}), kind, parentVersionId: base.id } } };
  // The parent's authors wrote most of this draft, so they stay its authors: none of them may approve it (395).
  const authors = [...new Set([...(base.authored_by ?? []), educatorId])];
  const { data: v, error: vErr } = await admin.from("case_library_version").insert({
    case_id: caseId, version_no: base.version_no + 1, content, authored_by: authors, origin_kind: kind, parent_version_id: base.id, level: levelOf(content), risk: riskOf(content),
  }).select("id").single();
  if (vErr) return { ok: false, error: "The draft could not be created just now." };
  await syncLinks(admin, v.id, content);
  return { ok: true, versionId: v.id };
}

/** Delete a draft that was never submitted (the database allows only that). */
export async function deleteDraft(admin: any, versionId: string): Promise<R> {
  if (!UUID.test(versionId)) return { ok: false, error: "No such draft." };
  const { data, error } = await admin.from("case_library_version").delete().eq("id", versionId).eq("state", "draft").select("id");
  if (error) return { ok: false, error: "The draft could not be deleted just now." };
  return data?.length ? { ok: true } : { ok: false, error: "Only an unsubmitted draft can be deleted." };
}

/** The CFCA competencies a draft teaches follow its learning objectives (the original identifiers). */
async function syncLinks(admin: any, versionId: string, content: any): Promise<boolean> {
  const want = blueprintCompetencies({ learningObjectives: Array.isArray(content?.learningObjectives) ? content.learningObjectives : [] } as Blueprint).filter(id => UUID.test(id));
  const { data: have, error } = await admin.from("case_library_version_competency").select("competency_id").eq("version_id", versionId);
  if (error) return false;
  const h = new Set((have ?? []).map((x: any) => x.competency_id));
  const drop = [...h].filter(id => !want.includes(id as string)), add = want.filter(id => !h.has(id));
  if (drop.length) await admin.from("case_library_version_competency").delete().eq("version_id", versionId).in("competency_id", drop);
  if (add.length) { const { error: aErr } = await admin.from("case_library_version_competency").insert(add.map(competency_id => ({ version_id: versionId, competency_id }))); if (aErr) return false; }
  return true;
}

/**
 * Save a draft. Whoever edits it becomes one of its authors, so nobody who shaped a case can approve it (395
 * independence). The content is the educator's, and its problems are reported, not hidden: a draft may be incomplete.
 */
export async function saveDraft(admin: any, educatorId: string, versionId: string, content: unknown)
  : Promise<R<{ problems: string[]; screen: string[] }>> {
  if (!UUID.test(versionId)) return { ok: false, error: "No such draft." };
  if (!content || typeof content !== "object" || Array.isArray(content) || (content as any).schema !== BLUEPRINT_SCHEMA) return { ok: false, error: "That is not a case-blueprint/1 document." };
  if (JSON.stringify(content).length > 400_000) return { ok: false, error: "That case is too large." };
  const { data: v, error } = await admin.from("case_library_version").select("id, state, authored_by, origin_kind, content").eq("id", versionId).maybeSingle();
  if (error || !v) return { ok: false, error: "The draft could not be read just now." };
  if (v.state !== "draft") return { ok: false, error: "Only a draft can be edited. Start a new draft from this version." };
  const c = content as any;
  // Provenance and rights are the record's, not the editor's: a promoted case keeps the rights the student attested.
  const kept = v.content?.metadata?.provenance ?? c.metadata?.provenance ?? {};
  // The competency-content record is written at submission only, never by an editor. professionTermId stays the first
  // of the professions, so every reader of the single field (the candidate queue, Scholar) still sees one.
  const { competencyVersions: _editorRecord, ...md } = c.metadata ?? {};
  void _editorRecord;
  const professions = professionsOf(md);
  c.metadata = { ...md, professionTermIds: professions, professionTermId: professions[0] ?? null,
    provenance: { ...kept, note: typeof c.metadata?.provenance?.note === "string" ? c.metadata.provenance.note.slice(0, 300) : kept.note ?? null } };
  const authors = [...new Set([...(v.authored_by ?? []), educatorId])];
  const { error: uErr } = await admin.from("case_library_version").update({ content: c, authored_by: authors, level: levelOf(c), risk: riskOf(c) }).eq("id", versionId).eq("state", "draft");
  if (uErr) return { ok: false, error: "The draft could not be saved just now." };
  await syncLinks(admin, versionId, c);
  // Classification is optional while drafting: an unknown reference is REPORTED here and refused only at submission.
  const refs = await classificationReferenceProblems(admin, c);
  return { ok: true, problems: [...validateBlueprint(c, "library"), ...refs], screen: screenBlueprint(c).map(k => SCREEN_LABEL[k]) };
}

// ── Classification: references to the existing catalogue, never a parallel taxonomy (owner, Stage 5B) ────────────

export type ClassOption = { id: string; label: string };
export type ClassificationOptions = Record<"professions" | "specialties" | "cfcaDomains" | "cpus" | "proficiency", ClassOption[]>;

/**
 * What a case may be classified by, read from the records that already exist: profession and specialty terms
 * (taxonomy_terms, migration 013), the domains of the SHARED frameworks, the Competency Practice Units under those
 * domains (011), and the proficiency levels of the scales those frameworks use (007). Null when it cannot be read.
 */
export async function classificationOptions(admin: any): Promise<ClassificationOptions | null> {
  const { data: tax, error: tErr } = await admin.from("taxonomies").select("id, kind").in("kind", ["profession", "specialty"]);
  if (tErr) return null;
  const kindOf = new Map<string, string>((tax ?? []).map((t: any) => [t.id, t.kind]));
  const terms = kindOf.size ? await admin.from("taxonomy_terms").select("id, taxonomy_id, value, code").in("taxonomy_id", [...kindOf.keys()]).order("sort_order").order("value").limit(3000) : { data: [], error: null };
  const fws = await admin.from("frameworks").select("id, code, name").is("hospital_id", null).order("code").limit(200);
  if (terms.error || fws.error) return null;
  const fwIds = (fws.data ?? []).map((f: any) => f.id);
  const fwOf = new Map<string, any>((fws.data ?? []).map((f: any) => [f.id, f]));
  const doms = fwIds.length ? await admin.from("framework_domains").select("id, framework_id, code, name").in("framework_id", fwIds).order("sort_order").limit(3000) : { data: [], error: null };
  if (doms.error) return null;
  const domOf = new Map<string, any>((doms.data ?? []).map((d: any) => [d.id, d]));
  const pracs = domOf.size ? await admin.from("practices").select("id, domain_id").in("domain_id", [...domOf.keys()]).limit(5000) : { data: [], error: null };
  if (pracs.error) return null;
  const pracDom = new Map<string, string>((pracs.data ?? []).map((p: any) => [p.id, p.domain_id]));
  const cpus = pracDom.size ? await admin.from("clinical_practice_units").select("id, practice_id, code, name").in("practice_id", [...pracDom.keys()]).order("code").limit(5000) : { data: [], error: null };
  const scoring = fwIds.length ? await admin.from("framework_scoring").select("scale_id").in("framework_id", fwIds) : { data: [], error: null };
  const def = await admin.from("scoring_scales").select("id, name").eq("is_default", true);
  if (cpus.error || scoring.error || def.error) return null;
  const scaleIds = [...new Set([...(scoring.data ?? []).map((s: any) => s.scale_id), ...(def.data ?? []).map((s: any) => s.id)])];
  const scales = scaleIds.length ? await admin.from("scoring_scales").select("id, name").in("id", scaleIds) : { data: [], error: null };
  const levels = scaleIds.length ? await admin.from("scoring_levels").select("id, scale_id, score, label").in("scale_id", scaleIds).order("score") : { data: [], error: null };
  if (scales.error || levels.error) return null;
  const scaleName = new Map<string, string>((scales.data ?? []).map((s: any) => [s.id, s.name]));
  const term = (kind: string) => (terms.data ?? []).filter((t: any) => kindOf.get(t.taxonomy_id) === kind).map((t: any) => ({ id: t.id, label: t.code ? `${t.value} (${t.code})` : t.value }));
  return {
    professions: term("profession"), specialties: term("specialty"),
    cfcaDomains: (doms.data ?? []).map((d: any) => ({ id: d.id, label: `${fwOf.get(d.framework_id)?.code ?? "?"} · ${[d.code, d.name].filter(Boolean).join(" ")}` })),
    cpus: (cpus.data ?? []).map((u: any) => ({ id: u.id, label: `${fwOf.get(domOf.get(pracDom.get(u.practice_id) ?? "")?.framework_id)?.code ?? "?"} · ${[u.code, u.name].filter(Boolean).join(" ")}` })),
    proficiency: (levels.data ?? []).map((l: any) => ({ id: l.id, label: `${scaleName.get(l.scale_id) ?? "Scale"} · ${l.score} ${l.label}` })),
  };
}

/**
 * Every classification reference must name an existing record of the right kind, and every learning outcome a
 * recorded outcome of its competency. Problems in words. An unreadable catalogue is itself a problem (fails closed).
 */
export async function classificationReferenceProblems(admin: any, c: any): Promise<string[]> {
  const m = c?.metadata ?? {};
  const los: any[] = Array.isArray(c?.learningObjectives) ? c.learningObjectives : [];
  const asked = { professions: professionsOf(m), specialties: arrOf(m.specialtyTermIds), cfcaDomains: arrOf(m.cfcaDomainIds), cpus: arrOf(m.cpuIds), proficiency: arrOf(m.proficiencyLevelIds) };
  const refs = los.flatMap(l => (Array.isArray(l?.outcomeRefs) ? l.outcomeRefs : []).map((r: any) => ({ lo: l?.id, ...r })));
  if (!Object.values(asked).some(a => a.length) && !refs.length) return [];
  const opts = await classificationOptions(admin);
  if (!opts) return ["classification: the catalogue could not be read just now, so the classification was not checked"];
  const p: string[] = [];
  for (const k of Object.keys(asked) as (keyof typeof asked)[]) {
    const known = new Set(opts[k].map(o => o.id));
    const unknown = asked[k].filter(id => !known.has(id));
    if (unknown.length) p.push(`classification: ${unknown.length} ${k} reference${unknown.length === 1 ? " is" : "s are"} not in the catalogue`);
  }
  if (refs.length) {
    const { data, error } = await admin.from("framework_competencies").select("id, learning_outcomes").in("id", [...new Set(refs.map(r => r.competencyId))]);
    if (error) return [...p, "classification: the competencies' learning outcomes could not be read just now"];
    const count = new Map<string, number>((data ?? []).map((x: any) => [x.id, Array.isArray(x.learning_outcomes) ? x.learning_outcomes.length : 0]));
    for (const r of refs) if (!(r.index < (count.get(r.competencyId) ?? 0))) p.push(`objective ${r.lo}: a learning outcome its competency does not record`);
  }
  return p;
}
const arrOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The exact content of each competency a case teaches, as 395 hashes it (its outcomes and expected level included). */
async function competencyVersionsOf(admin: any, ids: string[]): Promise<CompetencyVersion[] | null> {
  if (!ids.length) return [];
  const { data, error } = await admin.rpc("competency_content_hashes", { p_ids: ids });
  if (error || (data ?? []).length !== ids.length) return null;
  return (data as any[]).map(r => ({ competencyId: r.competency_id, contentHash: r.content_hash })).sort((a, b) => a.competencyId.localeCompare(b.competencyId));
}

/** Submit a draft for independent clinical review: complete, screened clean, and put forward by one of its authors. */
export async function submitCase(admin: any, educatorId: string, versionId: string): Promise<R<{ reviewVersionId: string; required: number }> | { ok: false; error: string; problems: string[] }> {
  if (!UUID.test(versionId)) return { ok: false, error: "No such draft." };
  const { data: v, error } = await admin.from("case_library_version").select("id, state, authored_by, content, risk").eq("id", versionId).maybeSingle();
  if (error || !v) return { ok: false, error: "The draft could not be read just now." };
  if (v.state !== "draft") return { ok: false, error: "This version is already submitted." };
  if (!(v.authored_by ?? []).includes(educatorId)) return { ok: false, error: "Only one of the draft's authors can submit it. Save a change to it first." };
  // Completeness is the published case policy's, applied HERE and not while drafting (owner, Stage 5B classification).
  const policy = await loadCasePolicy(admin);
  const problems = [...validateBlueprint(v.content, "library"), ...classificationProblems(v.content, policy.classificationRequired), ...(await classificationReferenceProblems(admin, v.content))];
  const screen = screenBlueprint(v.content).map(k => `It contains ${SCREEN_LABEL[k]}.`);
  if (problems.length || screen.length) return { ok: false, error: "The case is not ready for clinical review.", problems: [...screen, ...problems] };
  // The competencies as they are NOW become part of the version the reviewer approves (its exact hash, 422), so a later
  // edit to a competency never silently changes what an approved case was approved against.
  const versions = await competencyVersionsOf(admin, blueprintCompetencies(v.content as Blueprint).filter(id => UUID.test(id)));
  if (!versions) return { ok: false, error: "The case's competencies could not be recorded, so nothing was submitted." };
  v.content = { ...v.content, metadata: { ...v.content.metadata, competencyVersions: versions } };
  const { error: rErr } = await admin.from("case_library_version").update({ content: v.content }).eq("id", versionId).eq("state", "draft");
  if (rErr) return { ok: false, error: "The case's competencies could not be recorded, so nothing was submitted." };
  const linked = await syncLinks(admin, versionId, v.content);
  if (!linked) return { ok: false, error: "The case's competencies could not be recorded, so nothing was submitted." };
  const required = (await loadRequiredApprovals(admin))[v.risk === "high" ? "high" : "standard"];
  const { data: ccv, error: sErr } = await admin.rpc("case_library_submit", { p_version: versionId, p_submitter: educatorId, p_required: required });
  if (sErr) return { ok: false, error: /identifiable content/i.test(sErr.message) ? "The case contains patient details and cannot be submitted." : /competencies/i.test(sErr.message) ? "Name the CFCA competencies the case teaches first." : "The case could not be submitted just now." };
  return { ok: true, reviewVersionId: ccv as string, required };
}

/** Publish an approved version (a separate governed act). The previously published version is superseded. */
export async function publishCase(admin: any, publisherId: string, versionId: string): Promise<R> {
  if (!UUID.test(versionId)) return { ok: false, error: "No such version." };
  const { error } = await admin.rpc("case_library_publish", { p_version: versionId, p_publisher: publisherId });
  if (!error) return { ok: true };
  return { ok: false, error: /not clinically approved/i.test(error.message) ? "This exact version is not clinically approved." : /retired/i.test(error.message) ? "The case is retired." : /only a submitted/i.test(error.message) ? "Only a submitted, approved version can be published." : "The case could not be published just now." };
}

/** Retire a case: no longer offered. Its versions and their review records stay. */
export async function retireCase(admin: any, caseId: string): Promise<R> {
  if (!UUID.test(caseId)) return { ok: false, error: "No such case." };
  const { error } = await admin.rpc("case_library_retire", { p_case: caseId });
  return error ? { ok: false, error: "The case could not be retired just now." } : { ok: true };
}

// ── Reading the library ───────────────────────────────────────────────────────────────────────────────────

export type ClinicalCaseState = "draft" | "in_review" | "changes_requested" | "approved" | "published" | "superseded" | "retired";
export type VersionView = {
  id: string; versionNo: number; state: string; clinical: ClinicalCaseState; approvals: number; required: number | null; origin: string; parentVersionId: string | null;
  authors: number; submittedAt: string | null; publishedAt: string | null; title: string; level: string; risk: string;
  comments: { decision: string; comment: string | null; at: string }[];
};

/** Pure: a version's state in words the studio shows -- never "approved" unless the 395 record says so. */
export function clinicalCaseState(state: string, decisions: { decision: string }[], required: number | null): ClinicalCaseState {
  if (state === "draft") return "draft";
  if (state === "published" || state === "superseded" || state === "retired") return state as ClinicalCaseState;
  if (decisions.some(d => d.decision === "rejected")) return "changes_requested";
  return required !== null && decisions.filter(d => d.decision === "approved").length >= required ? "approved" : "in_review";
}

/** Every case, with its latest version's state. */
export async function listCases(admin: any): Promise<{ id: string; code: string; title: string; status: string; latest: { id: string; versionNo: number; state: string } | null; published: string | null }[] | null> {
  const { data: cs, error } = await admin.from("case_library_case").select("id, code, title, status, updated_at").order("updated_at", { ascending: false }).limit(500);
  if (error) return missing(error) ? [] : null;
  if (!cs?.length) return [];
  const { data: vs, error: vErr } = await admin.from("case_library_version").select("id, case_id, version_no, state").in("case_id", cs.map((c: any) => c.id));
  if (vErr) return null;
  return cs.map((c: any) => {
    const mine = (vs ?? []).filter((v: any) => v.case_id === c.id).sort((a: any, b: any) => b.version_no - a.version_no);
    return { id: c.id, code: c.code, title: c.title, status: c.status, latest: mine[0] ? { id: mine[0].id, versionNo: mine[0].version_no, state: mine[0].state } : null,
      published: mine.find((v: any) => v.state === "published")?.id ?? null };
  });
}

/** One case: every version with its clinical state and reviewers' comments, and its audit history. */
export async function caseDetail(admin: any, caseId: string): Promise<{ case: { id: string; code: string; title: string; status: string }; versions: VersionView[]; contentOf: Record<string, Blueprint>; audit: { at: string; actor: string | null; action: string }[] } | null> {
  if (!UUID.test(caseId)) return null;
  const { data: c, error } = await admin.from("case_library_case").select("id, code, title, status").eq("id", caseId).maybeSingle();
  if (error || !c) return null;
  const { data: vs, error: vErr } = await admin.from("case_library_version").select("id, version_no, state, origin_kind, parent_version_id, authored_by, submitted_at, published_at, content, level, risk").eq("case_id", caseId).order("version_no", { ascending: false });
  if (vErr) return null;
  const ids = (vs ?? []).map((v: any) => v.id);
  const { data: ccv } = ids.length ? await admin.from("clinical_content_version").select("id, case_version_id, required_approvals").in("case_version_id", ids) : { data: [] };
  const { data: ds } = ccv?.length ? await admin.from("clinical_review_decision").select("version_id, decision, comment, created_at").in("version_id", ccv.map((x: any) => x.id)) : { data: [] };
  const { data: audit } = await admin.from("audit_log").select("created_at, actor_name, action").in("entity_id", [caseId, ...ids]).order("created_at", { ascending: false }).limit(200);
  const versions: VersionView[] = (vs ?? []).map((v: any) => {
    const review = (ccv ?? []).filter((x: any) => x.case_version_id === v.id);
    const decisions = (ds ?? []).filter((d: any) => review.some((r: any) => r.id === d.version_id));
    const required = review[0]?.required_approvals ?? null;
    return { id: v.id, versionNo: v.version_no, state: v.state, clinical: clinicalCaseState(v.state, decisions, required), approvals: decisions.filter((d: any) => d.decision === "approved").length,
      required, origin: v.origin_kind, parentVersionId: v.parent_version_id, authors: (v.authored_by ?? []).length, submittedAt: v.submitted_at, publishedAt: v.published_at,
      title: v.content?.title ?? c.title, level: v.level, risk: v.risk, comments: decisions.map((d: any) => ({ decision: d.decision, comment: d.comment, at: d.created_at })) };
  });
  return { case: c, versions, contentOf: Object.fromEntries((vs ?? []).map((v: any) => [v.id, v.content])), audit: (audit ?? []).map((a: any) => ({ at: a.created_at, actor: a.actor_name, action: a.action })) };
}

// ── AI drafting, on the platform's budget ─────────────────────────────────────────────────────────────────

const AUTHOR_SYSTEM = `You draft clinical teaching cases for nurse and allied-health educators, as ONE JSON object in the schema case-blueprint/1.
Use only synthetic, coarse patient details (an age band such as "60-69", never a name, a date, a place or a number that identifies anyone).
Every finding goes in "facts" with its value, kind, revealedAt ("start", a stage id, or "request") and safetyCritical.
Stages list their reveals and decisionPointIds. Each decision point has a stageId, a prompt, kind single, multiple or free_text, a dimension
(recognition, interpretation, prioritisation, decision, reassessment or escalation), options with id, text, correct and rationale, and permittedReveals.
Progression transitions name a from stage, onOptions or isDefault, a to stage, and consequenceFactIds. Option transitions only from a stage with one single-choice decision.
Add safetyCriteria (decisionPointId, mustSelect or mustNotSelect), a debrief, learningObjectives (text, competencyIds as given), references the educator can verify,
and metadata {level, complexity 1-5, risk standard or high}. Return the JSON object only. An educator will check every fact before any clinical review.`;

/** Pure: the first JSON object in a model's text, or null. */
export function extractJson(text: string): any | null {
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { const o = JSON.parse(text.slice(i, j + 1)); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}

/**
 * Draft a case with AI for an educator to read. Workflow case.educator_develop: the server resolves the platform (or
 * an authorised institution) budget. The draft is returned, never stored, and is labelled an AI draft.
 */
export async function draftCaseWithAi(admin: any, educatorId: string, args: { brief: string; competencyIds: string[]; level: string; risk: string; requestKey: string })
  : Promise<R<{ content: Blueprint; problems: string[]; screen: string[] }>> {
  const brief = (args.brief ?? "").trim();
  if (brief.length < 20 || brief.length > 4000) return { ok: false, error: "Describe the case you want in a few sentences." };
  if (!UUID.test(args.requestKey ?? "")) return { ok: false, error: "Try again." };
  const owner = await resolveOwner(admin, "case.educator_develop", "scholar", { userId: educatorId });
  if ("refused" in owner) return { ok: false, error: owner.message };
  const competencyIds = (args.competencyIds ?? []).filter(id => UUID.test(id)).slice(0, 20);
  const requestId = `case.author:${createHash("sha256").update(`${educatorId}:${args.requestKey}`).digest("hex").slice(0, 40)}`;
  const r = await runOwnedAi(admin, {
    owner, product: "scholar", activity: "case_author", requestId,
    generate: { system: AUTHOR_SYSTEM, user: `Level: ${args.level}. Risk: ${args.risk}. Competency ids for learningObjectives: ${JSON.stringify(competencyIds)}.\n\nThe case:\n${brief}`,
      tier: "reasoning", maxTokens: 3000, context: { userId: educatorId, operation: "case.educator_develop" } },
    risk: { text: brief, competencyIds },
  });
  if (isBudgetRefusal(r)) return { ok: false, error: r.message };
  if (!r.ok) return { ok: false, error: "error" in r && (r as any).error === "not_configured" ? "AI is not configured on this environment." : "The AI draft could not be made just now." };
  const o = extractJson((r as any).text ?? "");
  if (!o) return { ok: false, error: "The AI did not return a case. Nothing was charged beyond the request itself." };
  const content = { ...o, schema: BLUEPRINT_SCHEMA, metadata: { ...(o.metadata ?? {}), professionTermId: null, professionTermIds: [], specialtyTermIds: [], cfcaDomainIds: [], cpuIds: [], proficiencyLevelIds: [],
    provenance: { kind: "educator", rights: "educator_original", note: "AI draft (case.educator_develop), not yet checked by an educator" } } } as Blueprint;
  return { ok: true, content, problems: validateBlueprint(content, "library"), screen: screenBlueprint(content).map(k => SCREEN_LABEL[k]) };
}

/** The CFCA competencies of the shared frameworks, for linking a case to the outcomes it serves, with each one's recorded learning outcomes. */
export async function competencyOptions(admin: any): Promise<{ id: string; label: string; outcomes: string[] }[]> {
  const { data: fws } = await admin.from("frameworks").select("id, code, name").is("hospital_id", null).order("code").limit(200);
  if (!fws?.length) return [];
  const { data: doms } = await admin.from("framework_domains").select("id, framework_id").in("framework_id", fws.map((f: any) => f.id)).limit(3000);
  if (!doms?.length) return [];
  const { data: comps } = await admin.from("framework_competencies").select("id, code, name, domain_id, learning_outcomes").in("domain_id", doms.map((d: any) => d.id)).order("code").limit(3000);
  const fwOf = new Map<string, any>(doms.map((d: any) => [d.id, fws.find((f: any) => f.id === d.framework_id)]));
  return (comps ?? []).map((c: any) => ({ id: c.id, label: `${fwOf.get(c.domain_id)?.code ?? "?"} · ${c.code ?? ""} ${c.name ?? ""}`.trim(),
    outcomes: Array.isArray(c.learning_outcomes) ? c.learning_outcomes.map((o: unknown) => (typeof o === "string" ? o : "")) : [] }));
}
