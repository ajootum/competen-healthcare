// Assessment instruments v2 (migration 157) — the four redesigned tools and
// the UNIT-ASM-001 resolution rule that picks them automatically:
//   PEWS   (HWW-WARD-ACU-001)  ward acuity: recorded total 0-15 + category-3
//          trigger -> colour band (white/light-green/yellow/orange/red) with
//          operational prompts + reassessment intervals. Competen records the
//          ALREADY-CALCULATED total — it never computes PEWS from vitals.
//   WARD12 (HWW-WARD-WKL-001)  ward workload: 12 domains 0-3 (max 36) +
//          admission/transfer/observation modifiers -> W1-W5 + ratio.
//   CIAF   (HWW-ICU-ACU-001)   ICU acuity: weighted composite /100 from the
//          AACN Synergy characteristics (50), neuro RASS+CAM (20), organ
//          support (20) and risk modifiers (10) -> A1-A5 + ratio.
//   NAS    (HWW-ICU-WKL-001)   ICU workload: the existing Miranda activities
//          engine gains I1-I5 workload levels + staffing ratios.
// All bands/weights here are the Competen DEFAULT profile (spec: configurable
// via governed configuration — the constants are the single place to lift
// into config later). Professional overrides require a reason. Pure functions
// throughout; harness-proven.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ── UNIT-ASM-001: tool resolution from the care location ────────────────────
export type UnitType = "ward" | "icu";

export function resolveUnitType(bedType: string | null | undefined): UnitType {
  return bedType === "critical_care" ? "icu" : "ward";
}

// The resolved toolset per unit type. Submissions with any other tool are
// rejected server-side (409) — users never pick tools manually.
export const TOOLSET: Record<UnitType, { acuity: string; workload: string; acuityLabel: string; workloadLabel: string }> = {
  ward: { acuity: "pews", workload: "ward12", acuityLabel: "Ward PEWS", workloadLabel: "Ward Nursing Workload (12 domains)" },
  icu: { acuity: "ciaf", workload: "nas", acuityLabel: "ICU Composite Acuity (CIAF)", workloadLabel: "ICU Nursing Activities Score (NAS)" },
};

export function acuityMaxFor(framework: string): number {
  return framework === "pews" ? 15 : framework === "ciaf" ? 100 : 18;
}

// ── PEWS (WARD-ACU-001 escalation matrix, Competen defaults) ────────────────
export type PewsBand = { key: string; label: string; tone: string; spine: string; reassessMinutes: number; action: string };
export const PEWS_BANDS: PewsBand[] = [
  { key: "white", label: "Routine", tone: "bg-gray-100 text-gray-600", spine: "stable", reassessMinutes: 240, action: "Continue monitoring per routine protocols." },
  { key: "light_green", label: "Early Concern", tone: "bg-green-100 text-green-700", spine: "stable", reassessMinutes: 120, action: "Review with Shift Supervisor; escalate to Medical Officer where needed." },
  { key: "yellow", label: "Increased Concern", tone: "bg-yellow-100 text-yellow-800", spine: "moderate", reassessMinutes: 120, action: "Apply the PEWS 2 pathway; increase assessment/documentation frequency." },
  { key: "orange", label: "High Risk", tone: "bg-orange-100 text-orange-700", spine: "high", reassessMinutes: 60, action: "Notify Medical Officer, communicate plan, reassess resources, consider higher level of care." },
  { key: "red", label: "Critical", tone: "bg-red-100 text-red-700", spine: "critical", reassessMinutes: 30, action: "Immediate Medical Officer assessment; senior review; enhanced nursing response; reassess location/transfer." },
];

// Total -> band per the matrix: 0-1 white, 2 light green, 3 yellow, 4 orange,
// 5-15 red; ANY single category scored 3 forces red (the special trigger).
export function classifyPews(total: number, category3: boolean): PewsBand {
  if (category3 || total >= 5) return PEWS_BANDS[4];
  if (total >= 4) return PEWS_BANDS[3];
  if (total >= 3) return PEWS_BANDS[2];
  if (total >= 2) return PEWS_BANDS[1];
  return PEWS_BANDS[0];
}

