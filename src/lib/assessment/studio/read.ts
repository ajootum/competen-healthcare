/* eslint-disable @typescript-eslint/no-explicit-any */
// Checklist Studio: server readers over the 890 to 892 definition tables. Service role, called from HQ pages and routes
// that have already passed requireHqCapability or hqApiGate.
//
// PLANE BOUNDARY. This file reads ONLY definition tables (asmt_instrument*, asmt_response_scale*, asmt_rule_template*,
// asmt_layout_template*, asmt_progression_rule_set and _version, asmt_group, asmt_section, asmt_item, asmt_item_field,
// asmt_mapping, asmt_version_layout, asmt_version_tag), the two trails (asmt_definition_event, asmt_review_decision),
// registries, profiles for names and hq_* for capabilities. NEVER asmt_instance, asmt_response, asmt_evidence,
// asmt_comment, asmt_outcome, asmt_respondent_grant, asmt_instance_layout or asmt_progression_decision. Every table
// name below is a literal so the plane boundary scan can resolve it.
import type { createAdminClient } from "@/lib/supabase/server";
import type { ResponseScale } from "../core";
import { assembleDefinition, scaleFromRows } from "./assemble";
import {
  VERSION_TABLE, type DefinitionEventRow, type DefinitionKind, type InstrumentRow, type InstrumentVersionRow, type LibraryRow,
  type LifecycleState, type LoadedInstrumentVersion, type ProgressionVersionView, type ReviewDecisionRow, type ScaleVersionView,
  type TemplateVersionView, type TimelineEntry,
} from "./types";

type Admin = ReturnType<typeof createAdminClient>;

const LIFE = "id, version_no, state, content_hash, authored_by, edited_by, last_edited_by, submitted_by, submitted_at, published_by, published_at, retired_by, retired_at, duplicated_from_version_id, created_at";
const INSTRUMENT_VERSION_COLS = `${LIFE}, instrument_id, title, summary, purpose_code, method_codes, requires_domain_review, risk, scoring, scoring_hash, scoring_template_version_id, scoring_tests, default_layout_version_id, assess_capability, assign_capability, respondent_roles, delivery_modes, evidence_policy, effective_from, review_due`;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ---- library -----------------------------------------------------------------------------------------------------

