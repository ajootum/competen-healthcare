// Acuity & Workload assessment engine (migrations 153 + 157) — the
// reassessment spine, now instrument-aware (v2 specs):
//   Acuity: PEWS (ward, recorded total 0-15 + category-3 trigger -> colour
//     band), CIAF (ICU composite /100 -> A1-A5), plus the legacy 6-domain
//     ward/icu instruments kept readable for historical rows.
//   Workload: NAS (Miranda activities, now banded I1-I5 with ratios) and the
//     12-domain Ward Workload (0-3 each + modifiers -> W1-W5 with ratios);
//     legacy checkbox 'ward' rows stay readable.
// UNIT-ASM-001: the tool is RESOLVED from the patient's care location — new
// submissions with any other tool are rejected (409) by validateToolForPatient.
// Scores are computed HERE, server-side — the client's preview is cosmetic.
// Recording syncs op_patients.acuity_level (via each instrument's spine
// mapping) and flags significant changes for assignment review. Professional
// overrides require a reason and are stored alongside the computed level.
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  computePews, computeCiaf, computeWard12, levelFromBands, validateOverride,
  resolveUnitType, TOOLSET, I_LEVELS, W_LEVELS,
} from "@/lib/hww/instruments";

// ── Acuity instruments ───────────────────────────────────────────────────────

export type AcuityDomain = { key: string; label: string; hint: string };

export const WARD_ACUITY_DOMAINS: AcuityDomain[] = [
  { key: "airway_breathing", label: "Airway & breathing", hint: "0 self-ventilating · 3 unstable airway / high O₂ need" },
  { key: "circulation", label: "Circulation & vital signs", hint: "0 stable obs · 3 haemodynamically unstable" },
  { key: "neuro", label: "Consciousness & neurology", hint: "0 alert · 3 unresponsive / acute deterioration" },
  { key: "mobility", label: "Mobility & falls risk", hint: "0 independent · 3 full assistance / high falls risk" },
  { key: "nutrition_elimination", label: "Nutrition & elimination", hint: "0 independent · 3 full support (NG/catheter/stoma care)" },
  { key: "psychosocial", label: "Psychosocial & isolation", hint: "0 settled · 3 1:1 supervision / strict isolation" },
];

export const ICU_ACUITY_DOMAINS: AcuityDomain[] = [
  { key: "respiratory", label: "Respiratory / ventilation", hint: "0 self-ventilating · 3 invasive ventilation, unstable" },
  { key: "cardiovascular", label: "Cardiovascular / vasoactive", hint: "0 no support · 3 multiple vasoactive agents" },
  { key: "neuro", label: "Neurological", hint: "0 alert · 3 deep sedation / ICP management" },
  { key: "renal", label: "Renal / fluids / RRT", hint: "0 normal · 3 continuous renal replacement" },
  { key: "infection", label: "Sepsis / infection", hint: "0 none · 3 septic shock / resistant organism" },
  { key: "devices", label: "Lines, drains & devices", hint: "0 peripheral only · 3 multiple invasive devices" },
];

export const ACUITY_FRAMEWORKS: Record<string, { label: string; domains: AcuityDomain[] }> = {
  ward: { label: "Competen Ward Acuity", domains: WARD_ACUITY_DOMAINS },
  icu: { label: "Competen ICU Acuity Assessment", domains: ICU_ACUITY_DOMAINS },
};

// Score bands → the op_patients.acuity_level vocabulary (max 18).
export function acuityLevelFor(score: number): "stable" | "moderate" | "high" | "critical" {
  return score <= 4 ? "stable" : score <= 9 ? "moderate" : score <= 13 ? "high" : "critical";
}

// A reassessment is SIGNIFICANT when it jumps ≥4 points or changes level
// ("acuity changes trigger assignment review", HWW-WARD-001 §10).
export const SIGNIFICANT_DELTA = 4;
export function isSignificantChange(score: number, level: string, prevScore: number | null, prevLevel: string | null): boolean {
  if (prevScore == null) return false;
  return Math.abs(score - prevScore) >= SIGNIFICANT_DELTA || (prevLevel != null && prevLevel !== level);
}