export function computePews(input: { total: any; category3?: boolean }): { score: number; classification: string; spineLevel: string; reassessMinutes: number; band: PewsBand; errors: string[] } {
  const errors: string[] = [];
  const n = Number(input.total);
  if (!Number.isInteger(n) || n < 0 || n > 15) errors.push("PEWS total must be an integer 0-15");
  const band = classifyPews(Number.isInteger(n) ? n : 0, !!input.category3);
  return { score: Number.isInteger(n) ? n : 0, classification: band.key, spineLevel: band.spine, reassessMinutes: band.reassessMinutes, band, errors };
}

// ── Ward workload — 12 domains (WARD-WKL-001) ───────────────────────────────
export const WARD12_DOMAINS = [
  { key: "clinical_stability", label: "Clinical stability & deterioration surveillance" },
  { key: "observation_frequency", label: "Observation & monitoring frequency" },
  { key: "respiratory", label: "Respiratory care workload" },
  { key: "neurological", label: "Neurological care workload" },
  { key: "circulation", label: "Circulation, fluids & bleeding" },
  { key: "mobility_adl", label: "Mobility, hygiene & ADLs" },
  { key: "nutrition", label: "Nutrition, feeding & elimination" },
  { key: "medication_complexity", label: "Medication & treatment complexity" },
  { key: "devices_wounds", label: "Devices, wounds & procedures" },
  { key: "ipc_isolation", label: "Infection prevention & isolation" },
  { key: "communication_family", label: "Communication, behaviour & family support" },
  { key: "coordination", label: "Care coordination & transitions" },
] as const;

export const WARD12_MODIFIERS = [
  { key: "new_admission", label: "New admission (within 4 hrs)", weight: 2 },
  { key: "patient_transfer", label: "Patient transfer (within 4 hrs)", weight: 2 },
  { key: "emergency_procedure", label: "Emergency procedure (this shift)", weight: 2 },
  { key: "continuous_observation", label: "Continuous / special observation", weight: 2 },
  { key: "behavioural", label: "Behavioural / safeguarding needs", weight: 2 },
  { key: "high_risk_infusions", label: "High-risk medication infusions", weight: 1 },
  { key: "isolation", label: "Isolation precautions", weight: 1 },
] as const;

export type LevelBand = { level: string; min: number; max: number | null; ratio: string; label: string };
export const W_LEVELS: LevelBand[] = [
  { level: "W1", min: 0, max: 7, ratio: "1:6", label: "Routine" },
  { level: "W2", min: 8, max: 14, ratio: "1:5", label: "Low" },
  { level: "W3", min: 15, max: 22, ratio: "1:4", label: "Moderate" },
  { level: "W4", min: 23, max: 30, ratio: "1:3", label: "High" },
  { level: "W5", min: 31, max: null, ratio: "1:2", label: "Very High" },
];

export const I_LEVELS: LevelBand[] = [
  { level: "I1", min: 0, max: 20, ratio: "1:3", label: "Low" },
  { level: "I2", min: 21, max: 40, ratio: "1:2", label: "Moderate" },
  { level: "I3", min: 41, max: 60, ratio: "1:1", label: "High" },
  { level: "I4", min: 61, max: 80, ratio: "1:1 + support", label: "Very High" },
  { level: "I5", min: 81, max: null, ratio: "Dedicated 1:1", label: "Extreme" },
];

export function levelFromBands(score: number, bands: LevelBand[]): LevelBand {
  return bands.find(b => score >= b.min && (b.max == null || score <= b.max)) ?? bands[bands.length - 1];
}

