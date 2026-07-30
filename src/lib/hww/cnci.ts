// CNCI — Composite Nursing Care Index (HWW-ARCH-002 S9). The default patient
// prioritisation engine: one explainable 0-100 score combining acuity,
// workload, safety risk, time-critical work, care complexity and trend.
// DETERMINISTIC — documented component weights, a drivers list stating what
// contributed, and the mockup's bands (Critical 80-100 / High 60-79 /
// Moderate 30-59 / Low 0-29). Computed from the same real signals every HWW
// surface already loads; never persisted, always derived fresh.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type CnciInput = {
  acuityScore: number | null;        // measured score in ITS instrument's scale; null → level fallback
  acuityMax?: number;                // the instrument's maximum (18 legacy, 15 PEWS, 100 CIAF)
  acuityLevel: string;               // stable|moderate|high|critical
  workloadPct: number | null;        // latest NAS/ward %
  pewsLatest: number | null;
  pewsPrev: number | null;
  significantAcuityChange: boolean;
  activeAlerts: number;
  openEscalations: number;
  isolation: boolean;
  riskLevel: string;                 // low|medium|high
  obsOverdue: number;
  obsDue: number;
  medsOverdue: number;
  medsDueSoon: number;               // due within the window (not yet overdue)
  urgentTasks: number;
  openConcerns: number;              // care-complexity signal
};

export type CnciResult = {
  score: number;                     // 0-100
  band: "critical" | "high" | "moderate" | "low";
  components: { acuity: number; workload: number; safety: number; timeCritical: number; trend: number };
  drivers: string[];                 // explainability: what pushed the score
};

// Level fallback when no scored acuity assessment exists yet.
const LEVEL_SCORE: Record<string, number> = { stable: 2, moderate: 7, high: 12, critical: 16 };
// Component ceilings (sum = 100): acuity 30, workload 15, safety 20, time-critical 20, trend 15.
export const CNCI_WEIGHTS = { acuity: 30, workload: 15, safety: 20, timeCritical: 20, trend: 15 } as const;

export const CNCI_BANDS = [
  { key: "critical", min: 80, label: "Critical", tone: "bg-red-100 text-red-700", dot: "text-red-600" },
  { key: "high", min: 60, label: "High", tone: "bg-orange-100 text-orange-700", dot: "text-orange-600" },
  { key: "moderate", min: 30, label: "Moderate", tone: "bg-amber-100 text-amber-700", dot: "text-amber-600" },
  { key: "low", min: 0, label: "Low", tone: "bg-green-100 text-green-700", dot: "text-green-600" },
] as const;

export function cnciBand(score: number): CnciResult["band"] {
  return score >= 80 ? "critical" : score >= 60 ? "high" : score >= 30 ? "moderate" : "low";
}
export function cnciTone(band: string): string {
  return CNCI_BANDS.find(b => b.key === band)?.tone ?? CNCI_BANDS[3].tone;
}

const r0 = (n: number) => Math.round(n);

export function computeCnci(i: CnciInput): CnciResult {
  const drivers: string[] = [];

  // Acuity (0-30): measured score preferred (normalised by ITS instrument's
  // maximum — 18 legacy, 15 PEWS, 100 CIAF), coarse level otherwise.
  const max = i.acuityMax && i.acuityMax > 0 ? i.acuityMax : 18;
  const acuityRatio = i.acuityScore != null ? Math.min(1, i.acuityScore / max) : (LEVEL_SCORE[i.acuityLevel] ?? 7) / 18;
  const acuity = Math.min(CNCI_WEIGHTS.acuity, acuityRatio * CNCI_WEIGHTS.acuity);
  if (acuityRatio >= 12 / 18) drivers.push(`acuity ${i.acuityScore != null ? `${i.acuityScore}/${max}` : i.acuityLevel}`);

  // Workload (0-15): 120% of one nurse's capacity saturates the component.
  const wl = i.workloadPct ?? 0;
  const workload = Math.min(CNCI_WEIGHTS.workload, (Math.min(wl, 120) / 120) * CNCI_WEIGHTS.workload);
  if (wl >= 60) drivers.push(`workload ${wl}%`);

  // Safety risk (0-20): alerts, escalations, isolation, coarse risk, concerns (complexity).
  let safety = i.activeAlerts * 6 + i.openEscalations * 8 + (i.isolation ? 3 : 0)
    + (i.riskLevel === "high" ? 5 : i.riskLevel === "medium" ? 2 : 0) + Math.min(4, i.openConcerns * 2);
  safety = Math.min(CNCI_WEIGHTS.safety, safety);
  if (i.activeAlerts) drivers.push(`${i.activeAlerts} active safety alert${i.activeAlerts === 1 ? "" : "s"}`);
  if (i.openEscalations) drivers.push(`${i.openEscalations} open escalation${i.openEscalations === 1 ? "" : "s"}`);
  if (i.openConcerns) drivers.push(`${i.openConcerns} open concern${i.openConcerns === 1 ? "" : "s"}`);

  // Time-critical work (0-20): overdue outranks due.
  let timeCritical = i.obsOverdue * 6 + i.medsOverdue * 6 + i.obsDue * 2 + i.medsDueSoon * 2 + i.urgentTasks * 4;
  timeCritical = Math.min(CNCI_WEIGHTS.timeCritical, timeCritical);
  if (i.obsOverdue || i.medsOverdue) drivers.push(`${i.obsOverdue + i.medsOverdue} overdue item${i.obsOverdue + i.medsOverdue === 1 ? "" : "s"}`);
  if (i.urgentTasks) drivers.push(`${i.urgentTasks} urgent task${i.urgentTasks === 1 ? "" : "s"}`);

  // Trend / deterioration (0-15): PEWS magnitude + direction + acuity jump.
  const pews = i.pewsLatest;
  let trend = pews == null ? 0 : pews >= 7 ? 12 : pews >= 5 ? 8 : pews >= 3 ? 4 : 0;
  const rising = pews != null && i.pewsPrev != null && pews > i.pewsPrev;
  if (rising) trend += 3;
  if (i.significantAcuityChange) trend += 4;
  trend = Math.min(CNCI_WEIGHTS.trend, trend);
  if (pews != null && pews >= 5) drivers.push(`PEWS ${pews}${rising ? " and rising" : ""}`);
  else if (rising) drivers.push(`PEWS rising (${i.pewsPrev} → ${pews})`);
  if (i.significantAcuityChange) drivers.push("significant acuity change");

  const score = Math.min(100, r0(acuity + workload + safety + timeCritical + trend));
  return {
    score,
    band: cnciBand(score),
    components: { acuity: r0(acuity), workload: r0(workload), safety: r0(safety), timeCritical: r0(timeCritical), trend: r0(trend) },
    drivers: drivers.length ? drivers : ["no elevated signals"],
  };
}