export function computeAcuity(framework: string, domains: any): { score: number; level: string; errors: string[] } {
  const fw = ACUITY_FRAMEWORKS[framework];
  const errors: string[] = [];
  if (!fw) return { score: 0, level: "stable", errors: [`framework must be one of: ${Object.keys(ACUITY_FRAMEWORKS).join(", ")}`] };
  const d = domains && typeof domains === "object" && !Array.isArray(domains) ? domains : {};
  let score = 0;
  for (const dom of fw.domains) {
    const v = Number(d[dom.key]);
    if (!Number.isInteger(v) || v < 0 || v > 3) { errors.push(`${dom.key} must be an integer 0-3`); continue; }
    score += v;
  }
  const extras = Object.keys(d).filter(k => !fw.domains.some(x => x.key === k));
  if (extras.length) errors.push(`unknown domains: ${extras.join(", ")}`);
  return { score, level: acuityLevelFor(score), errors };
}

// ── Workload instruments ─────────────────────────────────────────────────────

export type WorkloadItem = { key: string; label: string; weight: number; group?: string };

// Nursing Activities Score — Miranda et al. 2003 published weightings.
// Groups 1/4/6/7/8 are mutually exclusive (pick at most one per group).
export const NAS_ITEMS: WorkloadItem[] = [
  { key: "1a", label: "Hourly vital signs, regular monitoring & titration", weight: 4.5, group: "1" },
  { key: "1b", label: "Present at bedside ≥ 2h (any shift)", weight: 12.1, group: "1" },
  { key: "1c", label: "Present at bedside ≥ 4h (any shift)", weight: 19.6, group: "1" },
  { key: "2", label: "Laboratory: biochemical & microbiological investigations", weight: 4.3 },
  { key: "3", label: "Medication (excluding vasoactive drugs)", weight: 5.6 },
  { key: "4a", label: "Hygiene procedures: routine", weight: 4.1, group: "4" },
  { key: "4b", label: "Hygiene procedures > 2h (any shift)", weight: 16.5, group: "4" },
  { key: "4c", label: "Hygiene procedures > 4h (any shift)", weight: 20.0, group: "4" },
  { key: "5", label: "Care of drains (except gastric tube)", weight: 1.8 },
  { key: "6a", label: "Mobilisation & positioning up to 3×/24h", weight: 5.5, group: "6" },
  { key: "6b", label: "Mobilisation > 3×/24h, or with 2 nurses", weight: 12.4, group: "6" },
  { key: "6c", label: "Mobilisation with ≥ 3 nurses (any frequency)", weight: 17.0, group: "6" },
  { key: "7a", label: "Support of patient / relatives ~1h", weight: 4.0, group: "7" },
  { key: "7b", label: "Support of patient / relatives ≥ 3h", weight: 32.0, group: "7" },
  { key: "8a", label: "Routine administrative & managerial tasks", weight: 4.2, group: "8" },
  { key: "8b", label: "Administrative / managerial tasks ~2h (any shift)", weight: 23.2, group: "8" },
  { key: "8c", label: "Administrative / managerial tasks ~4h (any shift)", weight: 30.0, group: "8" },
  { key: "9", label: "Respiratory support (any form)", weight: 1.4 },
  { key: "10", label: "Care of artificial airways", weight: 1.8 },
  { key: "11", label: "Treatment for improving lung function", weight: 4.4 },
  { key: "12", label: "Vasoactive medication (any type / dose)", weight: 1.2 },
  { key: "13", label: "IV replacement of large fluid losses", weight: 2.5 },
  { key: "14", label: "Left atrium / pulmonary artery catheter monitoring", weight: 1.7 },
  { key: "15", label: "CPR after arrest (last 24h)", weight: 7.1 },
  { key: "16", label: "Haemofiltration / dialysis", weight: 7.7 },
  { key: "17", label: "Quantitative urine output measurement", weight: 7.0 },
  { key: "18", label: "Intracranial pressure measurement", weight: 1.6 },
  { key: "19", label: "Treatment of metabolic acidosis / alkalosis", weight: 1.3 },
  { key: "20", label: "Intravenous hyperalimentation (TPN)", weight: 2.8 },
  { key: "21", label: "Enteral feeding", weight: 1.3 },
  { key: "22", label: "Specific interventions in the ICU", weight: 2.8 },
  { key: "23", label: "Specific interventions outside the ICU", weight: 1.9 },
];

