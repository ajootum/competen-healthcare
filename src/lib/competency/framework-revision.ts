/* eslint-disable @typescript-eslint/no-explicit-any */
import { currentTraceId } from "@/lib/trace";
import { competencyCodeTaken, cpuFor, isId, NOT_RECORDED, parseCompetency, parseCpu, parseCpuLabel, parseDomainLabel, parseFrameworkLabel, parsePracticeLabel, practiceInFramework,
  type Actor, type CompetencyInput } from "./authoring";
import { authorsOf, clinicalStatus, loadRequiredApprovals, reviewRefusal, reviewRisk, type ClinicalReview } from "./clinical-review";
import { checkComponent, classifyMove, parseCriterionText, parsePosition, parseSourceRef, pinnedByActiveMethod, placeCriterion } from "./criteria-authoring";
import { diffFramework, normalise, type FrameworkDiff } from "./framework-diff";
import { isHoldingsGoverned } from "./framework-lifecycle";
import { pendingLayout, reorderLayout } from "./framework-layout";
import { byRowOrder } from "./layout-order";

// ── REVISION DRAFTS OF PUBLISHED FRAMEWORKS ── FRAMEWORK-DESIGN-STUDIO-02 S5, owner ruling D2, migration 770 ───────────
//
// A PUBLISHED, centrally governed framework (shared, CFCA layer) is what learners and assessors read. Every content
// change to it -- a competency's fields and outcomes, a new competency, criteria created, edited, retired, restored or
// moved -- goes into its one open REVISION DRAFT (770 tables), never into the live rows:
//
//   first edit     opens the revision (framework_revision_open) and copies the competency with ALL its criteria into it
//                  (framework_revision_add_competency), then edits the copy. Ids are the live ids. A new competency or
//                  criterion is given its final id now (pre-allocated): the database checks it is unused.
//   review         submitRevisionVersion puts the PROPOSED content forward on the existing 395 process: the database
//                  computes its hash with competency_content_hash's semantics from the revision rows and binds the version
//                  to the stable competency id. Reviewers decide it on the existing path, with the existing SoD.
//   publication    the existing independent publication (framework-publication.ts). The 770 trigger applies the revision
//                  to the live rows INSIDE the publication statement, before the unchanged 466 and 640 guards judge it.
//   discard        discardRevision: closed, nothing live ever changed.
//
// ⚠ AUTHORSHIP FIRST, ON THE STABLE ID. Every content write records its audit row on the competency id (live, or the new
// id) BEFORE the write, so the 395/640 guards and authorsOf count its author as an author of that competency. Opening and
// discarding a revision are recorded on the REVISION id (entity_type framework_revision): not authorship of any content.
// A same-section reorder stays organisational (F4, reorder_layout, recorded on the framework).
//
// ⚠ FAIL CLOSED. Without 770 a content change to a published governed framework is refused (409), nothing written. Never a
// live write. Organisational changes keep using the layout draft (750/760), unchanged.
//
// MIGRATION 771 (D3: ALL changes to a published framework pass through the revision): the framework name and description,
// new domains (pre-allocated id, Area optional) and domain renames, new or renamed practices and CPUs are saved in the
// same revision (framework_revision proposal columns, framework_revision_domain / _practice / _cpu) and applied by the
// same publication statement. They are not in the content hash: ORGANISATIONAL for review (their audit actions
// cfca_revision_*_created / _renamed / _updated are recorded on the FRAMEWORK and are not authorship, NOT_AUTHORSHIP and
// the 771 SoD guard), but contribution for publication. A NEW revision competency may move to another domain of the
// revision (move_competency_domain, mode "revision"). Without 771 every such action on a published governed framework is
// refused (409), nothing written.

type Fail = { ok: false; status: number; error: string };
type Result<T extends object = object> = ({ ok: true } & T) | Fail;

export const NOT_READY: Fail = { ok: false, status: 409, error: "Revision drafts are not set up on this environment yet (migration 770), so a published framework is not changed here. Nothing has changed." };
const UNREADABLE: Fail = { ok: false, status: 503, error: "The revision draft could not be read just now. Nothing has changed." };
const NOT_SAVED: Fail = { ok: false, status: 503, error: "The revision draft could not be saved just now. Try again." };
const ABSENT = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);
const absent = (e: any) => !!e && ABSENT.has(String(e.code ?? ""));

/** The content actions that a published governed framework routes into its revision draft. */
export const REVISION_ACTIONS = new Set(["update_competency", "create_competency", "create_criterion", "update_criterion", "retire_criterion", "restore_criterion", "move_criterion"]);
/** 771: the structure actions a published governed framework routes into its revision draft. */
export const STRUCTURE_ACTIONS = new Set(["update_framework", "create_domain", "rename_domain", "create_practice", "create_cpu", "rename_practice", "rename_cpu", "move_competency_domain"]);
export const NOT_READY_771: Fail = { ok: false, status: 409, error: "Changing the structure of a published framework through its revision draft is not set up on this environment yet (migration 771), so nothing has changed." };

export type RevDomain = { revision_id: string; domain_id: string; origin_domain_id: string | null; name: string; code: string | null; area_id: string | null; sort_order: number | null };
export type RevPractice = { revision_id: string; practice_id: string; origin_practice_id: string | null; domain_id: string | null; name: string; description: string | null; code: string | null };
export type RevCpu = { revision_id: string; cpu_id: string; origin_cpu_id: string | null; practice_id: string | null; name: string; description: string | null; code: string | null;
  risk_category: string | null; complexity: number | null; reassessment_months: number | null };
export type RevStructure = { framework: { name: string; description: string | null } | null; domains: RevDomain[]; practices: RevPractice[]; cpus: RevCpu[] };
const DOM_COLS = "revision_id, domain_id, origin_domain_id, name, code, area_id, sort_order";
const PRA_COLS = "revision_id, practice_id, origin_practice_id, domain_id, name, description, code";
const CPU_COLS = "revision_id, cpu_id, origin_cpu_id, practice_id, name, description, code, risk_category, complexity, reassessment_months";

type Fw = { id: string; name: string; pub_status: string | null; hospital_id: string | null; competency_layer: string | null };
/** Pure (D2): content changes to this framework go into a revision draft. */
export const goesToRevision = (fw: Fw | null | undefined): boolean => !!fw && (fw.pub_status ?? "draft") === "published" && isHoldingsGoverned(fw);

export type RevComp = { id: string; revision_id: string; competency_id: string; origin_competency_id: string | null; domain_id: string | null; sort_order: number | null;
  code: string | null; name: string; description: string | null; learning_outcomes: string[]; expected_level_id: string | null; practice_id: string | null; cpu_id: string | null; risk_category: string | null };
export type RevCrit = { id: string; revision_id: string; skill_id: string; origin_skill_id: string | null; competency_id: string; name: string; component_code: string | null; source_ref: string | null; sort_order: number; is_active: boolean };
export type RevisionHead = { id: string; framework_id: string; created_by: string; created_at: string; updated_at: string };

const COMP_COLS = "id, revision_id, competency_id, origin_competency_id, domain_id, sort_order, code, name, description, learning_outcomes, expected_level_id, practice_id, cpu_id, risk_category";
const CRIT_COLS = "id, revision_id, skill_id, origin_skill_id, competency_id, name, component_code, source_ref, sort_order, is_active";

// ── Pure ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure: the live framework row (framework-diff LIVE nesting) with a revision laid over it, in the same nesting, so
 * diffFramework(normalise(live), normalise(overlay)) is the revision against what is published. Existing competencies take
 * their proposed fields and proposed criteria (a moved criterion appears under its new competency), new ones join their
 * domain. Order of competencies is the live one (organisational, the layout draft). 771: the proposed framework name and
 * description, domain renames and new domains (with the new competencies proposed in them) are laid over too.
 */