// PEWS trend arrow for tables: latest vs previous recorded score.
export function pewsTrend(latest: number | null, prev: number | null): "up" | "down" | "flat" | null {
  if (latest == null || prev == null) return null;
  return latest > prev ? "up" : latest < prev ? "down" : "flat";
}

// Assemble a CnciInput from the row shapes the HWW loaders already produce —
// one place that maps store rows to index signals, shared by the dashboard,
// My Patients and the patient workspace.
const ACUITY_MAX_BY_FRAMEWORK: Record<string, number> = { pews: 15, ciaf: 100, ward: 18, icu: 18 };

export function cnciInputFromRows(args: {
  patient: { acuity_level: string; isolation_status?: string | null; risk_level?: string | null };
  acuityLatest?: { score: number; framework?: string; significant_change?: boolean } | null;
  workloadLatest?: { percentage: number } | null;
  observations?: any[];              // this patient's op_observations rows
  meds?: any[];                      // this patient's op_med_schedule rows (effective_status applied)
  alerts?: any[];
  escalations?: any[];
  concerns?: any[];
  tasks?: any[];
}): CnciInput {
  const obs = args.observations ?? [];
  const recorded = obs.filter((o: any) => o.ews_score != null)
    .sort((a: any, b: any) => +new Date(b.recorded_at ?? b.created_at ?? 0) - +new Date(a.recorded_at ?? a.created_at ?? 0));
  const meds = args.meds ?? [];
  return {
    acuityScore: args.acuityLatest?.score ?? null,
    acuityMax: ACUITY_MAX_BY_FRAMEWORK[args.acuityLatest?.framework ?? "ward"] ?? 18,
    acuityLevel: args.patient.acuity_level,
    workloadPct: args.workloadLatest != null ? Number(args.workloadLatest.percentage) : null,
    pewsLatest: recorded[0]?.ews_score ?? null,
    pewsPrev: recorded[1]?.ews_score ?? null,
    significantAcuityChange: !!args.acuityLatest?.significant_change,
    activeAlerts: (args.alerts ?? []).length,
    openEscalations: (args.escalations ?? []).length,
    isolation: !!args.patient.isolation_status && args.patient.isolation_status !== "none",
    riskLevel: args.patient.risk_level ?? "low",
    obsOverdue: obs.filter((o: any) => o.status === "overdue").length,
    obsDue: obs.filter((o: any) => o.status === "due").length,
    medsOverdue: meds.filter((m: any) => (m.effective_status ?? m.status) === "overdue").length,
    medsDueSoon: meds.filter((m: any) => (m.effective_status ?? m.status) === "due").length,
    urgentTasks: (args.tasks ?? []).filter((t: any) => t.priority === "urgent").length,
    openConcerns: (args.concerns ?? []).length,
  };
}

// Event-driven reassessment prompt (HWW-ARCH-002 S8): a focused acuity
// reassessment is DUE when a deterioration signal postdates the latest acuity
// assessment — an escalated/breaching observation, PEWS >= 5, or nothing
// assessed at all for a non-stable patient.
export function reassessmentDue(args: {
  latestAcuityAt: string | null;
  latestObsEscalatedAt: string | null;   // most recent obs with escalation_triggered or ews>=5
  acuityLevel: string;
}): { due: boolean; reason: string | null } {
  if (args.latestObsEscalatedAt) {
    if (!args.latestAcuityAt || new Date(args.latestObsEscalatedAt) > new Date(args.latestAcuityAt)) {
      return { due: true, reason: "deterioration signal since the last acuity assessment" };
    }
  }
  if (!args.latestAcuityAt && ["high", "critical"].includes(args.acuityLevel)) {
    return { due: true, reason: "no scored assessment for a high-acuity patient" };
  }
  return { due: false, reason: null };
}