// Competen Ward Workload — component weights as % of one nurse's shift capacity.
// A Competen-defined operational instrument (not a published scale).
export const WARD_WORKLOAD_ITEMS: WorkloadItem[] = [
  { key: "adl_full", label: "Full assistance with ADLs", weight: 20, group: "adl" },
  { key: "adl_partial", label: "Partial ADL assistance", weight: 10, group: "adl" },
  { key: "obs_2h", label: "Observations 2-hourly or more often", weight: 15, group: "obs" },
  { key: "obs_4h", label: "Observations 4-hourly", weight: 8, group: "obs" },
  { key: "meds_complex", label: "Complex medication regimen (IVs, titration)", weight: 12, group: "meds" },
  { key: "meds_simple", label: "Standard medication rounds", weight: 5, group: "meds" },
  { key: "wound", label: "Wound / dressing care", weight: 8 },
  { key: "mobility_2", label: "Mobilisation requires 2 staff", weight: 12 },
  { key: "isolation", label: "Isolation precautions", weight: 10 },
  { key: "one_to_one", label: "1:1 supervision / behavioural support", weight: 25 },
  { key: "discharge", label: "Discharge planning & education", weight: 6 },
  { key: "family", label: "Family support & communication", weight: 5 },
];

export const WORKLOAD_FRAMEWORKS: Record<string, { label: string; items: WorkloadItem[] }> = {
  nas: { label: "Nursing Activities Score (NAS)", items: NAS_ITEMS },
  ward: { label: "Competen Ward Workload", items: WARD_WORKLOAD_ITEMS },
};

// A nurse's summed latest-per-patient percentage above this is an overload
// (NAS semantics: >100% of one nurse's capacity → reassignment recommended).
export const OVERLOAD_THRESHOLD = 100;

export function computeWorkload(framework: string, selected: any): { score: number; percentage: number; errors: string[] } {
  const fw = WORKLOAD_FRAMEWORKS[framework];
  const errors: string[] = [];
  if (!fw) return { score: 0, percentage: 0, errors: [`framework must be one of: ${Object.keys(WORKLOAD_FRAMEWORKS).join(", ")}`] };
  const sel: string[] = Array.isArray(selected) ? selected.map(String) : [];
  if (!sel.length) errors.push("select at least one item");
  const byKey = new Map(fw.items.map(i => [i.key, i]));
  const seenGroups = new Map<string, string>();
  let score = 0;
  for (const k of sel) {
    const item = byKey.get(k);
    if (!item) { errors.push(`unknown item: ${k}`); continue; }
    if (item.group) {
      const prior = seenGroups.get(item.group);
      if (prior) { errors.push(`items ${prior} and ${k} are mutually exclusive (group ${item.group})`); continue; }
      seenGroups.set(item.group, k);
    }
    score += item.weight;
  }
  score = Math.round(score * 10) / 10;
  return { score, percentage: score, errors };
}

// ── Recording engines (route + harness call the SAME code) ──────────────────

type Ctx = { patientId: string; framework: string; notes?: string | null; shiftId?: string | null; assessedBy?: string | null; assessedByName?: string | null };
type RecordResult =
  | { ok: true; assessment: any; significant?: boolean; aggregate?: number; overloaded?: boolean }
  | { ok: false; status: number; error: string };

async function subjectPatient(admin: any, patientId: string) {
  const { data } = await admin.from("op_patients").select("id, label, hospital_id, department_id, unit_id, acuity_level").eq("id", patientId).maybeSingle();
  return data ?? null;
}

const migrationMissingErr = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

// Significant-change thresholds per instrument (drives assignment review).
const SIG_DELTA: Record<string, number> = { pews: 2, ciaf: 10, ward: 4, icu: 4 };