export function overlayRevision(live: any, comps: readonly RevComp[], crits: readonly RevCrit[], structure?: RevStructure | null): any {
  const byComp = new Map(comps.map(c => [c.competency_id, c]));
  const critsOf = (id: string) => crits.filter(k => k.competency_id === id)
    .map(k => ({ id: k.skill_id, name: k.name, sort_order: k.sort_order, component_code: k.component_code, is_active: k.is_active }));
  const movedIn = new Set(crits.map(k => k.skill_id));
  const fields = (c: RevComp) => ({ code: c.code, name: c.name, description: c.description, learning_outcomes: c.learning_outcomes, expected_level_id: c.expected_level_id,
    risk_category: c.risk_category, practice_id: c.practice_id, cpu_id: c.cpu_id });
  const renamed = new Map((structure?.domains ?? []).filter(d => d.origin_domain_id).map(d => [d.domain_id, d]));
  const newComps = (domainId: string) => comps.filter(c => !c.origin_competency_id && c.domain_id === domainId)
    .map(c => ({ id: c.competency_id, sort_order: c.sort_order, ...fields(c), competency_skills: critsOf(c.competency_id) }));
  return {
    ...live,
    ...(structure?.framework ? { name: structure.framework.name, description: structure.framework.description } : {}),
    framework_domains: [...(live?.framework_domains ?? []).map((d: any) => ({
      ...d,
      ...(renamed.has(d.id) ? { name: renamed.get(d.id)!.name, code: renamed.get(d.id)!.code } : {}),
      framework_competencies: [
        ...(d.framework_competencies ?? []).map((c: any) => {
          const rc = byComp.get(c.id);
          if (rc) return { ...c, ...fields(rc), competency_skills: critsOf(c.id) };
          // Not in the revision: its live criteria, less any the revision moved into another competency.
          return { ...c, competency_skills: (c.competency_skills ?? []).filter((k: any) => !movedIn.has(k.id)) };
        }),
        ...newComps(d.id),
      ],
    })),
    ...(structure?.domains ?? []).filter(d => !d.origin_domain_id)
      .map(d => ({ id: d.domain_id, name: d.name, code: d.code, sort_order: d.sort_order, framework_competencies: newComps(d.domain_id) }))],
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether 770 is on this environment. null = unreadable. Zero-row read. */
export async function revisionsReady(admin: any): Promise<boolean | null> {
  try {
    const r = await admin.from("framework_revision").select("id").limit(0);
    return !r.error ? true : absent(r.error) ? false : null;
  } catch { return null; }
}

/** The open revision of a framework. null = none (or 770 absent), Fail = unreadable. */
export async function openRevision(admin: any, frameworkId: string): Promise<RevisionHead | null | Fail> {
  const { data, error } = await admin.from("framework_revision").select("id, framework_id, created_by, created_at, updated_at").eq("framework_id", frameworkId).eq("status", "open").limit(1);
  if (error) return absent(error) ? null : UNREADABLE;
  return data?.[0] ?? null;
}

async function revComp(admin: any, revisionId: string, competencyId: string): Promise<RevComp | null | Fail> {
  const { data, error } = await admin.from("framework_revision_competency").select(COMP_COLS).eq("revision_id", revisionId).eq("competency_id", competencyId).limit(1);
  return error ? UNREADABLE : data?.[0] ?? null;
}
async function revCrits(admin: any, revisionId: string, competencyId: string): Promise<RevCrit[] | null> {
  const { data, error } = await admin.from("framework_revision_criterion").select(CRIT_COLS).eq("revision_id", revisionId).eq("competency_id", competencyId).limit(2000);
  return error ? null : [...(data ?? [])].sort((a: any, b: any) => byRowOrder({ ...a, id: a.skill_id }, { ...b, id: b.skill_id }));
}

/** The framework a content action names, through a live row or a row of an OPEN revision. null = none, undefined = unreadable. */
async function frameworkIdOf(admin: any, kind: "competency" | "domain" | "criterion", id: string): Promise<string | null | undefined> {
  if (kind === "domain") {
    const { data, error } = await admin.from("framework_domains").select("framework_id").eq("id", id).maybeSingle();
    if (error) return undefined;
    if (data) return data.framework_id ?? null;
    // 771: a NEW domain exists only in an open revision.
    const n = await newInRevision(admin, "framework_revision_domain", "domain_id", id);
    return n === undefined ? undefined : n?.frameworkId ?? null;
  }
  if (kind === "competency") {
    const { data, error } = await admin.from("framework_competencies").select("domain_id, framework_domains(framework_id)").eq("id", id).maybeSingle();
    if (error) return undefined;
    if (data) return data.framework_domains?.framework_id ?? null;
  } else {
    const { data, error } = await admin.from("competency_skills").select("competency_id, framework_competencies(framework_domains(framework_id))").eq("id", id).maybeSingle();
    if (error) return undefined;
    if (data) return data.framework_competencies?.framework_domains?.framework_id ?? null;
  }
  // A new competency or criterion exists only in an open revision.
  const table = kind === "competency" ? "framework_revision_competency" : "framework_revision_criterion";
  const { data, error } = await admin.from(table).select("framework_revision!inner(framework_id, status)").eq(kind === "competency" ? "competency_id" : "skill_id", id).eq("framework_revision.status", "open").limit(1);
  if (error) return absent(error) ? null : undefined;
  return data?.[0]?.framework_revision?.framework_id ?? null;
}

/** Whether 771 is on this environment. null = unreadable. Zero-row read. */
export async function structureReady(admin: any): Promise<boolean | null> {
  try {
    const r = await admin.from("framework_revision_domain").select("domain_id").limit(0);
    return !r.error ? true : absent(r.error) ? false : null;
  } catch { return null; }
}

type NewRow = { revisionId: string; frameworkId: string; row: any };
/** 771: a row NEW in an open revision (no origin), by its stable id. null = none (or 771 absent), undefined = unreadable. */
async function newInRevision(admin: any, table: string, col: string, id: string): Promise<NewRow | null | undefined> {
  const origin = "origin_" + col;
  const { data, error } = await admin.from(table).select("*").eq(col, id).limit(5);
  if (error) return absent(error) ? null : undefined;
  for (const row of (data ?? []) as any[]) {
    if (row[origin]) continue;
    const r = await admin.from("framework_revision").select("id, framework_id").eq("id", row.revision_id).eq("status", "open").limit(1);
    if (r.error) return undefined;
    if (r.data?.[0]) return { revisionId: r.data[0].id, frameworkId: r.data[0].framework_id, row };
  }
  return null;
}

async function frameworkRow(admin: any, id: string): Promise<Fw | null | undefined> {
  const { data, error } = await admin.from("frameworks").select("id, name, pub_status, hospital_id, competency_layer").eq("id", id).maybeSingle();
  return error ? undefined : data ?? null;
}

// ── Writes ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An audit row. Content changes name the competency (authorship). Revision lifecycle names the revision (it is not). */
async function record(admin: any, actor: Actor, action: string, entityType: string, entityId: string, entityName: string, detail: Record<string, unknown>): Promise<boolean> {
  const { error } = await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: actor.userId, actor_name: actor.name, action,
    entity_type: entityType, entity_id: entityId, entity_name: entityName.slice(0, 200), new_value: detail });
  return !error;
}

/** The open revision, opened on the first change. */
async function ensureRevision(admin: any, actor: Actor, fw: Fw): Promise<string | Fail> {
  const before = await openRevision(admin, fw.id);
  if (before && "ok" in before) return before;
  if (before) return before.id;
  const { data, error } = await admin.rpc("framework_revision_open", { p_framework: fw.id, p_actor: actor.userId });
  if (error || typeof data !== "string") return absent(error) ? NOT_READY : NOT_SAVED;
  await record(admin, actor, "cfca_revision_opened", "framework_revision", data, fw.name, { framework_id: fw.id });
  return data;
}

/** A live competency copied (with all its criteria) into the revision, once. */
async function ensureCompetency(admin: any, actor: Actor, revisionId: string, competencyId: string): Promise<true | Fail> {
  const have = await revComp(admin, revisionId, competencyId);
  if (have && "ok" in have) return have;
  if (have) return true;
  const { error } = await admin.rpc("framework_revision_add_competency", { p_revision: revisionId, p_competency: competencyId, p_actor: actor.userId });
  return error ? NOT_SAVED : true;
}

type Place = { fw: Fw; revisionId: string | null };

/** The criteria of a competency as the revision has them, or (not yet copied) as they are live, in one shape. */
async function criteriaNow(admin: any, revisionId: string | null, competencyId: string): Promise<RevCrit[] | null> {
  if (revisionId) {
    const have = await revComp(admin, revisionId, competencyId);
    if (have && "ok" in have) return null;
    if (have) return revCrits(admin, revisionId, competencyId);
  }
  const { data, error } = await admin.from("competency_skills").select("id, competency_id, name, sort_order, component_code, source_ref, is_active").eq("competency_id", competencyId).limit(2000);
  if (error) return null;
  return [...(data ?? [])].sort(byRowOrder).map((k: any) => ({ id: k.id, revision_id: revisionId ?? "", skill_id: k.id, origin_skill_id: k.id, competency_id: k.competency_id, name: k.name,
    component_code: k.component_code ?? null, source_ref: k.source_ref ?? null, sort_order: k.sort_order ?? 0, is_active: k.is_active !== false }));
}