export async function listLibrary(admin: Admin): Promise<LibraryRow[]> {
  const [{ data: ins }, { data: fam }, { data: vers }] = await Promise.all([
    admin.from("asmt_instrument").select("id, code, name, kind, family_code, created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("asmt_instrument_family").select("code, label"),
    admin.from("asmt_instrument_version").select("id, instrument_id, version_no, state, created_at, submitted_at, published_at, retired_at").limit(10000),
  ]);
  const famLabel = new Map(((fam ?? []) as any[]).map((f) => [f.code, f.label]));
  const byInstrument = new Map<string, any[]>();
  for (const v of (vers ?? []) as any[]) byInstrument.set(v.instrument_id, [...(byInstrument.get(v.instrument_id) ?? []), v]);
  return ((ins ?? []) as any[]).map((i) => {
    const vs = (byInstrument.get(i.id) ?? []).sort((a, b) => b.version_no - a.version_no);
    const latest = vs[0] ?? null;
    const published = vs.find((v) => v.state === "published") ?? null;
    const times = [i.created_at, ...vs.flatMap((v) => [v.created_at, v.submitted_at, v.published_at, v.retired_at])].filter(Boolean) as string[];
    return {
      id: i.id, code: i.code, name: i.name, kind: i.kind, family_code: i.family_code, family_label: i.family_code ? famLabel.get(i.family_code) ?? null : null,
      latest_version_id: latest?.id ?? null, latest_version_no: latest?.version_no ?? null, latest_state: (latest?.state ?? null) as LifecycleState | null,
      published_version_no: published?.version_no ?? null, versions: vs.length, updated_at: times.sort().slice(-1)[0],
    };
  });
}

export interface Registries {
  families: { code: string; label: string }[];
  purposes: { code: string; label: string; publishable: boolean }[];
  methods: { code: string; label: string }[];
  mappingKinds: { code: string; label: string }[];
}

export async function loadRegistries(admin: Admin): Promise<Registries> {
  const [f, p, m, k] = await Promise.all([
    admin.from("asmt_instrument_family").select("code, label, is_active, position").order("position").order("code"),
    admin.from("asmt_purpose").select("code, label, publishable").order("code"),
    admin.from("asmt_method").select("code, label").order("label"),
    admin.from("asmt_mapping_kind").select("code, label").order("code"),
  ]);
  return {
    families: ((f.data ?? []) as any[]).filter((x) => x.is_active !== false).map((x) => ({ code: x.code, label: x.label })),
    purposes: ((p.data ?? []) as any[]).map((x) => ({ code: x.code, label: x.label, publishable: Boolean(x.publishable) })),
    methods: ((m.data ?? []) as any[]).map((x) => ({ code: x.code, label: x.label })),
    mappingKinds: ((k.data ?? []) as any[]).map((x) => ({ code: x.code, label: x.label })),
  };
}

// ---- people, approvals ---------------------------------------------------------------------------------------------

export async function nameMap(admin: Admin, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  if (!u.length) return {};
  const { data } = await admin.from("profiles").select("id, full_name").in("id", u);
  return Object.fromEntries(((data ?? []) as any[]).map((p) => [p.id, p.full_name ?? "Unnamed person"]));
}

export async function requiredApprovals(admin: Admin): Promise<{ standard: number; high: number }> {
  const [s, h] = await Promise.all([admin.rpc("hq_sod_required_approvals", { p_risk: "standard" }), admin.rpc("hq_sod_required_approvals", { p_risk: "high" })]);
  return { standard: Number(s.data ?? 1) || 1, high: Number(h.data ?? 1) || 1 };
}

export async function involvedPeople(admin: Admin, kind: DefinitionKind, versionId: string): Promise<string[]> {
  const { data } = await admin.rpc("asmt_version_people", { p_table: VERSION_TABLE[kind], p_id: versionId });
  return Array.isArray(data) ? (data as string[]) : [];
}

// ---- scales ------------------------------------------------------------------------------------------------------

/** Frozen scales by scale version id, with state and label, for the versions an editor refers to. */
export async function loadScalesById(admin: Admin, ids: string[]): Promise<Map<string, ResponseScale & { state: LifecycleState; name: string; versionNo: number }>> {
  const out = new Map<string, ResponseScale & { state: LifecycleState; name: string; versionNo: number }>();
  const u = [...new Set(ids)];
  if (!u.length) return out;
  const [{ data: vs }, { data: lv }, { data: st }] = await Promise.all([
    admin.from("asmt_response_scale_version").select("id, scale_id, version_no, state, scale_kind").in("id", u),
    admin.from("asmt_response_scale_level").select("version_id, code, label, description, ordinal, numeric_value, satisfactory, colour_token, source_level_id").in("version_id", u),
    admin.from("asmt_response_scale_state").select("version_id, state, label").in("version_id", u),
  ]);
  const { data: defs } = await admin.from("asmt_response_scale").select("id, code, name").in("id", ((vs ?? []) as any[]).map((v) => v.scale_id));
  const defOf = new Map(((defs ?? []) as any[]).map((d) => [d.id, d]));
  for (const v of (vs ?? []) as any[]) {
    const d: any = defOf.get(v.scale_id);
    const scale = scaleFromRows(v.id, { code: d?.code, scale_kind: v.scale_kind }, ((lv ?? []) as any[]).filter((l) => l.version_id === v.id), ((st ?? []) as any[]).filter((s) => s.version_id === v.id));
    out.set(v.id, { ...scale, state: v.state, name: d?.name ?? d?.code ?? "Scale", versionNo: v.version_no });
  }
  return out;
}

export interface ScaleChoice { versionId: string; label: string; scale: ResponseScale; state: LifecycleState }

/** Rating scale versions an item can use: every published one, plus any version already in use on the current draft. */
export async function listScaleChoices(admin: Admin, alsoIds: string[] = []): Promise<ScaleChoice[]> {
  const { data: pub } = await admin.from("asmt_response_scale_version").select("id").eq("state", "published").eq("scale_kind", "rating");
  const ids = [...new Set([...((pub ?? []) as any[]).map((p) => p.id as string), ...alsoIds])];
  const m = await loadScalesById(admin, ids);
  return [...m.entries()].filter(([, s]) => s.scale_kind === "rating").map(([id, s]) => ({
    versionId: id, label: `${s.name} (v${s.versionNo}${s.state === "published" ? "" : `, ${s.state.replace("_", " ")}`})`, scale: { code: s.code, version_id: s.version_id, scale_kind: s.scale_kind, levels: s.levels, states: s.states }, state: s.state,
  })).sort((a, b) => a.label.localeCompare(b.label));
}

// ---- an instrument and one of its versions -------------------------------------------------------------------------

export async function loadInstrument(admin: Admin, instrumentId: string): Promise<{ instrument: InstrumentRow; versions: InstrumentVersionRow[]; familyLabel: string | null } | null> {
  const { data: ins } = await admin.from("asmt_instrument").select("id, code, name, kind, family_code, description, created_by, created_at").eq("id", instrumentId).maybeSingle();
  if (!ins) return null;
  const { data: vers } = await admin.from("asmt_instrument_version").select(INSTRUMENT_VERSION_COLS).eq("instrument_id", instrumentId).order("version_no", { ascending: false });
  const fam = ins.family_code ? (await admin.from("asmt_instrument_family").select("label").eq("code", ins.family_code).maybeSingle()).data : null;
  return { instrument: ins as InstrumentRow, versions: (vers ?? []) as InstrumentVersionRow[], familyLabel: fam?.label ?? null };
}

export async function loadInstrumentVersion(admin: Admin, versionId: string): Promise<LoadedInstrumentVersion | null> {
  const { data: v } = await admin.from("asmt_instrument_version").select(INSTRUMENT_VERSION_COLS).eq("id", versionId).maybeSingle();
  if (!v) return null;
  const { data: ins } = await admin.from("asmt_instrument").select("id, code, name, kind, family_code, description, created_by, created_at").eq("id", v.instrument_id).maybeSingle();
  if (!ins) return null;
  const [g, s, i, f, m, l, t] = await Promise.all([
    admin.from("asmt_group").select("code, label, weight, position, source_ref").eq("version_id", versionId),
    admin.from("asmt_section").select("id, stable_key, parent_section_id, title, guidance, weight, position").eq("version_id", versionId),
    admin.from("asmt_item").select("id, section_id, stable_key, code, prompt, guidance, expected_performance, response_type, scale_version_id, config, group_code, method_codes, method_rule, mandatory, critical, critical_requirements, evidence_requirement, weight, references_text, position").eq("version_id", versionId).limit(5000),
    admin.from("asmt_item_field").select("item_id, field_key, label, response_type, scale_version_id, config, required, position").eq("version_id", versionId).limit(10000),
    admin.from("asmt_mapping").select("item_id, section_id, kind, ref_id, ref_code, ref_version, ref_hash, ref_snapshot, relation").eq("version_id", versionId).limit(10000),
    admin.from("asmt_version_layout").select("layout_version_id").eq("version_id", versionId),
    admin.from("asmt_version_tag").select("term_id").eq("version_id", versionId),
  ]);
  const scaleIds = [...new Set([...((i.data ?? []) as any[]).map((x) => x.scale_version_id), ...((f.data ?? []) as any[]).map((x) => x.scale_version_id)].filter(Boolean) as string[])];
  const scales = await loadScalesById(admin, scaleIds);
  const { content, def } = assembleDefinition({
    instrumentCode: ins.code, versionNo: v.version_no, versionId, purposeCode: v.purpose_code, methodCodes: v.method_codes ?? [],
    groups: g.data ?? [], sections: s.data ?? [], items: i.data ?? [], fields: f.data ?? [], mappings: m.data ?? [],
    scales: new Map([...scales.entries()].map(([id, sc]) => [id, { code: sc.code, version_id: sc.version_id, scale_kind: sc.scale_kind, levels: sc.levels, states: sc.states }])),
  });
  return {
    instrument: ins as InstrumentRow, version: v as InstrumentVersionRow, content, def,
    allowedLayoutIds: ((l.data ?? []) as any[]).map((x) => x.layout_version_id), tagTermIds: ((t.data ?? []) as any[]).map((x) => x.term_id),
  };
}

// ---- templates and scales (definitions with versions) ----------------------------------------------------------------

async function shapeTemplates(admin: Admin, defs: any[], versions: any[]): Promise<TemplateVersionView[]> {
  void admin;
  const defOf = new Map(defs.map((d) => [d.id, d]));
  return versions.map((v) => {
    const d: any = defOf.get(v.template_id);
    return { ...v, definition_id: v.template_id, code: d?.code ?? "", name: d?.name ?? "" } as TemplateVersionView;
  });
}

export async function listRuleTemplates(admin: Admin, states?: LifecycleState[]): Promise<TemplateVersionView[]> {
  let q = admin.from("asmt_rule_template_version").select(`${LIFE}, template_id, description, rules, tests`).order("created_at", { ascending: false }).limit(1000);
  if (states) q = q.in("state", states);
  const { data: vs } = await q;
  const { data: ds } = await admin.from("asmt_rule_template").select("id, code, name");
  return shapeTemplates(admin, (ds ?? []) as any[], (vs ?? []) as any[]);
}

export async function listLayoutTemplates(admin: Admin, states?: LifecycleState[]): Promise<TemplateVersionView[]> {
  let q = admin.from("asmt_layout_template_version").select(`${LIFE}, template_id, description, presentation, layout`).order("created_at", { ascending: false }).limit(1000);
  if (states) q = q.in("state", states);
  const { data: vs } = await q;
  const { data: ds } = await admin.from("asmt_layout_template").select("id, code, name");
  return shapeTemplates(admin, (ds ?? []) as any[], (vs ?? []) as any[]);
}

export async function loadRuleTemplateVersion(admin: Admin, id: string): Promise<TemplateVersionView | null> {
  const { data: v } = await admin.from("asmt_rule_template_version").select(`${LIFE}, template_id, description, rules, tests`).eq("id", id).maybeSingle();
  if (!v) return null;
  const { data: d } = await admin.from("asmt_rule_template").select("id, code, name").eq("id", v.template_id).maybeSingle();
  return { ...(v as any), definition_id: v.template_id, code: d?.code ?? "", name: d?.name ?? "" };
}

export async function loadLayoutTemplateVersion(admin: Admin, id: string): Promise<TemplateVersionView | null> {
  const { data: v } = await admin.from("asmt_layout_template_version").select(`${LIFE}, template_id, description, presentation, layout`).eq("id", id).maybeSingle();
  if (!v) return null;
  const { data: d } = await admin.from("asmt_layout_template").select("id, code, name").eq("id", v.template_id).maybeSingle();
  return { ...(v as any), definition_id: v.template_id, code: d?.code ?? "", name: d?.name ?? "" };
}

export async function listScaleVersions(admin: Admin): Promise<ScaleVersionView[]> {
  const { data: vs } = await admin.from("asmt_response_scale_version").select(`${LIFE}, scale_id, scale_kind, source_kind, source_ref, description`).order("created_at", { ascending: false }).limit(1000);
  const { data: ds } = await admin.from("asmt_response_scale").select("id, code, name");
  const defOf = new Map(((ds ?? []) as any[]).map((d) => [d.id, d]));
  return ((vs ?? []) as any[]).map((v) => ({ ...v, scale_code: defOf.get(v.scale_id)?.code ?? "", scale_name: defOf.get(v.scale_id)?.name ?? "", levels: [], states: [] }));
}

export async function loadScaleVersion(admin: Admin, id: string): Promise<ScaleVersionView | null> {
  const { data: v } = await admin.from("asmt_response_scale_version").select(`${LIFE}, scale_id, scale_kind, source_kind, source_ref, description`).eq("id", id).maybeSingle();
  if (!v) return null;
  const [{ data: d }, { data: lv }, { data: st }] = await Promise.all([
    admin.from("asmt_response_scale").select("id, code, name").eq("id", v.scale_id).maybeSingle(),
    admin.from("asmt_response_scale_level").select("id, code, label, description, ordinal, numeric_value, satisfactory, colour_token, source_level_id").eq("version_id", id).order("ordinal"),
    admin.from("asmt_response_scale_state").select("state, label").eq("version_id", id),
  ]);
  return {
    ...(v as any), scale_code: d?.code ?? "", scale_name: d?.name ?? "",
    levels: ((lv ?? []) as any[]).map((l) => ({ ...l, ordinal: Number(l.ordinal), numeric_value: num(l.numeric_value) })), states: (st ?? []) as any[],
  };
}

export async function listProgressionVersions(admin: Admin): Promise<ProgressionVersionView[]> {
  const { data: vs } = await admin.from("asmt_progression_rule_version").select(`${LIFE}, rule_set_id, stage_scale_version_id, description, rules, tests`).order("created_at", { ascending: false }).limit(1000);
  const { data: ds } = await admin.from("asmt_progression_rule_set").select("id, code, name, target_kind, target_ref");
  const defOf = new Map(((ds ?? []) as any[]).map((d) => [d.id, d]));
  return ((vs ?? []) as any[]).map((v) => ({ ...v, code: defOf.get(v.rule_set_id)?.code ?? "", name: defOf.get(v.rule_set_id)?.name ?? "", target_kind: defOf.get(v.rule_set_id)?.target_kind ?? "", target_ref: defOf.get(v.rule_set_id)?.target_ref ?? null }));
}

export async function loadProgressionVersion(admin: Admin, id: string): Promise<ProgressionVersionView | null> {
  const all = await listProgressionVersions(admin);
  return all.find((v) => v.id === id) ?? null;
}

// ---- history -------------------------------------------------------------------------------------------------------

export async function loadTrail(admin: Admin, kind: DefinitionKind, versionIds: string[]): Promise<{ events: DefinitionEventRow[]; decisions: ReviewDecisionRow[] }> {
  if (!versionIds.length) return { events: [], decisions: [] };
  const table = VERSION_TABLE[kind];
  const [e, d] = await Promise.all([
    admin.from("asmt_definition_event").select("id, subject_table, subject_id, event, actor_id, reason, content_hash, detail, created_at").eq("subject_table", table).in("subject_id", versionIds).order("created_at", { ascending: true }),
    admin.from("asmt_review_decision").select("id, version_table, version_id, review_kind, reviewer_id, decision, content_hash, rationale, created_at").eq("version_table", table).in("version_id", versionIds).order("created_at", { ascending: true }),
  ]);
  return { events: (e.data ?? []) as DefinitionEventRow[], decisions: (d.data ?? []) as ReviewDecisionRow[] };
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created", duplicated: "Duplicated into a new draft", submitted: "Put forward for review", returned: "Returned to draft", approved: "Approved",
  published: "Published", retired: "Retired", validated: "Validation recorded", catalogue_registered: "Registered in the catalogue", scoring_proposed: "Scoring proposed from the source workbook",
};
const DECISION_LABEL: Record<string, string> = { approved: "approved", rejected: "rejected", changes_requested: "asked for changes" };

/** Events and decisions as one timeline, oldest first. Pure. */
export function buildTimeline(events: DefinitionEventRow[], decisions: ReviewDecisionRow[], versionNoById: Record<string, number>): TimelineEntry[] {
  const e: TimelineEntry[] = events.map((x) => ({
    at: x.created_at, kind: "event", label: EVENT_LABEL[x.event] ?? x.event.replace(/_/g, " "), actorId: x.actor_id, versionId: x.subject_id, versionNo: versionNoById[x.subject_id] ?? null,
    detail: x.event === "validated" ? `${(x.detail as any)?.errors ?? 0} problem(s), ${(x.detail as any)?.warnings ?? 0} warning(s)` : x.reason ?? null,
  }));
  const d: TimelineEntry[] = decisions.map((x) => ({
    at: x.created_at, kind: "decision", label: `${x.review_kind === "domain" ? "Domain" : "Governance"} review ${DECISION_LABEL[x.decision] ?? x.decision}`, actorId: x.reviewer_id,
    versionId: x.version_id, versionNo: versionNoById[x.version_id] ?? null, detail: x.rationale,
  }));
  return [...e, ...d].sort((a, b) => a.at.localeCompare(b.at));
}

// ---- review queue -------------------------------------------------------------------------------------------------

export interface QueueItem {
  kind: DefinitionKind; versionId: string; versionNo: number; definitionName: string; code: string;
  submittedBy: string | null; submittedAt: string | null; risk: string | null; requiresDomainReview: boolean; contentHash: string | null;
  governance: number; domain: number; href: string;
  /** ASMT-PATHWAY-01: the approvals this version needs (by its risk), and everyone involved in it (asmt_version_people). */
  need: number; involved: string[];
  /** THIS person's standing on the item: independent of its content, and what they have already decided on this exact content. */
  viewer: { independent: boolean; decidedGovernance: boolean; decidedDomain: boolean; canGovern: boolean; canDomain: boolean };
}

/** The versions in review that THIS person may still decide: never one they authored, edited or submitted, nor one they already decided. */
export async function reviewQueue(admin: Admin, actorId: string, caps: string[]): Promise<QueueItem[]> {
  return (await reviewOverview(admin, actorId, caps)).filter((q) => q.viewer.independent && ((q.viewer.canGovern && !q.viewer.decidedGovernance) || (q.viewer.canDomain && q.requiresDomainReview && !q.viewer.decidedDomain)));
}

/** EVERY version in review, with who submitted it, what it still needs and this person's standing on it (ASMT-PATHWAY-01). */
export async function reviewOverview(admin: Admin, actorId: string, caps: string[]): Promise<QueueItem[]> {
  const out: QueueItem[] = [];
  const need = await requiredApprovals(admin);
  const [ins, sc, rt, lt, pr] = await Promise.all([
    admin.from("asmt_instrument_version").select("id, version_no, instrument_id, submitted_by, submitted_at, risk, requires_domain_review, content_hash").eq("state", "in_review"),
    admin.from("asmt_response_scale_version").select("id, version_no, scale_id, submitted_by, submitted_at, content_hash").eq("state", "in_review"),
    admin.from("asmt_rule_template_version").select("id, version_no, template_id, submitted_by, submitted_at, content_hash").eq("state", "in_review"),
    admin.from("asmt_layout_template_version").select("id, version_no, template_id, submitted_by, submitted_at, content_hash").eq("state", "in_review"),
    admin.from("asmt_progression_rule_version").select("id, version_no, rule_set_id, submitted_by, submitted_at, content_hash").eq("state", "in_review"),
  ]);
  const names = async (table: "asmt_instrument" | "asmt_response_scale" | "asmt_rule_template" | "asmt_layout_template" | "asmt_progression_rule_set", ids: string[]) => {
    if (!ids.length) return new Map<string, any>();
    const { data } = await admin.from(table).select("id, code, name").in("id", ids);
    return new Map(((data ?? []) as any[]).map((d) => [d.id, d]));
  };
  const [nIns, nSc, nRt, nLt, nPr] = await Promise.all([
    names("asmt_instrument", ((ins.data ?? []) as any[]).map((v) => v.instrument_id)), names("asmt_response_scale", ((sc.data ?? []) as any[]).map((v) => v.scale_id)),
    names("asmt_rule_template", ((rt.data ?? []) as any[]).map((v) => v.template_id)), names("asmt_layout_template", ((lt.data ?? []) as any[]).map((v) => v.template_id)),
    names("asmt_progression_rule_set", ((pr.data ?? []) as any[]).map((v) => v.rule_set_id)),
  ]);
  const push = (kind: DefinitionKind, rows: any[], parentKey: string, nm: Map<string, any>, href: (v: any) => string) => {
    for (const v of rows) out.push({
      kind, versionId: v.id, versionNo: v.version_no, definitionName: nm.get(v[parentKey])?.name ?? "", code: nm.get(v[parentKey])?.code ?? "", submittedBy: v.submitted_by, submittedAt: v.submitted_at,
      risk: v.risk ?? null, requiresDomainReview: Boolean(v.requires_domain_review), contentHash: v.content_hash, governance: 0, domain: 0, href: href(v),
      need: v.risk === "high" ? need.high : need.standard, involved: [], viewer: { independent: true, decidedGovernance: false, decidedDomain: false, canGovern: false, canDomain: false },
    });
  };
  push("instrument", (ins.data ?? []) as any[], "instrument_id", nIns, (v) => `/super-admin/checklist-studio/${v.instrument_id}/v/${v.id}`);
  push("scale", (sc.data ?? []) as any[], "scale_id", nSc, (v) => `/super-admin/checklist-studio/scales/v/${v.id}`);
  push("rule_template", (rt.data ?? []) as any[], "template_id", nRt, (v) => `/super-admin/checklist-studio/scoring-templates/v/${v.id}`);
  push("layout_template", (lt.data ?? []) as any[], "template_id", nLt, (v) => `/super-admin/checklist-studio/layout-templates/v/${v.id}`);
  push("progression", (pr.data ?? []) as any[], "rule_set_id", nPr, (v) => `/super-admin/checklist-studio/progression/v/${v.id}`);

  const canGovern = caps.includes("hq.assessment.instrument.review");
  const canDomain = caps.includes("hq.quality.clinical.approve");
  const result: QueueItem[] = [];
  for (const q of out) {
    const [people, trail] = await Promise.all([involvedPeople(admin, q.kind, q.versionId), loadTrail(admin, q.kind, [q.versionId])]);
    const mine = trail.decisions.filter((d) => d.reviewer_id === actorId && d.content_hash === q.contentHash);
    const forHash = trail.decisions.filter((d) => d.content_hash === q.contentHash && d.decision === "approved");
    q.governance = new Set(forHash.filter((d) => d.review_kind === "governance").map((d) => d.reviewer_id)).size;
    q.domain = new Set(forHash.filter((d) => d.review_kind === "domain").map((d) => d.reviewer_id)).size;
    q.involved = people;
    q.viewer = { independent: !people.includes(actorId), decidedGovernance: mine.some((d) => d.review_kind === "governance"), decidedDomain: mine.some((d) => d.review_kind === "domain"), canGovern, canDomain };
    result.push(q);
  }
  return result.sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
}

// ---- governed content index and history (UNIFIED-GOVERNANCE-V1 sections 5 and 7) -----------------------------------

export interface GovernedVersionRow {
  kind: DefinitionKind; versionId: string; /** Same as versionId (alias used by the governance inbox). */ id: string; versionNo: number; definitionId: string; code: string; name: string; state: LifecycleState;
  authoredBy: string[]; submittedBy: string | null; submittedAt: string | null; publishedBy: string | null; publishedAt: string | null; createdAt: string; href: string;
}

/** Every version of every definition kind, newest first, with its definition's code and name and the link to its Studio page. */
export async function listGovernedVersions(admin: Admin, o: { states?: LifecycleState[]; limit?: number } = {}): Promise<GovernedVersionRow[]> {
  const limit = o.limit ?? 2000;
  const cols = "id, version_no, state, authored_by, submitted_by, submitted_at, published_by, published_at, created_at";
  const pull = (table: "asmt_instrument_version" | "asmt_response_scale_version" | "asmt_rule_template_version" | "asmt_layout_template_version" | "asmt_progression_rule_version", parent: string) => {
    let q = admin.from(table).select(`${cols}, ${parent}`).order("created_at", { ascending: false }).limit(limit);
    if (o.states?.length) q = q.in("state", o.states);
    return q;
  };
  const [ins, sc, rt, lt, pr] = await Promise.all([
    pull("asmt_instrument_version", "instrument_id"), pull("asmt_response_scale_version", "scale_id"), pull("asmt_rule_template_version", "template_id"),
    pull("asmt_layout_template_version", "template_id"), pull("asmt_progression_rule_version", "rule_set_id"),
  ]);
  const defs = async (table: "asmt_instrument" | "asmt_response_scale" | "asmt_rule_template" | "asmt_layout_template" | "asmt_progression_rule_set", ids: string[]) => {
    const u = [...new Set(ids)];
    if (!u.length) return new Map<string, any>();
    const { data } = await admin.from(table).select("id, code, name").in("id", u);
    return new Map(((data ?? []) as any[]).map((d) => [d.id, d]));
  };
  const ids = (r: { data: unknown }, key: string) => ((r.data ?? []) as any[]).map((v) => v[key] as string);
  const [dIns, dSc, dRt, dLt, dPr] = await Promise.all([
    defs("asmt_instrument", ids(ins, "instrument_id")), defs("asmt_response_scale", ids(sc, "scale_id")), defs("asmt_rule_template", ids(rt, "template_id")),
    defs("asmt_layout_template", ids(lt, "template_id")), defs("asmt_progression_rule_set", ids(pr, "rule_set_id")),
  ]);
  const out: GovernedVersionRow[] = [];
  const push = (kind: DefinitionKind, res: { data: unknown }, parentKey: string, nm: Map<string, any>, href: (v: any) => string) => {
    for (const v of (res.data ?? []) as any[]) out.push({
      kind, versionId: v.id, id: v.id, versionNo: v.version_no, definitionId: v[parentKey], code: nm.get(v[parentKey])?.code ?? "", name: nm.get(v[parentKey])?.name ?? "", state: v.state,
      authoredBy: Array.isArray(v.authored_by) ? v.authored_by : [], submittedBy: v.submitted_by ?? null, submittedAt: v.submitted_at ?? null,
      publishedBy: v.published_by ?? null, publishedAt: v.published_at ?? null, createdAt: v.created_at, href: href(v),
    });
  };
  push("instrument", ins, "instrument_id", dIns, (v) => `/super-admin/checklist-studio/${v.instrument_id}/v/${v.id}`);
  push("scale", sc, "scale_id", dSc, (v) => `/super-admin/checklist-studio/scales/v/${v.id}`);
  push("rule_template", rt, "template_id", dRt, (v) => `/super-admin/checklist-studio/scoring-templates/v/${v.id}`);
  push("layout_template", lt, "template_id", dLt, (v) => `/super-admin/checklist-studio/layout-templates/v/${v.id}`);
  push("progression", pr, "rule_set_id", dPr, (v) => `/super-admin/checklist-studio/progression/v/${v.id}`);
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface DefinitionTrailRow {
  at: string; kind: "event" | "decision"; label: string; actorId: string | null; versionTable: string; versionId: string; detail: string | null;
}

/** The newest definition events and review decisions across every kind, newest first. */
export async function recentDefinitionTrail(admin: Admin, limit = 100): Promise<DefinitionTrailRow[]> {
  const [e, d] = await Promise.all([
    admin.from("asmt_definition_event").select("subject_table, subject_id, event, actor_id, reason, detail, created_at").order("created_at", { ascending: false }).limit(limit),
    admin.from("asmt_review_decision").select("version_table, version_id, review_kind, reviewer_id, decision, rationale, created_at").order("created_at", { ascending: false }).limit(limit),
  ]);
  if (e.error || d.error) throw new Error("The definition trail could not be read.");
  const ev: DefinitionTrailRow[] = ((e.data ?? []) as any[]).map((x) => ({
    at: x.created_at, kind: "event", label: EVENT_LABEL[x.event] ?? String(x.event).replace(/_/g, " "), actorId: x.actor_id ?? null, versionTable: x.subject_table, versionId: x.subject_id,
    detail: x.event === "validated" ? `${x.detail?.errors ?? 0} problem(s), ${x.detail?.warnings ?? 0} warning(s)` : x.reason ?? null,
  }));
  const dc: DefinitionTrailRow[] = ((d.data ?? []) as any[]).map((x) => ({
    at: x.created_at, kind: "decision", label: `${x.review_kind === "domain" ? "Domain" : "Governance"} review ${DECISION_LABEL[x.decision] ?? x.decision}`, actorId: x.reviewer_id ?? null,
    versionTable: x.version_table, versionId: x.version_id, detail: x.rationale ?? null,
  }));
  return [...ev, ...dc].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