export async function recordAcuity(admin: any, input: Ctx & { domains?: any; payload?: any }): Promise<RecordResult> {
  const payload = input.payload ?? input.domains ?? {};
  let score: number, level: string, classification: string, category3 = false;
  let components: any = {};
  let reassessMinutes: number | null = null;
  let domains: any = {};

  if (input.framework === "pews") {
    const r = computePews({ total: payload.total, category3: payload.category3 });
    if (r.errors.length) return { ok: false, status: 400, error: r.errors.join("; ") };
    score = r.score; level = r.spineLevel; classification = r.classification;
    category3 = !!payload.category3; reassessMinutes = r.reassessMinutes;
    domains = { total: r.score, category3 };
  } else if (input.framework === "ciaf") {
    const r = computeCiaf(payload);
    if (r.errors.length) return { ok: false, status: 400, error: r.errors.join("; ") };
    score = r.score; level = r.spineLevel; classification = r.level;
    components = r.components;
    domains = { aacn: payload.aacn, rass: payload.rass, cam: payload.cam, organ_supports: payload.organ_supports ?? [], risk_modifiers: payload.risk_modifiers ?? [] };
  } else {
    const r = computeAcuity(input.framework, payload);
    if (r.errors.length) return { ok: false, status: 400, error: r.errors.join("; ") };
    score = r.score; level = r.level; classification = r.level;
    domains = payload;
  }

  const p = await subjectPatient(admin, input.patientId);
  if (!p) return { ok: false, status: 404, error: "Patient not found" };

  const { data: prior } = await admin.from("op_acuity_assessments")
    .select("score, level, classification, framework").eq("patient_id", p.id).order("assessed_at", { ascending: false }).limit(1).maybeSingle();
  // Significant vs a prior reading of the SAME instrument (cross-instrument
  // deltas are not comparable — a unit transfer resets the baseline).
  const comparable = prior && prior.framework === input.framework;
  const significant = comparable
    ? Math.abs(score - prior.score) >= (SIG_DELTA[input.framework] ?? 4) || (prior.classification ?? prior.level) !== classification
    : false;

  const row: any = {
    hospital_id: p.hospital_id, department_id: p.department_id ?? null, unit_id: p.unit_id ?? null,
    patient_id: p.id, shift_id: input.shiftId ?? null,
    framework: input.framework, score, level, domains,
    classification, category3, components,
    previous_score: comparable ? prior.score : null, significant_change: significant,
    assessed_by: input.assessedBy ?? null, assessed_by_name: input.assessedByName ?? null,
    notes: input.notes?.trim() || null,
  };
  if (reassessMinutes != null) row.reassess_by = new Date(Date.now() + reassessMinutes * 60e3).toISOString();

  let { data, error } = await admin.from("op_acuity_assessments").insert(row).select().single();
  if (error && /classification|category3|components|reassess_by|check constraint/i.test(String(error.message))) {
    // Pre-157 fallback: the new columns/constraints are absent — persist the
    // legacy shape (v2 instruments still need 157 for scores above 18).
    if (score > 18) return { ok: false, status: 503, error: "Apply migration 157 to enable the v2 instruments." };
    const legacy = await admin.from("op_acuity_assessments").insert({
      hospital_id: row.hospital_id, department_id: row.department_id, unit_id: row.unit_id,
      patient_id: row.patient_id, shift_id: row.shift_id, framework: input.framework === "pews" ? "ward" : input.framework === "ciaf" ? "icu" : input.framework,
      score, level, domains, previous_score: row.previous_score, significant_change: significant,
      assessed_by: row.assessed_by, assessed_by_name: row.assessed_by_name, notes: row.notes,
    }).select().single();
    data = legacy.data; error = legacy.error;
  }
  if (error) return { ok: false, status: migrationMissingErr(error) ? 503 : 500, error: migrationMissingErr(error) ? "Apply migration 153 to enable assessments." : error.message };

  // Sync the operational spine: every surface reads op_patients.acuity_level.
  await admin.from("op_patients").update({ acuity_level: level }).eq("id", p.id);

  return { ok: true, assessment: data, significant };
}