export function computeWard12(input: { domains: any; modifiers?: any }): { score: number; base: number; modifierPoints: number; level: string; ratio: string; levelLabel: string; errors: string[] } {
  const errors: string[] = [];
  const d = input.domains && typeof input.domains === "object" && !Array.isArray(input.domains) ? input.domains : {};
  let base = 0;
  for (const dom of WARD12_DOMAINS) {
    const v = Number(d[dom.key]);
    if (!Number.isInteger(v) || v < 0 || v > 3) { errors.push(`${dom.key} must be an integer 0-3`); continue; }
    base += v;
  }
  const extras = Object.keys(d).filter(k => !WARD12_DOMAINS.some(x => x.key === k));
  if (extras.length) errors.push(`unknown domains: ${extras.join(", ")}`);
  const sel: string[] = Array.isArray(input.modifiers) ? input.modifiers.map(String) : [];
  let modifierPoints = 0;
  for (const k of sel) {
    const m = WARD12_MODIFIERS.find(x => x.key === k);
    if (!m) { errors.push(`unknown modifier: ${k}`); continue; }
    modifierPoints += m.weight;
  }
  const score = base + modifierPoints;
  const band = levelFromBands(score, W_LEVELS);
  return { score, base, modifierPoints, level: band.level, ratio: band.ratio, levelLabel: band.label, errors };
}

// ── CIAF composite (ICU-ACU-001, Competen default profile) ──────────────────
// Weighted composite /100: AACN Synergy 50 + neuro (RASS+CAM) 20 + organ
// support 20 + risk modifiers 10. Component results stay inspectable.
export const AACN_CHARACTERISTICS = [
  { key: "resiliency", label: "Resiliency" },
  { key: "vulnerability", label: "Vulnerability" },
  { key: "stability", label: "Stability" },
  { key: "complexity", label: "Complexity" },
  { key: "resource_availability", label: "Resource availability" },
  { key: "participation_care", label: "Participation in care" },
  { key: "participation_decisions", label: "Participation in decision-making" },
  { key: "predictability", label: "Predictability" },
] as const;
// AACN characteristics score 1 (worst) .. 5 (best) — LOW values mean HIGH
// acuity, so the component inverts: (40 - sum) / 32 * 50.

export const RASS_OPTIONS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4] as const;
const RASS_POINTS: Record<string, number> = { "-5": 8, "-4": 8, "-3": 6, "-2": 4, "-1": 2, "0": 0, "1": 3, "2": 5, "3": 7, "4": 8 };
export const CAM_OPTIONS = ["negative", "positive", "unable"] as const;
// CAM positive 12 so the worst neuro state (deep sedation/agitation 8 + CAM
// positive 12) reaches the full 20-point neuro component — the profile's
// theoretical maximum is then exactly 100.
const CAM_POINTS: Record<string, number> = { negative: 0, positive: 12, unable: 4 };

export const ORGAN_SUPPORTS = [
  { key: "invasive_ventilation", label: "Invasive ventilation", weight: 8 },
  { key: "niv", label: "Non-invasive ventilation", weight: 4 },
  { key: "high_flow_o2", label: "High-flow oxygen", weight: 2 },
  { key: "vasoactive_single", label: "Vasoactive support (single agent)", weight: 5 },
  { key: "vasoactive_multiple", label: "Vasoactive support (multiple agents)", weight: 8 },
  { key: "crrt", label: "CRRT / renal replacement", weight: 6 },
  { key: "ecmo", label: "ECMO", weight: 10 },
  { key: "mechanical_circulatory", label: "IABP / VAD", weight: 8 },
  { key: "icp_monitoring", label: "ICP monitoring", weight: 5 },
  { key: "pacing", label: "Temporary pacing", weight: 4 },
  { key: "chest_drains", label: "Chest drains", weight: 2 },
] as const;

export const CIAF_RISK_MODIFIERS = [
  { key: "isolation_precautions", label: "Isolation precautions", weight: 2 },
  { key: "high_risk_infusions", label: "High-risk infusions", weight: 2 },
  { key: "recent_deterioration", label: "Recent deterioration (<24h)", weight: 2 },
  { key: "massive_transfusion", label: "Massive transfusion", weight: 3 },
  { key: "severe_sepsis", label: "Severe sepsis / septic shock", weight: 2 },
  { key: "post_arrest", label: "Post cardiac arrest", weight: 3 },
] as const;

