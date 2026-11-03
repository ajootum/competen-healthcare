/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR COMPETENCY ADAPTER, CRITERION PICKER (Checklist Studio S2).
//
// ⚠ THIS FILE IS THE ONE PLACE THE STUDIO KNOWS ABOUT COMPETENCIES. The Studio itself is universal: an item has a prompt,
// a response type and an optional typed mapping. Here a framework criterion (a competency_skills row) becomes an item
// plus a mapping { kind competency_criterion } with a frozen snapshot of what the criterion said and which competency
// hash and framework version it had. The literal ban on src/lib/assessment/studio/** exempts this file by path.
//
// The read goes through asmt_scholar_criteria(p_framework_code) (migration 893) and falls back to the same read made
// from the framework tables when that function is not applied on this environment.
import type { createAdminClient } from "@/lib/supabase/server";
import type { EditorItem, ItemMapping } from "../../studio/types";
import type { ResponseScale } from "../../core";

type Admin = ReturnType<typeof createAdminClient>;

export const CRITERION_KIND = "competency_criterion";

export interface FrameworkOption {
  code: string;
  name: string;
  version: string;
  pubStatus: string;
}

/** One criterion with everything the picker shows. Mirrors the columns of asmt_scholar_criteria. */
export interface CriterionRow {
  competency_id: string;
  competency_code: string | null;
  competency_name: string;
  domain_name: string | null;
  skill_id: string;
  sort_order: number;
  component_code: string | null;
  wording: string;
  framework_code: string;
  framework_version: string;
  framework_pub_status: string;
  competency_hash: string | null;
  /** null = could not be established */
  clinically_approved: boolean | null;
}

export interface CriterionTree {
  domains: {
    name: string;
    competencies: {
      id: string; code: string | null; name: string; hash: string | null; clinicallyApproved: boolean | null;
      criteria: CriterionRow[];
    }[];
  }[];
  frameworkCode: string;
  frameworkVersion: string;
  pubStatus: string;
}

const version3 = (f: any) => `${f.version_major ?? 0}.${f.version_minor ?? 0}.${f.version_revision ?? 0}`;

export async function listFrameworks(admin: Admin): Promise<FrameworkOption[]> {
  const { data } = await admin.from("frameworks").select("code, name, version_major, version_minor, version_revision, pub_status")
    .is("hospital_id", null).not("code", "is", null).order("code");
  return ((data ?? []) as any[]).map((f) => ({ code: String(f.code), name: String(f.name), version: version3(f), pubStatus: String(f.pub_status ?? "draft") }));
}

export async function readCriteria(admin: Admin, frameworkCode: string): Promise<CriterionRow[]> {
  const rpc = await admin.rpc("asmt_scholar_criteria", { p_framework_code: frameworkCode });
  if (!rpc.error) return ((rpc.data ?? []) as any[]).map(normaliseRow);
  // The function is not applied here: make the same read from the framework tables.
  const { data: fw } = await admin.from("frameworks").select("id, code, version_major, version_minor, version_revision, pub_status")
    .eq("code", frameworkCode).is("hospital_id", null).maybeSingle();
  if (!fw) return [];
  const { data: doms } = await admin.from("framework_domains").select("id, name, sort_order").eq("framework_id", fw.id).order("sort_order");
  const domIds = ((doms ?? []) as any[]).map((d) => d.id);
  if (!domIds.length) return [];
  const { data: comps } = await admin.from("framework_competencies").select("id, code, name, domain_id, sort_order").in("domain_id", domIds).order("sort_order");
  const compIds = ((comps ?? []) as any[]).map((c) => c.id);
  if (!compIds.length) return [];
  const { data: skills } = await admin.from("competency_skills").select("id, competency_id, name, sort_order, component_code, is_active").in("competency_id", compIds).order("sort_order");
  const hashes = await admin.rpc("competency_content_hashes", { p_ids: compIds });
  const hashOf = new Map<string, string>(((hashes.data ?? []) as any[]).map((h) => [String(h.competency_id), String(h.content_hash)]));
  const approvedOf = new Map<string, boolean | null>();
  if (compIds.length <= 80) {
    await Promise.all(compIds.map(async (id) => {
      const r = await admin.rpc("competency_clinically_approved", { p_competency: id });
      approvedOf.set(id, r.error ? null : Boolean(r.data));
    }));
  }
  const domOf = new Map(((doms ?? []) as any[]).map((d) => [d.id, d]));
  const compOf = new Map(((comps ?? []) as any[]).map((c) => [c.id, c]));
  const domOrder = new Map(((doms ?? []) as any[]).map((d, i) => [d.id, i]));
  return ((skills ?? []) as any[]).filter((s) => s.is_active !== false).map((s) => {
    const c = compOf.get(s.competency_id);
    return normaliseRow({
      competency_id: s.competency_id, competency_code: c?.code ?? null, competency_name: c?.name ?? "", domain_name: domOf.get(c?.domain_id)?.name ?? null,
      skill_id: s.id, sort_order: s.sort_order ?? 0, component_code: s.component_code ?? null, wording: s.name, framework_code: fw.code,
      framework_version: version3(fw), framework_pub_status: fw.pub_status, competency_hash: hashOf.get(s.competency_id) ?? null,
      clinically_approved: approvedOf.has(s.competency_id) ? approvedOf.get(s.competency_id) : null, _dom: domOrder.get(c?.domain_id) ?? 0, _comp: c?.sort_order ?? 0,
    });
  }).sort((a, b) => (a as any)._dom - (b as any)._dom || (a as any)._comp - (b as any)._comp || a.sort_order - b.sort_order);
}