/** A competency as the revision proposes it, or as it is live. null = not of this framework. */
async function competencyNow(admin: any, place: Place, competencyId: string): Promise<{ id: string; name: string; isNew: boolean; inRevision: boolean } | null | Fail> {
  if (place.revisionId) {
    const rc = await revComp(admin, place.revisionId, competencyId);
    if (rc && "ok" in rc) return rc;
    if (rc) return { id: rc.competency_id, name: rc.name, isNew: !rc.origin_competency_id, inRevision: true };
  }
  const { data, error } = await admin.from("framework_competencies").select("id, name, framework_domains(framework_id)").eq("id", competencyId).maybeSingle();
  if (error) return UNREADABLE;
  if (!data || data.framework_domains?.framework_id !== place.fw.id) return null;
  return { id: data.id, name: data.name, isNew: false, inRevision: false };
}

async function renumberRev(admin: any, revisionId: string, order: string[], rows: RevCrit[]): Promise<boolean> {
  const at = new Map(rows.map(r => [r.skill_id, r.sort_order]));
  for (const [i, id] of order.entries()) {
    if (at.get(id) === i + 1) continue;
    const { error } = await admin.from("framework_revision_criterion").update({ sort_order: i + 1 }).eq("revision_id", revisionId).eq("skill_id", id);
    if (error) return false;
  }
  return true;
}

// ── The router (POST /api/hq/competency/authoring) ────────────────────────────────────────────────────────────────

/**
 * A content action on a published governed framework, done in its revision draft. null = not such a framework (the
 * caller's existing draft-framework path applies, unchanged).
 */
export async function routeToRevision(admin: any, actor: Actor, action: string, b: any): Promise<Result<any> | null> {
  if (STRUCTURE_ACTIONS.has(action)) return routeStructure(admin, actor, action, b);
  if (!REVISION_ACTIONS.has(action)) return null;
  const ref = action === "create_competency" ? { kind: "domain" as const, id: b?.domainId }
    : action === "update_competency" || action === "create_criterion" ? { kind: "competency" as const, id: b?.competencyId } : { kind: "criterion" as const, id: b?.criterionId };
  if (!isId(ref.id)) return null;
  const fwId = await frameworkIdOf(admin, ref.kind, ref.id);
  if (fwId === undefined) return UNREADABLE;
  if (!fwId) return null;
  const fw = await frameworkRow(admin, fwId);
  if (fw === undefined) return UNREADABLE;
  if (!goesToRevision(fw)) return null;
  const ready = await revisionsReady(admin);
  if (ready === null) return UNREADABLE;
  if (!ready) return NOT_READY;
  const open = await openRevision(admin, fw!.id);
  if (open && "ok" in open) return open;
  const place: Place = { fw: fw!, revisionId: open?.id ?? null };
  switch (action) {
    case "update_competency": return reviseCompetency(admin, actor, place, b);
    case "create_competency": return reviseCreateCompetency(admin, actor, place, b);
    case "create_criterion": return reviseCreateCriterion(admin, actor, place, b);
    case "update_criterion": return reviseUpdateCriterion(admin, actor, place, b);
    case "retire_criterion": return reviseSetActive(admin, actor, place, b, false);
    case "restore_criterion": return reviseSetActive(admin, actor, place, b, true);
    case "move_criterion": return reviseMoveCriterion(admin, actor, place, b);
  }
  return null;
}

const proposed = (v: CompetencyInput) => ({ code: v.code, name: v.name, description: v.description, learning_outcomes: v.learningOutcomes, expected_level_id: v.expectedLevelId, risk_category: v.riskCategory });

/** A code is unique among shared competencies, live or proposed in this revision. null = unreadable. */
async function codeTaken(admin: any, revisionId: string | null, code: string, exceptId: string): Promise<boolean | null> {
  const live = await competencyCodeTaken(admin, code, exceptId);
  if (live !== false || !revisionId) return live;
  const { data, error } = await admin.from("framework_revision_competency").select("competency_id").eq("revision_id", revisionId).eq("code", code).limit(5);
  if (error) return null;
  return (data ?? []).some((r: any) => r.competency_id !== exceptId);
}