export const A_LEVELS: LevelBand[] = [
  { level: "A1", min: 0, max: 10, ratio: "1:3", label: "Low" },
  { level: "A2", min: 11, max: 20, ratio: "1:2", label: "Moderate" },
  { level: "A3", min: 21, max: 30, ratio: "1:1", label: "High" },
  { level: "A4", min: 31, max: 40, ratio: "1:1 + support", label: "Very High" },
  { level: "A5", min: 41, max: null, ratio: "Dedicated 1:1", label: "Extreme" },
];
const A_SPINE: Record<string, string> = { A1: "stable", A2: "moderate", A3: "high", A4: "critical", A5: "critical" };

export function computeCiaf(input: { aacn: any; rass: any; cam: any; organ_supports?: any; risk_modifiers?: any }): {
  score: number; level: string; ratio: string; levelLabel: string; spineLevel: string;
  components: { aacn: number; neuro: number; organ: number; risk: number; aacnRaw: number };
  errors: string[];
} {
  const errors: string[] = [];
  const a = input.aacn && typeof input.aacn === "object" && !Array.isArray(input.aacn) ? input.aacn : {};
  let aacnRaw = 0;
  for (const ch of AACN_CHARACTERISTICS) {
    const v = Number(a[ch.key]);
    if (!Number.isInteger(v) || v < 1 || v > 5) { errors.push(`${ch.key} must be an integer 1-5`); continue; }
    aacnRaw += v;
  }
  const aacn = Math.round(((40 - Math.min(40, Math.max(8, aacnRaw))) / 32) * 50);

  const rass = Number(input.rass);
  if (!RASS_OPTIONS.includes(rass as any)) errors.push("rass must be -5..+4");
  const cam = String(input.cam ?? "");
  if (!CAM_OPTIONS.includes(cam as any)) errors.push("cam must be negative | positive | unable");
  const neuro = Math.min(20, (RASS_POINTS[String(rass)] ?? 0) + (CAM_POINTS[cam] ?? 0));

  const supports: string[] = Array.isArray(input.organ_supports) ? input.organ_supports.map(String) : [];
  let organ = 0;
  for (const k of supports) {
    const s = ORGAN_SUPPORTS.find(x => x.key === k);
    if (!s) { errors.push(`unknown organ support: ${k}`); continue; }
    organ += s.weight;
  }
  organ = Math.min(20, organ);

  const mods: string[] = Array.isArray(input.risk_modifiers) ? input.risk_modifiers.map(String) : [];
  let risk = 0;
  for (const k of mods) {
    const m = CIAF_RISK_MODIFIERS.find(x => x.key === k);
    if (!m) { errors.push(`unknown risk modifier: ${k}`); continue; }
    risk += m.weight;
  }
  risk = Math.min(10, risk);

  const score = Math.min(100, aacn + neuro + organ + risk);
  const band = levelFromBands(score, A_LEVELS);
  return {
    score, level: band.level, ratio: band.ratio, levelLabel: band.label,
    spineLevel: A_SPINE[band.level] ?? "moderate",
    components: { aacn, neuro, organ, risk, aacnRaw },
    errors,
  };
}

// ── Overrides (all instruments): a professional-judgement level override
// must be a valid level for the instrument and carry a reason. ──────────────
export function validateOverride(bands: LevelBand[], overrideLevel: any, reason: any): string[] {
  if (overrideLevel == null || overrideLevel === "") return [];
  const errs: string[] = [];
  if (!bands.some(b => b.level === overrideLevel)) errs.push(`override level must be one of: ${bands.map(b => b.level).join(", ")}`);
  if (!String(reason ?? "").trim()) errs.push("an override requires a professional-judgement reason");
  return errs;
}