function normaliseRow(r: any): CriterionRow {
  return {
    competency_id: String(r.competency_id), competency_code: r.competency_code ?? null, competency_name: String(r.competency_name ?? ""),
    domain_name: r.domain_name ?? null, skill_id: String(r.skill_id), sort_order: Number(r.sort_order ?? 0), component_code: r.component_code ?? null,
    wording: String(r.wording ?? ""), framework_code: String(r.framework_code), framework_version: String(r.framework_version ?? "0.0.0"),
    framework_pub_status: String(r.framework_pub_status ?? "draft"), competency_hash: r.competency_hash ?? null,
    clinically_approved: r.clinically_approved === null || r.clinically_approved === undefined ? null : Boolean(r.clinically_approved),
    ...(r._dom !== undefined ? { _dom: r._dom, _comp: r._comp } : {}),
  } as CriterionRow;
}

/** framework -> domain -> competency -> criteria, in the order the rows arrive. Pure. */
export function buildCriterionTree(rows: CriterionRow[]): CriterionTree | null {
  if (!rows.length) return null;
  const domains: CriterionTree["domains"] = [];
  for (const r of rows) {
    const dn = r.domain_name ?? "No domain";
    let d = domains.find((x) => x.name === dn);
    if (!d) { d = { name: dn, competencies: [] }; domains.push(d); }
    let c = d.competencies.find((x) => x.id === r.competency_id);
    if (!c) { c = { id: r.competency_id, code: r.competency_code, name: r.competency_name, hash: r.competency_hash, clinicallyApproved: r.clinically_approved, criteria: [] }; d.competencies.push(c); }
    c.criteria.push(r);
  }
  const f = rows[0];
  return { domains, frameworkCode: f.framework_code, frameworkVersion: f.framework_version, pubStatus: f.framework_pub_status };
}

/** The mapping a picked criterion carries: reference, version, hash and a frozen snapshot of what it said. */
export function criterionMapping(r: CriterionRow): ItemMapping {
  return {
    kind: CRITERION_KIND,
    ref_id: r.skill_id,
    ref_code: r.competency_code,
    ref_version: `${r.framework_code} ${r.framework_version}`,
    ref_hash: r.competency_hash,
    ref_snapshot: {
      wording: r.wording, component_code: r.component_code, competency_id: r.competency_id, competency_name: r.competency_name,
      framework_code: r.framework_code, framework_version: r.framework_version,
    },
    relation: "assesses",
  };
}

export interface PickOptions {
  /** stable_key of the new item (the caller generates it) */
  stableKey: string;
  sectionKey: string;
  position: number;
  /** rating scale for the new item. The picker never invents one. */
  scaleVersionId: string | null;
  scale: ResponseScale | null;
  /** use the criterion's component as the item group when the version has that group */
  groupCodes?: string[];
}