/** update_competency on a published framework: the fields and outcomes, proposed. */
async function reviseCompetency(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ mode: "revision"; revisionId: string }>> {
  const p = parseCompetency(b);
  if (!p.ok) return { ok: false, status: 422, error: p.error };
  const c = await competencyNow(admin, place, b.competencyId);
  if (c && "ok" in c) return c;
  if (!c) return { ok: false, status: 404, error: "That competency does not exist." };
  const taken = await codeTaken(admin, place.revisionId, p.value.code, c.id);
  if (taken === null) return { ok: false, status: 503, error: "Competency codes could not be checked just now. Nothing has changed." };
  if (taken) return { ok: false, status: 409, error: `A shared competency with the code ${p.value.code} already exists.` };
  const cpu = b && "cpuId" in b ? await revisionCpuFor(admin, place, b.cpuId) : null;
  if (cpu && !cpu.ok) return { ok: false, status: 422, error: cpu.error };
  if (!(await record(admin, actor, "cfca_revision_competency_updated", "framework_competency", c.id, p.value.name, { code: p.value.code, framework_id: place.fw.id, substantive: true }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  if (!c.isNew) { const e = await ensureCompetency(admin, actor, rev, c.id); if (e !== true) return e; }
  const { error } = await admin.from("framework_revision_competency").update({ ...proposed(p.value), ...(cpu && cpu.ok ? { practice_id: cpu.practiceId, cpu_id: cpu.cpuId } : {}), updated_by: actor.userId })
    .eq("revision_id", rev).eq("competency_id", c.id);
  return error ? NOT_SAVED : { ok: true, mode: "revision", revisionId: rev };
}

/** create_competency on a published framework: proposed in a live domain, with its final id. */
async function reviseCreateCompetency(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ id: string; mode: "revision"; revisionId: string }>> {
  const p = parseCompetency(b);
  if (!p.ok) return { ok: false, status: 422, error: p.error };
  const taken = await codeTaken(admin, place.revisionId, p.value.code, "");
  if (taken === null) return { ok: false, status: 503, error: "Competency codes could not be checked just now. Nothing has changed." };
  if (taken) return { ok: false, status: 409, error: `A shared competency with the code ${p.value.code} already exists.` };
  const cpu = await revisionCpuFor(admin, place, b?.cpuId);
  if (!cpu.ok) return { ok: false, status: 422, error: cpu.error };
  const [{ data: last, error: e1 }, newer] = await Promise.all([
    admin.from("framework_competencies").select("sort_order").eq("domain_id", b.domainId).order("sort_order", { ascending: false }).limit(1),
    place.revisionId ? admin.from("framework_revision_competency").select("sort_order").eq("revision_id", place.revisionId).eq("domain_id", b.domainId).limit(500) : Promise.resolve({ data: [], error: null }),
  ]);
  if (e1 || newer.error) return UNREADABLE;
  const sort = Math.max(last?.[0]?.sort_order ?? 0, ...((newer.data ?? []) as any[]).map(r => r.sort_order ?? 0)) + 1;
  const id = crypto.randomUUID();
  if (!(await record(admin, actor, "cfca_revision_competency_created", "framework_competency", id, p.value.name, { code: p.value.code, framework_id: place.fw.id, domain_id: b.domainId, substantive: true }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  const { error } = await admin.from("framework_revision_competency").insert({ revision_id: rev, competency_id: id, domain_id: b.domainId, sort_order: sort, ...proposed(p.value),
    practice_id: cpu.practiceId, cpu_id: cpu.cpuId, created_by: actor.userId, updated_by: actor.userId });
  return error ? { ok: false, status: 422, error: "The competency could not be proposed." } : { ok: true, id, mode: "revision", revisionId: rev };
}

/** create_criterion { competencyId, component, text, sourceRef?, position? } in the revision. */
async function reviseCreateCriterion(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ id: string; mode: "revision"; revisionId: string }>> {
  const t = parseCriterionText(b?.text);
  if (!t.ok) return { ok: false, status: 422, error: t.error };
  const sourceRef = parseSourceRef(b?.sourceRef), position = parsePosition(b?.position);
  if (sourceRef === undefined) return { ok: false, status: 422, error: "A source reference is at most 300 characters." };
  if (position === undefined) return { ok: false, status: 422, error: "The position is a whole number from 1." };
  const c = await competencyNow(admin, place, b.competencyId);
  if (c && "ok" in c) return c;
  if (!c) return { ok: false, status: 404, error: "That competency does not exist." };
  const component = await checkComponent(admin, b?.component);
  if (typeof component !== "string") return component;
  const rows = await criteriaNow(admin, place.revisionId, c.id);
  if (!rows) return UNREADABLE;
  const id = crypto.randomUUID();
  const order = placeCriterion(rows.map(r => ({ id: r.skill_id, component: r.component_code })), { id, component }, position);
  if (!(await record(admin, actor, "cfca_revision_criterion_created", "framework_competency", c.id, c.name, { criterion_id: id, component, position, substantive: true, framework_id: place.fw.id }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  if (!c.isNew) { const e = await ensureCompetency(admin, actor, rev, c.id); if (e !== true) return e; }
  const { error } = await admin.from("framework_revision_criterion").insert({ revision_id: rev, skill_id: id, competency_id: c.id, name: t.value, component_code: component, source_ref: sourceRef,
    sort_order: order.indexOf(id) + 1, is_active: true, created_by: actor.userId, updated_by: actor.userId });
  if (error) return { ok: false, status: 422, error: "The criterion could not be proposed." };
  const now = await revCrits(admin, rev, c.id);
  if (!now || !(await renumberRev(admin, rev, order, now))) return { ok: false, status: 503, error: "The criterion was proposed, but the order of the others could not be updated. Reorder the section to tidy it." };
  return { ok: true, id, mode: "revision", revisionId: rev };
}

/** The criterion as the revision has it (or live, not yet copied), and the competency it is under. */
async function criterionNow(admin: any, place: Place, criterionId: unknown): Promise<{ k: RevCrit; comp: { id: string; name: string; isNew: boolean } } | null | Fail> {
  if (!isId(criterionId)) return { ok: false, status: 400, error: "Choose a criterion." };
  let k: RevCrit | null = null;
  if (place.revisionId) {
    const { data, error } = await admin.from("framework_revision_criterion").select(CRIT_COLS).eq("revision_id", place.revisionId).eq("skill_id", criterionId).limit(1);
    if (error) return UNREADABLE;
    k = data?.[0] ?? null;
  }
  if (!k) {
    const { data, error } = await admin.from("competency_skills").select("id, competency_id, name, sort_order, component_code, source_ref, is_active").eq("id", criterionId).maybeSingle();
    if (error) return UNREADABLE;
    if (!data) return null;
    k = { id: data.id, revision_id: "", skill_id: data.id, origin_skill_id: data.id, competency_id: data.competency_id, name: data.name, component_code: data.component_code ?? null,
      source_ref: data.source_ref ?? null, sort_order: data.sort_order ?? 0, is_active: data.is_active !== false };
  }
  const comp = await competencyNow(admin, place, k.competency_id);
  if (comp && "ok" in comp) return comp;
  if (!comp) return null;
  return { k, comp };
}

/** update_criterion { criterionId, text?, sourceRef? } in the revision. */
async function reviseUpdateCriterion(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ unchanged: boolean; mode: "revision"; revisionId?: string }>> {
  const at = await criterionNow(admin, place, b?.criterionId);
  if (at === null) return { ok: false, status: 404, error: "That criterion does not exist." };
  if ("ok" in at) return at;
  const hasText = b && "text" in b, hasRef = b && "sourceRef" in b;
  if (!hasText && !hasRef) return { ok: false, status: 400, error: "Send the new text or source reference." };
  const t = hasText ? parseCriterionText(b.text) : null;
  if (t && !t.ok) return { ok: false, status: 422, error: t.error };
  const sourceRef = hasRef ? parseSourceRef(b.sourceRef) : at.k.source_ref;
  if (sourceRef === undefined) return { ok: false, status: 422, error: "A source reference is at most 300 characters." };
  if (!at.k.is_active) return { ok: false, status: 409, error: "This criterion is retired. Restore it before editing it." };
  const text = t && t.ok ? t.value : at.k.name;
  const textChanged = text !== at.k.name, refChanged = (sourceRef ?? null) !== (at.k.source_ref ?? null);
  if (!textChanged && !refChanged) return { ok: true, unchanged: true, mode: "revision" };
  if (!(await record(admin, actor, "cfca_revision_criterion_updated", "framework_competency", at.comp.id, at.comp.name,
    { criterion_id: at.k.skill_id, text_changed: textChanged, source_changed: refChanged, substantive: textChanged, framework_id: place.fw.id }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  if (!at.comp.isNew) { const e = await ensureCompetency(admin, actor, rev, at.comp.id); if (e !== true) return e; }
  const { error } = await admin.from("framework_revision_criterion").update({ name: text, source_ref: sourceRef, updated_by: actor.userId }).eq("revision_id", rev).eq("skill_id", at.k.skill_id);
  return error ? NOT_SAVED : { ok: true, unchanged: false, mode: "revision", revisionId: rev };
}

/** retire_criterion / restore_criterion in the revision. Retiring a criterion a published method pins is refused. */
async function reviseSetActive(admin: any, actor: Actor, place: Place, b: any, active: boolean): Promise<Result<{ unchanged: boolean; mode: "revision"; revisionId?: string }>> {
  const at = await criterionNow(admin, place, b?.criterionId);
  if (at === null) return { ok: false, status: 404, error: "That criterion does not exist." };
  if ("ok" in at) return at;
  if (at.k.is_active === active) return { ok: true, unchanged: true, mode: "revision" };
  if (!active) {
    const pins = await pinnedByActiveMethod(admin, at.k.skill_id);
    if (pins === null) return { ok: false, status: 503, error: "The assessment methods could not be checked just now. Nothing has changed." };
    if (pins.length) return { ok: false, status: 409, error: `This criterion is used by the published assessment method ${pins.join(", ")}. Remove it from the method first.` };
  }
  if (!(await record(admin, actor, active ? "cfca_revision_criterion_restored" : "cfca_revision_criterion_retired", "framework_competency", at.comp.id, at.comp.name,
    { criterion_id: at.k.skill_id, substantive: true, framework_id: place.fw.id }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  if (!at.comp.isNew) { const e = await ensureCompetency(admin, actor, rev, at.comp.id); if (e !== true) return e; }
  const { error } = await admin.from("framework_revision_criterion").update({ is_active: active, updated_by: actor.userId }).eq("revision_id", rev).eq("skill_id", at.k.skill_id);
  return error ? NOT_SAVED : { ok: true, unchanged: false, mode: "revision", revisionId: rev };
}

/** move_criterion { criterionId, component?, competencyId?, position? } in the revision. */
async function reviseMoveCriterion(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ kind: ReturnType<typeof classifyMove>; substantive: boolean; mode: "revision" | "draft" | "direct"; unchanged?: boolean; revisionId?: string }>> {
  const at = await criterionNow(admin, place, b?.criterionId);
  if (at === null) return { ok: false, status: 404, error: "That criterion does not exist." };
  if ("ok" in at) return at;
  const position = parsePosition(b?.position);
  if (position === undefined) return { ok: false, status: 422, error: "The position is a whole number from 1." };
  const toId = b?.competencyId == null || b.competencyId === "" ? at.comp.id : b.competencyId;
  const to = toId === at.comp.id ? at.comp : await competencyNow(admin, place, toId);
  if (to && "ok" in to) return to;
  if (!to) return { ok: false, status: 422, error: "A criterion moves only to a competency of its own framework." };
  const component = b && "component" in b && b.component != null ? b.component : at.k.component_code;
  const kind = classifyMove({ competencyId: at.comp.id, component: at.k.component_code }, { competencyId: to.id, component });
  const src = await criteriaNow(admin, place.revisionId, at.comp.id);
  if (!src) return UNREADABLE;
  let inRevision = at.comp.isNew;
  if (!inRevision && place.revisionId) { const r = await revComp(admin, place.revisionId, at.comp.id); if (r && "ok" in r) return r; inRevision = !!r; }
  if (kind === "reorder") {
    if (!inRevision) {
      // Organisational, on a competency the revision does not hold: the layout draft, exactly as before (F4).
      const section = src.filter(r => (r.component_code ?? null) === (at.k.component_code ?? null)).map(r => ({ id: r.skill_id, component: r.component_code }));
      const order = placeCriterion(section, { id: at.k.skill_id, component: at.k.component_code }, position);
      const r = await reorderLayout(admin, actor, { frameworkId: place.fw.id, level: "criteria", parentId: at.comp.id, component: at.k.component_code, order });
      return r.ok ? { ok: true, kind, substantive: false, mode: r.mode, unchanged: r.unchanged } : r;
    }
    // Organisational, within a competency the revision holds: its proposed order (F4, recorded on the framework).
    const order = placeCriterion(src.map(r => ({ id: r.skill_id, component: r.component_code })), { id: at.k.skill_id, component: at.k.component_code }, position);
    if (order.every((id, i) => src[i]?.skill_id === id)) return { ok: true, kind, substantive: false, mode: "revision", unchanged: true };
    if (!(await record(admin, actor, "reorder_layout", "framework", place.fw.id, place.fw.name, { level: "criteria", parent_id: at.comp.id, mode: "revision" }))) return NOT_RECORDED;
    return (await renumberRev(admin, place.revisionId!, order, src)) ? { ok: true, kind, substantive: false, mode: "revision", unchanged: false, revisionId: place.revisionId! } : NOT_SAVED;
  }
  if (!at.k.is_active) return { ok: false, status: 409, error: "This criterion is retired. Restore it before moving it." };
  const checked = await checkComponent(admin, component);
  if (typeof checked !== "string") return checked;
  if (to.id !== at.comp.id && at.k.origin_skill_id) {
    // 752 refuses a publication whose pending layout names a criterion under a competency it no longer belongs to.
    const pl = await pendingLayout(admin, place.fw.id);
    if (pl && "ok" in pl) return pl;
    if (pl && (pl.layout.criteria?.[at.comp.id] ?? []).includes(at.k.skill_id))
      return { ok: false, status: 409, error: "A pending layout names this criterion in its current competency. Discard the pending layout first, then move it." };
  }
  const dst = to.id === at.comp.id ? src : await criteriaNow(admin, place.revisionId, to.id);
  if (!dst) return UNREADABLE;
  const order = placeCriterion(dst.map(r => ({ id: r.skill_id, component: r.component_code })), { id: at.k.skill_id, component: checked }, position);
  const detail = { criterion_id: at.k.skill_id, substantive: true, kind, from: { competency_id: at.comp.id, component: at.k.component_code }, to: { competency_id: to.id, component: checked }, position, framework_id: place.fw.id };
  if (!(await record(admin, actor, "cfca_revision_criterion_moved", "framework_competency", at.comp.id, at.comp.name, detail))) return NOT_RECORDED;
  if (to.id !== at.comp.id && !(await record(admin, actor, "cfca_revision_criterion_moved", "framework_competency", to.id, to.name, detail))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  for (const c of [at.comp, to]) if (!c.isNew) { const e = await ensureCompetency(admin, actor, rev, c.id); if (e !== true) return e; }
  const { error } = await admin.from("framework_revision_criterion").update({ competency_id: to.id, component_code: checked, sort_order: order.indexOf(at.k.skill_id) + 1, updated_by: actor.userId })
    .eq("revision_id", rev).eq("skill_id", at.k.skill_id);
  if (error) return { ok: false, status: 422, error: "The criterion could not be moved." };
  const [nowTo, nowFrom] = await Promise.all([revCrits(admin, rev, to.id), to.id === at.comp.id ? Promise.resolve(null) : revCrits(admin, rev, at.comp.id)]);
  const okTo = !!nowTo && (await renumberRev(admin, rev, order, nowTo));
  const okFrom = to.id === at.comp.id ? true : !!nowFrom && (await renumberRev(admin, rev, nowFrom.map(r => r.skill_id), nowFrom));
  if (!okTo || !okFrom) return { ok: false, status: 503, error: "The criterion was moved, but the order of the others could not be updated. Reorder the section to tidy it." };
  return { ok: true, kind, substantive: true, mode: "revision", revisionId: rev };
}

// ── 771: the structure of a published framework, in its revision ─────────────────────────────────────────────────────

/** The CPU a revision competency may name: a live CPU of the framework (cpuFor), or a NEW CPU of this revision. */
async function revisionCpuFor(admin: any, place: Place, cpuId: unknown): Promise<{ ok: true; practiceId: string | null; cpuId: string | null } | { ok: false; error: string }> {
  const live = await cpuFor(admin, place.fw.id, cpuId);
  if (live.ok || !isId(cpuId) || !place.revisionId) return live;
  const n = await newInRevision(admin, "framework_revision_cpu", "cpu_id", cpuId);
  return n && n.revisionId === place.revisionId ? { ok: true, practiceId: n.row.practice_id, cpuId } : live;
}

/** A domain of the framework of this place: live, or NEW in its open revision. null = neither. */
async function domainHere(admin: any, place: Place, id: unknown): Promise<{ id: string; isNew: boolean; name: string; code: string | null } | null | Fail> {
  if (!isId(id)) return null;
  const { data, error } = await admin.from("framework_domains").select("id, framework_id, name, code").eq("id", id).maybeSingle();
  if (error) return UNREADABLE;
  if (data) return data.framework_id === place.fw.id ? { id: data.id, isNew: false, name: data.name, code: data.code ?? null } : null;
  const n = await newInRevision(admin, "framework_revision_domain", "domain_id", id);
  if (n === undefined) return UNREADABLE;
  return n && n.revisionId === place.revisionId ? { id, isNew: true, name: n.row.name, code: n.row.code ?? null } : null;
}

/** A practice of the framework of this place: live, or NEW in its open revision. null = neither. */
async function practiceHere(admin: any, place: Place, id: unknown): Promise<{ id: string; isNew: boolean } | null | Fail> {
  if (!isId(id)) return null;
  const live = await practiceInFramework(admin, id);
  if (live) return live.framework_id === place.fw.id ? { id: live.id, isNew: false } : null;
  const n = await newInRevision(admin, "framework_revision_practice", "practice_id", id);
  if (n === undefined) return UNREADABLE;
  return n && n.revisionId === place.revisionId ? { id, isNew: true } : null;
}

/** The structure action's framework: through the live row it names, or a NEW row of an open revision. */
async function structureFramework(admin: any, action: string, b: any): Promise<string | null | undefined> {
  const viaNew = async (table: string, col: string, id: string) => { const n = await newInRevision(admin, table, col, id); return n === undefined ? undefined : n?.frameworkId ?? null; };
  switch (action) {
    case "update_framework": case "create_domain": case "move_competency_domain": return isId(b?.frameworkId) ? b.frameworkId : null;
    case "rename_domain": case "create_practice": {
      if (!isId(b?.domainId)) return null;
      return frameworkIdOf(admin, "domain", b.domainId);
    }
    case "rename_practice": case "create_cpu": {
      if (!isId(b?.practiceId)) return null;
      const live = await practiceInFramework(admin, b.practiceId);
      return live ? live.framework_id : viaNew("framework_revision_practice", "practice_id", b.practiceId);
    }
    case "rename_cpu": {
      if (!isId(b?.cpuId)) return null;
      const { data, error } = await admin.from("clinical_practice_units").select("id, practice_id").eq("id", b.cpuId).maybeSingle();
      if (error) return undefined;
      const live = data ? await practiceInFramework(admin, data.practice_id) : null;
      return live ? live.framework_id : viaNew("framework_revision_cpu", "cpu_id", b.cpuId);
    }
  }
  return null;
}

/**
 * 771: a structure action on a published governed framework, done in its revision draft. null = not such a framework, or
 * (move_competency_domain) a move the layout draft owns: the caller's existing path applies, unchanged.
 */
async function routeStructure(admin: any, actor: Actor, action: string, b: any): Promise<Result<any> | null> {
  const fwId = await structureFramework(admin, action, b);
  if (fwId === undefined) return UNREADABLE;
  if (!fwId) return null;
  const fw = await frameworkRow(admin, fwId);
  if (fw === undefined) return UNREADABLE;
  if (!goesToRevision(fw)) return null;
  if (action === "move_competency_domain") {
    // Only a NEW competency of the revision, or a move into a NEW domain, is the revision's. Every other move is the
    // layout draft's (760), unchanged.
    const [nc, nd] = isId(b?.competencyId) && isId(b?.domainId)
      ? await Promise.all([newInRevision(admin, "framework_revision_competency", "competency_id", b.competencyId), newInRevision(admin, "framework_revision_domain", "domain_id", b.domainId)])
      : [null, null];
    if (nc === undefined || nd === undefined) return UNREADABLE;
    if (!nc && !nd) return null;
    if (!nc) return { ok: false, status: 409, error: "A published competency moves into a new domain only after the new domain is published. Publish this revision first, then move it." };
  }
  const [r770, r771] = await Promise.all([revisionsReady(admin), structureReady(admin)]);
  if (r770 === null || r771 === null) return UNREADABLE;
  if (!r770 || !r771) return NOT_READY_771;
  const open = await openRevision(admin, fw!.id);
  if (open && "ok" in open) return open;
  const place: Place = { fw: fw!, revisionId: open?.id ?? null };
  switch (action) {
    case "update_framework": return reviseFramework(admin, actor, place, b);
    case "create_domain": return reviseCreateDomain(admin, actor, place, b);
    case "rename_domain": return reviseRenameDomain(admin, actor, place, b);
    case "create_practice": return reviseCreatePractice(admin, actor, place, b);
    case "rename_practice": return reviseRenamePractice(admin, actor, place, b);
    case "create_cpu": return reviseCreateCpu(admin, actor, place, b);
    case "rename_cpu": return reviseRenameCpu(admin, actor, place, b);
    case "move_competency_domain": return reviseMoveNewCompetency(admin, actor, place, b);
  }
  return null;
}

type Done = Result<{ unchanged: boolean; mode: "revision"; revisionId?: string }>;
const recordOn = (admin: any, actor: Actor, place: Place, action: string, detail: Record<string, unknown>) =>
  record(admin, actor, action, "framework", place.fw.id, place.fw.name, { ...detail, mode: "revision" });

/** update_framework { frameworkId, name, description? } on a published framework: the label, proposed. */
async function reviseFramework(admin: any, actor: Actor, place: Place, b: any): Promise<Done> {
  const lab = parseFrameworkLabel(b);
  if (!lab.ok) return { ok: false, status: 422, error: lab.error };
  const { data: live, error } = await admin.from("frameworks").select("name, description").eq("id", place.fw.id).maybeSingle();
  if (error || !live) return UNREADABLE;
  const asLive = live.name === lab.value.name && (live.description ?? null) === lab.value.description;
  let now: { framework_proposed: boolean; proposed_name: string | null; proposed_description: string | null } | null = null;
  if (place.revisionId) {
    const r = await admin.from("framework_revision").select("framework_proposed, proposed_name, proposed_description").eq("id", place.revisionId).maybeSingle();
    if (r.error) return UNREADABLE;
    now = r.data ?? null;
  }
  const same = now?.framework_proposed ? now.proposed_name === lab.value.name && (now.proposed_description ?? null) === lab.value.description : asLive;
  if (same) return { ok: true, unchanged: true, mode: "revision", ...(place.revisionId ? { revisionId: place.revisionId } : {}) };
  if (!(await recordOn(admin, actor, place, "cfca_revision_framework_updated", { name: lab.value.name, description_set: !!lab.value.description }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  const { error: uErr } = await admin.from("framework_revision")
    .update(asLive ? { framework_proposed: false, proposed_name: null, proposed_description: null } : { framework_proposed: true, proposed_name: lab.value.name, proposed_description: lab.value.description })
    .eq("id", rev).eq("status", "open");
  return uErr ? NOT_SAVED : { ok: true, unchanged: false, mode: "revision", revisionId: rev };
}

/** create_domain { frameworkId, name, code?, areaId? }: a NEW domain proposed with its final id, at the end. */
async function reviseCreateDomain(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ id: string; mode: "revision"; revisionId: string }>> {
  const lab = parseDomainLabel(b);
  if (!lab.ok) return { ok: false, status: 422, error: lab.error };
  const areaId = b?.areaId == null || b.areaId === "" ? null : isId(b.areaId) ? b.areaId : undefined;
  if (areaId === undefined) return { ok: false, status: 422, error: "That Area is not valid." };
  if (areaId) {
    const { data, error } = await admin.from("framework_areas").select("id").eq("id", areaId).eq("framework_id", place.fw.id).limit(1);
    if (error) return UNREADABLE;
    if (!data?.length) return { ok: false, status: 422, error: "A new domain is placed in an Area of its own framework." };
  }
  const [live, newer] = await Promise.all([
    admin.from("framework_domains").select("sort_order").eq("framework_id", place.fw.id).order("sort_order", { ascending: false }).limit(1),
    place.revisionId ? admin.from("framework_revision_domain").select("sort_order").eq("revision_id", place.revisionId).limit(500) : Promise.resolve({ data: [], error: null }),
  ]);
  if (live.error || newer.error) return UNREADABLE;
  const sort = Math.max(live.data?.[0]?.sort_order ?? 0, ...((newer.data ?? []) as any[]).map(r => r.sort_order ?? 0)) + 1;
  const id = crypto.randomUUID();
  if (!(await recordOn(admin, actor, place, "cfca_revision_domain_created", { domain_id: id, name: lab.value.name, code: lab.value.code, area_id: areaId }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  const { error } = await admin.from("framework_revision_domain").insert({ revision_id: rev, domain_id: id, name: lab.value.name, code: lab.value.code, area_id: areaId, sort_order: sort,
    created_by: actor.userId, updated_by: actor.userId });
  return error ? { ok: false, status: 422, error: "The domain could not be proposed." } : { ok: true, id, mode: "revision", revisionId: rev };
}

/**
 * A rename of a live row (inserted once with its origin, then updated) or an edit of a NEW row of the revision, by its
 * stable id. `current` is what the row reads as now (proposed, else live).
 */
async function proposeRename(admin: any, actor: Actor, place: Place, o: { table: string; col: string; id: string; isNew: boolean; action: string; fields: Record<string, unknown>; current: Record<string, unknown> | null }): Promise<Done> {
  let row: any = null;
  if (place.revisionId) {
    const r = await admin.from(o.table).select("*").eq("revision_id", place.revisionId).eq(o.col, o.id).limit(1);
    if (r.error) return UNREADABLE;
    row = r.data?.[0] ?? null;
  }
  const cur = row ?? o.current;
  if (cur && Object.entries(o.fields).every(([k, v]) => (cur[k] ?? null) === (v ?? null)))
    return { ok: true, unchanged: true, mode: "revision", ...(place.revisionId ? { revisionId: place.revisionId } : {}) };
  if (!(await recordOn(admin, actor, place, o.action, { [o.col]: o.id, ...o.fields }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  const { error } = row || o.isNew
    ? await admin.from(o.table).update({ ...o.fields, updated_by: actor.userId }).eq("revision_id", rev).eq(o.col, o.id)
    : await admin.from(o.table).insert({ revision_id: rev, [o.col]: o.id, ["origin_" + o.col]: o.id, ...o.fields, created_by: actor.userId, updated_by: actor.userId });
  return error ? NOT_SAVED : { ok: true, unchanged: false, mode: "revision", revisionId: rev };
}

/** rename_domain { domainId, name, code? }: a live domain of the framework, or a new one of the revision. */
async function reviseRenameDomain(admin: any, actor: Actor, place: Place, b: any): Promise<Done> {
  const lab = parseDomainLabel(b);
  if (!lab.ok) return { ok: false, status: 422, error: lab.error };
  const d = await domainHere(admin, place, b?.domainId);
  if (d && "ok" in d) return d;
  if (!d) return { ok: false, status: 404, error: "That domain does not exist." };
  return proposeRename(admin, actor, place, { table: "framework_revision_domain", col: "domain_id", id: d.id, isNew: d.isNew, action: "cfca_revision_domain_renamed",
    fields: { name: lab.value.name, code: lab.value.code }, current: { name: d.name, code: d.code } });
}

/** create_practice { domainId, name, code, description? }: in a live domain or a new domain of the revision. */
async function reviseCreatePractice(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ id: string; mode: "revision"; revisionId: string }>> {
  const lab = parsePracticeLabel(b);
  if (!lab.ok) return { ok: false, status: 422, error: lab.error };
  const d = await domainHere(admin, place, b?.domainId);
  if (d && "ok" in d) return d;
  if (!d) return { ok: false, status: 404, error: "That domain does not exist." };
  const id = crypto.randomUUID();
  if (!(await recordOn(admin, actor, place, "cfca_revision_practice_created", { practice_id: id, code: lab.value.code, domain_id: d.id }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  const { error } = await admin.from("framework_revision_practice").insert({ revision_id: rev, practice_id: id, domain_id: d.id, ...lab.value, created_by: actor.userId, updated_by: actor.userId });
  return error ? { ok: false, status: 422, error: "The practice could not be proposed." } : { ok: true, id, mode: "revision", revisionId: rev };
}

/** rename_practice { practiceId, name, code, description? }. */
async function reviseRenamePractice(admin: any, actor: Actor, place: Place, b: any): Promise<Done> {
  const lab = parsePracticeLabel(b);
  if (!lab.ok) return { ok: false, status: 422, error: lab.error };
  const p = await practiceHere(admin, place, b?.practiceId);
  if (p && "ok" in p) return p;
  if (!p) return { ok: false, status: 404, error: "That practice does not exist." };
  const live = p.isNew ? null : (await admin.from("practices").select("name, description, code").eq("id", p.id).maybeSingle()).data ?? null;
  return proposeRename(admin, actor, place, { table: "framework_revision_practice", col: "practice_id", id: p.id, isNew: p.isNew, action: "cfca_revision_practice_renamed", fields: lab.value, current: live });
}

/** create_cpu { practiceId, name, code, description?, riskCategory?, complexity?, reassessmentMonths? }. */
async function reviseCreateCpu(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ id: string; mode: "revision"; revisionId: string }>> {
  const cp = parseCpu(b);
  if (!cp.ok) return { ok: false, status: 422, error: cp.error };
  const p = await practiceHere(admin, place, b?.practiceId);
  if (p && "ok" in p) return p;
  if (!p) return { ok: false, status: 404, error: "That practice does not exist." };
  const id = crypto.randomUUID(), v = cp.value;
  if (!(await recordOn(admin, actor, place, "cfca_revision_cpu_created", { cpu_id: id, code: v.code, practice_id: p.id, risk_category: v.risk }))) return NOT_RECORDED;
  const rev = await ensureRevision(admin, actor, place.fw);
  if (typeof rev !== "string") return rev;
  const { error } = await admin.from("framework_revision_cpu").insert({ revision_id: rev, cpu_id: id, practice_id: p.id, name: v.name, description: v.description, code: v.code,
    risk_category: v.risk, complexity: v.complexity, reassessment_months: v.months, created_by: actor.userId, updated_by: actor.userId });
  return error ? { ok: false, status: 422, error: "The CPU could not be proposed." } : { ok: true, id, mode: "revision", revisionId: rev };
}

/** rename_cpu { cpuId, name, code, description? }. Its risk is not changed by a rename. */
async function reviseRenameCpu(admin: any, actor: Actor, place: Place, b: any): Promise<Done> {
  const lab = parseCpuLabel(b);
  if (!lab.ok) return { ok: false, status: 422, error: lab.error };
  if (!isId(b?.cpuId)) return { ok: false, status: 400, error: "Choose a CPU." };
  const { data: u, error } = await admin.from("clinical_practice_units").select("id, practice_id, name, description, code").eq("id", b.cpuId).maybeSingle();
  if (error) return UNREADABLE;
  let isNew = false;
  if (u) {
    const pr = await practiceInFramework(admin, u.practice_id);
    if (!pr || pr.framework_id !== place.fw.id) return { ok: false, status: 404, error: "That CPU does not exist." };
  } else {
    const n = await newInRevision(admin, "framework_revision_cpu", "cpu_id", b.cpuId);
    if (n === undefined) return UNREADABLE;
    if (!n || n.revisionId !== place.revisionId) return { ok: false, status: 404, error: "That CPU does not exist." };
    isNew = true;
  }
  return proposeRename(admin, actor, place, { table: "framework_revision_cpu", col: "cpu_id", id: b.cpuId, isNew, action: "cfca_revision_cpu_renamed", fields: lab.value,
    current: u ? { name: u.name, description: u.description ?? null, code: u.code ?? null } : null });
}

/** move_competency_domain { frameworkId, competencyId, domainId } for a NEW competency of the revision: to the end of a
 *  live domain or a new domain of the revision. Organisational (not authorship), recorded on the framework. */
async function reviseMoveNewCompetency(admin: any, actor: Actor, place: Place, b: any): Promise<Result<{ mode: "revision"; unchanged: boolean; layoutPending: boolean; revisionId: string }>> {
  if (!place.revisionId) return { ok: false, status: 404, error: "That competency does not exist." };
  if (b?.position != null) return { ok: false, status: 422, error: "A new competency of a revision is placed at the end of its domain. Reorder it after the revision is published." };
  const rc = await revComp(admin, place.revisionId, b.competencyId);
  if (rc && "ok" in rc) return rc;
  if (!rc || rc.origin_competency_id) return { ok: false, status: 404, error: "That competency does not exist." };
  const d = await domainHere(admin, place, b?.domainId);
  if (d && "ok" in d) return d;
  if (!d) return { ok: false, status: 422, error: "A competency moves only to a domain of its own framework." };
  if (rc.domain_id === d.id) return { ok: true, mode: "revision", unchanged: true, layoutPending: false, revisionId: place.revisionId };
  const [live, newer] = await Promise.all([
    admin.from("framework_competencies").select("sort_order").eq("domain_id", d.id).order("sort_order", { ascending: false }).limit(1),
    admin.from("framework_revision_competency").select("competency_id, sort_order").eq("revision_id", place.revisionId).eq("domain_id", d.id).limit(500),
  ]);
  if (live.error || newer.error) return UNREADABLE;
  const sort = Math.max(live.data?.[0]?.sort_order ?? 0, ...((newer.data ?? []) as any[]).filter(r => r.competency_id !== rc.competency_id).map(r => r.sort_order ?? 0)) + 1;
  if (!(await recordOn(admin, actor, place, "move_competency_domain", { competency_id: rc.competency_id, from_domain_id: rc.domain_id, to_domain_id: d.id }))) return NOT_RECORDED;
  const { error } = await admin.from("framework_revision_competency").update({ domain_id: d.id, sort_order: sort, updated_by: actor.userId })
    .eq("revision_id", place.revisionId).eq("competency_id", rc.competency_id);
  return error ? NOT_SAVED : { ok: true, mode: "revision", unchanged: false, layoutPending: false, revisionId: place.revisionId };
}

/** discard_revision { frameworkId }: the revision is closed. Nothing live ever changed, so nothing is undone. */
export async function discardRevision(admin: any, actor: Actor, b: any): Promise<Result<{ discarded: boolean }>> {
  if (!isId(b?.frameworkId)) return { ok: false, status: 400, error: "Choose a framework." };
  const ready = await revisionsReady(admin);
  if (ready === null) return UNREADABLE;
  if (!ready) return NOT_READY;
  const fw = await frameworkRow(admin, b.frameworkId);
  if (fw === undefined) return UNREADABLE;
  if (!fw || fw.hospital_id !== null) return { ok: false, status: 404, error: "That is not a shared framework." };
  const open = await openRevision(admin, fw.id);
  if (open && "ok" in open) return open;
  if (!open) return { ok: true, discarded: false };
  if (!(await record(admin, actor, "cfca_revision_discarded", "framework_revision", open.id, fw.name, { framework_id: fw.id }))) return NOT_RECORDED;
  const { error } = await admin.from("framework_revision").update({ status: "discarded", closed_by: actor.userId }).eq("id", open.id).eq("status", "open");
  return error ? NOT_SAVED : { ok: true, discarded: true };
}

// ── Review, comparison and the publication check ─────────────────────────────────────────────────────────────────

/** Every competency of an open revision, with its proposed hash. null = no open revision, Fail = unreadable. */
export async function loadRevision(admin: any, frameworkId: string): Promise<{ head: RevisionHead; comps: RevComp[]; crits: RevCrit[]; hashes: Map<string, { proposed: string; live: string | null; base: string | null }>;
  structure: RevStructure } | null | Fail> {
  const head = await openRevision(admin, frameworkId);
  if (!head || "ok" in head) return head;
  const [c, k, h, structure] = await Promise.all([
    admin.from("framework_revision_competency").select(COMP_COLS).eq("revision_id", head.id).limit(2000),
    admin.from("framework_revision_criterion").select(CRIT_COLS).eq("revision_id", head.id).limit(20000),
    admin.rpc("framework_revision_hashes", { p_revision: head.id }),
    loadStructure(admin, head.id),
  ]);
  if (c.error || k.error || h.error || !structure) return UNREADABLE;
  return { head, comps: c.data ?? [], crits: k.data ?? [], structure,
    hashes: new Map((h.data ?? []).map((r: any) => [r.competency_id, { proposed: r.proposed_hash, live: r.live_hash ?? null, base: r.base_hash ?? null }])) };
}

const EMPTY_STRUCTURE: RevStructure = { framework: null, domains: [], practices: [], cpus: [] };
/** 771: the structure a revision proposes. Before 771 there is none (empty). null = unreadable. */
async function loadStructure(admin: any, revisionId: string): Promise<RevStructure | null> {
  const ready = await structureReady(admin);
  if (ready === null) return null;
  if (!ready) return EMPTY_STRUCTURE;
  const [l, d, p, u] = await Promise.all([
    admin.from("framework_revision").select("framework_proposed, proposed_name, proposed_description").eq("id", revisionId).maybeSingle(),
    admin.from("framework_revision_domain").select(DOM_COLS).eq("revision_id", revisionId).limit(1000),
    admin.from("framework_revision_practice").select(PRA_COLS).eq("revision_id", revisionId).limit(2000),
    admin.from("framework_revision_cpu").select(CPU_COLS).eq("revision_id", revisionId).limit(2000),
  ]);
  if (l.error || d.error || p.error || u.error) return null;
  return { framework: l.data?.framework_proposed ? { name: l.data.proposed_name, description: l.data.proposed_description ?? null } : null,
    domains: d.data ?? [], practices: p.data ?? [], cpus: u.data ?? [] };
}

/** The clinical state of each revision competency at its PROPOSED content (versions bound to the stable id). */
export async function revisionReviews(admin: any, ids: readonly string[], proposedHash: ReadonlyMap<string, string>): Promise<Map<string, ClinicalReview> | null> {
  const out = new Map<string, ClinicalReview>();
  if (!ids.length) return out;
  const [a, b] = await Promise.all([
    admin.from("clinical_content_version").select("id, competency_id, proposed_competency_id, content_hash, required_approvals, created_at").in("competency_id", [...ids]),
    admin.from("clinical_content_version").select("id, competency_id, proposed_competency_id, content_hash, required_approvals, created_at").in("proposed_competency_id", [...ids]),
  ]);
  if (a.error || b.error) return null;
  const versions = [...new Map([...(a.data ?? []), ...(b.data ?? [])].map((v: any) => [v.id, { ...v, competency_id: v.competency_id ?? v.proposed_competency_id }])).values()];
  const d = versions.length ? await admin.from("clinical_review_decision").select("version_id, decision, created_at").in("version_id", versions.map(v => v.id)) : { data: [], error: null };
  if (d.error) return null;
  for (const id of ids) out.set(id, clinicalStatus(proposedHash.get(id) ?? null, versions.filter(v => v.competency_id === id), d.data ?? []));
  return out;
}

/** The revision in the review-batch shape (review_preview / review_submit with revision: true): proposed hashes, proposed states. */
export async function loadRevisionForReview(admin: any, frameworkId: string): Promise<{ fw: any; hashes: Map<string, string>; revisionId: string } | { error: string; status: number }> {
  const fw = await frameworkRow(admin, frameworkId);
  if (fw === undefined) return { error: "The framework could not be read just now.", status: 503 };
  if (!fw || fw.hospital_id !== null) return { error: "That is not a shared framework.", status: 404 };
  const ready = await revisionsReady(admin);
  if (ready !== true) return ready === null ? { error: UNREADABLE.error, status: 503 } : { error: NOT_READY.error, status: 409 };
  const rv = await loadRevision(admin, fw.id);
  if (rv && "ok" in rv) return { error: rv.error, status: rv.status };
  if (!rv) return { error: "This framework has no open revision draft.", status: 409 };
  const { data: doms, error } = await admin.from("framework_domains").select("id, name, sort_order, framework_competencies(id, domain_id)").eq("framework_id", fw.id);
  if (error) return { error: "The framework could not be read just now.", status: 503 };
  const hashes = new Map([...rv.hashes].map(([id, h]) => [id, h.proposed]));
  const reviews = await revisionReviews(admin, rv.comps.map(c => c.competency_id), hashes);
  const domainOf = new Map<string, string>(((doms ?? []) as any[]).flatMap(d => (d.framework_competencies ?? []).map((c: any) => [c.id, d.id] as [string, string])));
  // 771: domains carry their proposed names, and NEW domains of the revision follow the live ones (their new competencies).
  const renamed = new Map(rv.structure.domains.filter(d => d.origin_domain_id).map(d => [d.domain_id, d.name]));
  const sorted = [...((doms ?? []) as any[]).map(d => ({ ...d, name: renamed.get(d.id) ?? d.name })).sort(byRowOrder),
    ...rv.structure.domains.filter(d => !d.origin_domain_id).map(d => ({ id: d.domain_id, name: d.name, sort_order: d.sort_order }))];
  return {
    hashes, revisionId: rv.head.id,
    fw: { id: fw.id, name: fw.name, code: null, pubStatus: fw.pub_status ?? "draft",
      domains: sorted.map((d: any) => ({ id: d.id, name: d.name,
        competencies: rv.comps.filter(c => (c.domain_id ?? domainOf.get(c.competency_id)) === d.id)
          .map(c => ({ id: c.competency_id, code: c.code, name: c.name, clinical: reviews ? reviews.get(c.competency_id) ?? null : null, checks: [] })) })) },
  };
}

/** Put the PROPOSED content of one revision competency forward for clinical review (395, the database computes it). */
export async function submitRevisionVersion(admin: any, frameworkId: string, competencyId: string, submitter: string)
  : Promise<{ ok: true; versionId: string; required: number } | { ok: false; error: string }> {
  const head = await openRevision(admin, frameworkId);
  if (!head || "ok" in head) return { ok: false, error: head ? head.error : "This framework has no open revision draft." };
  const rc = await revComp(admin, head.id, competencyId);
  if (!rc || "ok" in rc) return { ok: false, error: rc ? rc.error : "That competency has no change in the revision draft." };
  const [cpu, audit, required] = await Promise.all([
    rc.cpu_id ? admin.from("clinical_practice_units").select("risk_category").eq("id", rc.cpu_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("audit_log").select("actor_id, action").or(`entity_id.eq.${competencyId},entity_id.eq.${frameworkId}`).limit(2000),
    loadRequiredApprovals(admin),
  ]);
  if (audit.error) return { ok: false, error: "The authorship trail could not be read, so nothing was put forward." };
  // 771: a NEW CPU of the revision carries its own risk (the 771 floor reads it the same way).
  const newCpu = rc.cpu_id && !cpu.data ? await newInRevision(admin, "framework_revision_cpu", "cpu_id", rc.cpu_id) : null;
  const risk = reviewRisk(rc.risk_category, cpu.data?.risk_category ?? (newCpu && newCpu.revisionId === head.id ? newCpu.row.risk_category : null));
  const { data: v, error } = await admin.from("clinical_content_version").insert({
    ...(rc.origin_competency_id ? { competency_id: competencyId } : { proposed_competency_id: competencyId }), revision_id: head.id,
    content_hash: "computed-by-trigger", content_snapshot: {}, authored_by: authorsOf(submitter, audit.data ?? []), submitted_by: submitter,
    required_approvals: required[risk], risk_basis: `${risk} risk`,
  }).select("id, required_approvals").single();
  if (error) return { ok: false, error: /duplicate key|unique/i.test(error.message ?? "") ? "This exact content is already in clinical review." : reviewRefusal(error.message) };
  return { ok: true, versionId: v.id, required: v.required_approvals };
}

/** compare_revision { frameworkId }: what the open revision would publish, against what is published now. */
export async function loadRevisionDiff(admin: any, frameworkId: string): Promise<{ status: "no_revision" } | { status: "compared"; revision: { id: string; updatedAt: string }; diff: FrameworkDiff } | Fail> {
  const rv = await loadRevision(admin, frameworkId);
  if (rv && "ok" in rv) return rv;
  if (!rv) return { status: "no_revision" };
  const live = await admin.from("frameworks").select(`name, description, component_order,
    framework_domains(id, name, code, sort_order,
      framework_competencies(id, code, name, description, sort_order, learning_outcomes, expected_level_id, risk_category, practice_id, cpu_id,
        competency_skills(id, name, sort_order, component_code, is_active)))`).eq("id", frameworkId).single();
  if (live.error || !live.data) return UNREADABLE;
  return { status: "compared", revision: { id: rv.head.id, updatedAt: rv.head.updated_at }, diff: diffFramework(normalise(live.data), normalise(overlayRevision(live.data, rv.comps, rv.crits, rv.structure))) };
}

/**
 * For the publication decision: the open revision (null = none or 770 absent), why it can no longer be applied, and the
 * ids of its NEW competencies (their authors are contributors, as the 640 guard reads them once applied).
 */
export async function revisionForPublication(admin: any, frameworkId: string): Promise<{ id: string; updatedAt: string; problem: string | null; newIds: string[] } | null | Fail> {
  const head = await openRevision(admin, frameworkId);
  if (!head || "ok" in head) return head;
  const [p, n] = await Promise.all([
    admin.rpc("framework_revision_problem", { p_revision: head.id }),
    admin.from("framework_revision_competency").select("competency_id").eq("revision_id", head.id).is("origin_competency_id", null).limit(2000),
  ]);
  if (p.error || n.error) return UNREADABLE;
  return { id: head.id, updatedAt: head.updated_at, problem: typeof p.data === "string" && p.data ? p.data : null, newIds: (n.data ?? []).map((r: any) => r.competency_id) };
}
