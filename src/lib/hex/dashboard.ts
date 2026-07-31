// HEX-001 Executive Dashboard — the 30-second enterprise view. Aggregates the executive scorecard
// (loadExecutiveDashboard = HR + Quality), strategic initiatives/objectives (ppe_* via fetchFramework)
// and the real risk register (gov_risks). Tenant-scoped; every figure reconciles with its owning module.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadExecutiveDashboard } from "@/lib/executive-data";
import { fetchFramework } from "@/lib/priorities/engine";

const NONE = "00000000-0000-0000-0000-000000000000";

export async function loadExecHome(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const d = await loadExecutiveDashboard(admin, hid, isSuper);
  const fw = await fetchFramework(admin).catch(() => ({ provisioned: false }) as any);

  // Strategic initiatives — real ppe_* campaigns (fallback to improvement objectives from d.initiatives).
  let initiatives: any[] = [];
  if (fw.provisioned && (fw.campaigns ?? []).length) {
    const themes = fw.themes ?? [];
    initiatives = [...fw.campaigns].sort((a: any, b: any) => Number(b.progress_pct || 0) - Number(a.progress_pct || 0)).slice(0, 5)
      .map((c: any) => ({ title: c.name, progress: Math.round(Number(c.progress_pct || 0)), status: c.status, theme: themes.find((t: any) => t.id === c.theme_id)?.name ?? null }));
  } else {
    initiatives = (d.initiatives ?? []).slice(0, 5).map((i: any) => ({ title: i.title, progress: null, status: i.status, theme: null }));
  }
  const objectives = fw.provisioned ? (fw.objectives ?? []).filter((o: any) => o.status === "published") : [];
  const objProgress = objectives.length ? Math.round(objectives.reduce((s: number, o: any) => s + Number(o.progress_pct || 0), 0) / objectives.length) : null;

  // Risk register (light) — high count + top risks.
  let highRisks = 0, topRisks: any[] = [];
  try {
    const { data } = await scope(admin.from("gov_risks").select("title, category, likelihood, impact, status").limit(4000));
    const risks = ((data ?? []) as any[]).filter(r => r.status !== "closed");
    highRisks = risks.filter(r => Number(r.likelihood) * Number(r.impact) >= 10).length;
    topRisks = [...risks].sort((a, b) => (Number(b.likelihood) * Number(b.impact)) - (Number(a.likelihood) * Number(a.impact))).slice(0, 4)
      .map(r => ({ title: r.title, category: (r.category || "").replace(/_/g, " "), score: Number(r.likelihood) * Number(r.impact) }));
  } catch { /* optional */ }

  // Latest ops snapshot for quality & safety / occupancy tiles.
  let snap: any = {};
  try { const { data } = await scope(admin.from("op_ops_snapshots").select("occupancy_pct, safe_staffing_score").eq("period_type", "day").order("period", { ascending: false }).limit(1)); snap = (data ?? [])[0] ?? {}; } catch { /* optional */ }
  let qsnap: any = {};
  // quality_score_snapshots has NO medication_errors / infection_rate / mortality_index / readmission_rate.
  // Selecting them failed the WHOLE query, so safety_index and patient_safety_events — which do exist — were
  // lost with them and the executive safety panel rendered entirely blank. Found by
  // scripts/schema-drift-audit.ts. Only real columns are selected; the four with no source stay null, and
  // the consumers below already render null as "no data" rather than zero.
  try { const { data } = await scope(admin.from("quality_score_snapshots").select("safety_index, patient_safety_events").order("snapshot_date", { ascending: false }).limit(1)); qsnap = (data ?? [])[0] ?? {}; } catch { /* optional */ }

  return {
    d, readiness: d.readinessIndex, scorecard: d.scorecard,
    kpis: {
      readiness: d.readinessIndex, workforce: d.hr.headcount.total, quality: d.quality.complianceScore,
      highRisks, vacancies: d.hr.positions.vacant, initiatives: initiatives.length,
    },
    workforce: {
      fill: d.fillRate, competency: d.hr.competency.coverage, learning: d.hr.learning.compliance,
      establishment: d.hr.positions.establishment, filled: d.hr.positions.filled, vacant: d.hr.positions.vacant,
    },
    initiatives, objProgress,
    topRisks, highRisks,
    riskRows: d.risk,
    quality: d.quality,
    safety: { index: qsnap.safety_index != null ? Math.round(Number(qsnap.safety_index)) : null, pse: qsnap.patient_safety_events ?? null, medErrors: qsnap.medication_errors ?? null, infection: qsnap.infection_rate ?? null, mortality: qsnap.mortality_index ?? null, readmission: qsnap.readmission_rate ?? null, occupancy: snap.occupancy_pct != null ? Math.round(Number(snap.occupancy_pct)) : null },
    action: { criticalFindings: d.quality.findings.critical, overdueCapa: d.quality.capa.overdue, highRisks, vacancies: d.hr.positions.vacant },
  };
}