// UNIT-ASM-001 server-side validation: the tool must be the one RESOLVED from
// the patient's care location. Wrong-tool submissions are 409-rejected with
// the right tool named. Legacy instruments are read-only history.
export async function validateToolForPatient(admin: any, patientId: string, kind: "acuity" | "workload", framework: string): Promise<{ ok: true; unitType: string } | { ok: false; status: number; error: string }> {
  const { data: p } = await admin.from("op_patients").select("id, op_beds!bed_id(bed_type)").eq("id", patientId).maybeSingle();
  if (!p) return { ok: false, status: 404, error: "Patient not found" };
  const unitType = resolveUnitType((p as any).op_beds?.bed_type ?? null);
  const allowed = kind === "acuity" ? TOOLSET[unitType].acuity : TOOLSET[unitType].workload;
  if (framework !== allowed) {
    const label = kind === "acuity" ? TOOLSET[unitType].acuityLabel : TOOLSET[unitType].workloadLabel;
    return { ok: false, status: 409, error: `Tool '${framework}' is not applicable to this patient's care location (${unitType.toUpperCase()}) — use ${label} ('${allowed}').` };
  }
  return { ok: true, unitType };
}

export async function recordWorkload(admin: any, input: Ctx & { items?: any; payload?: any; overrideLevel?: string | null; overrideReason?: string | null }): Promise<RecordResult> {
  let score: number, percentage: number, level: string | null = null, ratio: string | null = null;
  let items: any, modifiers: any = [];

  if (input.framework === "ward12") {
    const r = computeWard12({ domains: input.payload?.domains ?? input.payload, modifiers: input.payload?.modifiers });
    if (r.errors.length) return { ok: false, status: 400, error: r.errors.join("; ") };
    score = r.score;
    // W-scale: percentage expresses the score against the 36-point domain max
    // so cross-patient aggregation (nurse cumulative load) stays meaningful.
    percentage = Math.round((r.score / 36) * 100 * 10) / 10;
    level = r.level; ratio = r.ratio;
    items = input.payload?.domains ?? input.payload; modifiers = input.payload?.modifiers ?? [];
  } else {
    const r = computeWorkload(input.framework, input.payload ?? input.items);
    if (r.errors.length) return { ok: false, status: 400, error: r.errors.join("; ") };
    score = r.score; percentage = r.percentage;
    items = input.payload ?? input.items;
    if (input.framework === "nas") {
      const band = levelFromBands(score, I_LEVELS);
      level = band.level; ratio = band.ratio;
    }
  }

  // Professional-judgement override (mandatory reason; must be a valid level).
  const bands = input.framework === "ward12" ? W_LEVELS : input.framework === "nas" ? I_LEVELS : null;
  if (bands) {
    const oErr = validateOverride(bands, input.overrideLevel, input.overrideReason);
    if (oErr.length) return { ok: false, status: 400, error: oErr.join("; ") };
  }

  const p = await subjectPatient(admin, input.patientId);
  if (!p) return { ok: false, status: 404, error: "Patient not found" };

  const row: any = {
    hospital_id: p.hospital_id, department_id: p.department_id ?? null, unit_id: p.unit_id ?? null,
    patient_id: p.id, shift_id: input.shiftId ?? null,
    framework: input.framework, items, score, percentage,
    level, ratio, modifiers,
    override_level: input.overrideLevel || null,
    override_reason: input.overrideLevel ? String(input.overrideReason ?? "").trim() : null,
    assessed_by: input.assessedBy ?? null, assessed_by_name: input.assessedByName ?? null,
    notes: input.notes?.trim() || null,
  };
  let { data, error } = await admin.from("op_workload_assessments").insert(row).select().single();
  if (error && /level|ratio|modifiers|override|check constraint/i.test(String(error.message))) {
    // Pre-157 fallback: persist the legacy shape (ward12 needs 157's framework value).
    if (input.framework === "ward12") return { ok: false, status: 503, error: "Apply migration 157 to enable the 12-domain ward workload." };
    const legacy = await admin.from("op_workload_assessments").insert({
      hospital_id: row.hospital_id, department_id: row.department_id, unit_id: row.unit_id,
      patient_id: row.patient_id, shift_id: row.shift_id,
      framework: input.framework, items, score, percentage,
      assessed_by: row.assessed_by, assessed_by_name: row.assessed_by_name, notes: row.notes,
    }).select().single();
    data = legacy.data; error = legacy.error;
  }
  if (error) return { ok: false, status: migrationMissingErr(error) ? 503 : 500, error: migrationMissingErr(error) ? "Apply migration 153 to enable assessments." : error.message };

  // The recording nurse's cumulative load = latest percentage per patient she
  // is actively assigned to (HWW-ICU-001 §7 "aggregates nurse workload").
  let aggregate = 0, overloaded = false;
  if (input.assessedBy) {
    const agg = await nurseWorkloadAggregate(admin, input.assessedBy);
    aggregate = agg.total; overloaded = agg.overloaded;
  }
  return { ok: true, assessment: data, aggregate, overloaded };
}