/** Picking a criterion creates an item (the wording is the prompt) and its mapping. Pure. */
export function criterionToItem(r: CriterionRow, o: PickOptions): EditorItem {
  const group = r.component_code && (o.groupCodes ?? []).includes(r.component_code) ? r.component_code : null;
  return {
    stable_key: o.stableKey, section_key: o.sectionKey, code: "", prompt: r.wording, guidance: null, expected_performance: [],
    response_type: "rating_scale", scale_version_id: o.scaleVersionId, scale: o.scale, config: {}, fields: [], group_code: group,
    method_codes: [], method_rule: "any", mandatory: false, critical: false, critical_requirements: [], evidence_requirement: null,
    weight: 1, references_text: null, position: o.position, mapping: criterionMapping(r),
  };
}

export interface Drift { drifted: boolean; reasons: string[] }

/**
 * Has the criterion moved on since it was mapped? `current` is the live row for the mapped skill, or null when it
 * is gone or inactive. A mapped item shows the SNAPSHOT wording read-only and raises this flag. Pure.
 */
export function criterionDrift(m: ItemMapping | null, current: CriterionRow | null): Drift {
  if (!m || m.kind !== CRITERION_KIND) return { drifted: false, reasons: [] };
  if (!current) return { drifted: true, reasons: ["The criterion no longer exists or is no longer active in the framework."] };
  const snap = m.ref_snapshot as Record<string, unknown>;
  const reasons: string[] = [];
  if (typeof snap.wording === "string" && snap.wording !== current.wording) reasons.push("The criterion wording has changed in the framework.");
  if ((snap.component_code ?? null) !== (current.component_code ?? null)) reasons.push("The criterion moved to another assessment component.");
  if (m.ref_hash && current.competency_hash && m.ref_hash !== current.competency_hash) reasons.push("The competency content has changed since this item was mapped.");
  if (current.clinically_approved === false) reasons.push("The competency does not hold a current clinical approval.");
  return { drifted: reasons.length > 0, reasons };
}

/** Live rows for the skills an instrument version maps, keyed by skill id, for drift checks. */
export async function readMappedCriteria(admin: Admin, skillIds: string[]): Promise<Map<string, CriterionRow>> {
  const out = new Map<string, CriterionRow>();
  if (!skillIds.length) return out;
  const { data: skills } = await admin.from("competency_skills").select("id, competency_id, name, component_code, is_active, sort_order").in("id", skillIds);
  const live = ((skills ?? []) as any[]).filter((s) => s.is_active !== false);
  const compIds = [...new Set(live.map((s) => s.competency_id as string))];
  if (!compIds.length) return out;
  const { data: comps } = await admin.from("framework_competencies").select("id, code, name, domain_id").in("id", compIds);
  const { data: doms } = await admin.from("framework_domains").select("id, name, framework_id").in("id", ((comps ?? []) as any[]).map((c) => c.domain_id));
  const { data: fws } = await admin.from("frameworks").select("id, code, version_major, version_minor, version_revision, pub_status").in("id", ((doms ?? []) as any[]).map((d) => d.framework_id));
  const hashes = await admin.rpc("competency_content_hashes", { p_ids: compIds });
  const hashOf = new Map<string, string>(((hashes.data ?? []) as any[]).map((h) => [String(h.competency_id), String(h.content_hash)]));
  const approved = new Map<string, boolean | null>();
  await Promise.all(compIds.slice(0, 80).map(async (id) => { const r = await admin.rpc("competency_clinically_approved", { p_competency: id }); approved.set(id, r.error ? null : Boolean(r.data)); }));
  const compOf = new Map(((comps ?? []) as any[]).map((c) => [c.id, c]));
  const domOf = new Map(((doms ?? []) as any[]).map((d) => [d.id, d]));
  const fwOf = new Map(((fws ?? []) as any[]).map((f) => [f.id, f]));
  for (const s of live) {
    const c = compOf.get(s.competency_id); const d = domOf.get(c?.domain_id); const f = fwOf.get(d?.framework_id);
    if (!c || !f) continue;
    out.set(s.id, normaliseRow({
      competency_id: c.id, competency_code: c.code, competency_name: c.name, domain_name: d?.name ?? null, skill_id: s.id, sort_order: s.sort_order ?? 0,
      component_code: s.component_code ?? null, wording: s.name, framework_code: f.code, framework_version: version3(f), framework_pub_status: f.pub_status,
      competency_hash: hashOf.get(c.id) ?? null, clinically_approved: approved.has(c.id) ? approved.get(c.id) : null,
    }));
  }
  return out;
}