export async function nurseWorkloadAggregate(admin: any, userId: string): Promise<{ total: number; perPatient: { patient_id: string; percentage: number }[]; overloaded: boolean }> {
  const { data: asg } = await admin.from("op_patient_assignments").select("patient_id")
    .eq("staff_id", userId).eq("status", "active").limit(100);
  const ids = ((asg ?? []) as any[]).map(r => r.patient_id).filter(Boolean);
  if (!ids.length) return { total: 0, perPatient: [], overloaded: false };
  const { data: rows } = await admin.from("op_workload_assessments")
    .select("patient_id, percentage, assessed_at").in("patient_id", ids)
    .order("assessed_at", { ascending: false }).limit(400);
  const latest = new Map<string, number>();
  for (const r of (rows ?? []) as any[]) if (!latest.has(r.patient_id)) latest.set(r.patient_id, Number(r.percentage) || 0);
  const perPatient = [...latest.entries()].map(([patient_id, percentage]) => ({ patient_id, percentage }));
  const total = Math.round(perPatient.reduce((a, b) => a + b.percentage, 0) * 10) / 10;
  return { total, perPatient, overloaded: total > OVERLOAD_THRESHOLD };
}

// ── The nurse's assessment lens ──────────────────────────────────────────────

export async function loadMyAssessments(admin: any, userId: string) {
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("assignment_type, op_patients!patient_id(id, label, acuity_level, isolation_status, operational_status, op_beds!bed_id(label, bed_type))")
    .eq("staff_id", userId).eq("status", "active").limit(50);
  const patients = ((asg ?? []) as any[]).filter(a => a.op_patients).map(a => {
    const unitType = resolveUnitType(a.op_patients.op_beds?.bed_type ?? null);
    return {
      ...a.op_patients,
      assignment_type: a.assignment_type,
      bed: a.op_patients.op_beds?.label ?? null,
      // UNIT-ASM-001: the toolset is RESOLVED from the care location — the UI
      // never offers a tool picker.
      unit_type: unitType,
      tools: TOOLSET[unitType],
      default_framework: unitType,
    };
  });
  const ids = patients.map(p => p.id);

  let acuity: any[] = [], workload: any[] = [];
  let migrationMissing = false;
  if (ids.length) {
    const [aRes, wRes] = await Promise.all([
      admin.from("op_acuity_assessments").select("*").in("patient_id", ids).order("assessed_at", { ascending: false }).limit(300),
      admin.from("op_workload_assessments").select("*").in("patient_id", ids).order("assessed_at", { ascending: false }).limit(300),
    ]);
    migrationMissing = migrationMissingErr(aRes.error) || migrationMissingErr(wRes.error);
    acuity = aRes.data ?? [];
    workload = wRes.data ?? [];
  } else {
    // Probe so an assigned-patient-less nurse still sees the migration banner honestly.
    const probe = await admin.from("op_acuity_assessments").select("id").limit(1);
    migrationMissing = migrationMissingErr(probe.error);
  }

  const byPatient = (rows: any[]) => {
    const m = new Map<string, any[]>();
    for (const r of rows) m.set(r.patient_id, [...(m.get(r.patient_id) ?? []), r]);
    return m;
  };
  const agg = await nurseWorkloadAggregate(admin, userId);

  // 24h reassessment counts computed here (pages are render-pure — no Date.now
  // during render).
  const dayAgo = Date.now() - 24 * 3.6e6;
  const within24h = (rows: any[]) => rows.filter(r => +new Date(r.assessed_at) > dayAgo).length;

  return {
    migrationMissing,
    patients,
    acuityByPatient: byPatient(acuity),
    workloadByPatient: byPatient(workload),
    acuityReassessed24h: within24h(acuity),
    workloadReassessed24h: within24h(workload),
    aggregate: agg,
    loadedAt: Date.now(),   // pages compare reassess_by against this (render-pure)
  };
}
