// HEX-003 Performance Management Centre (executive lens) — balanced scorecard + KPI trees.
// Grounded in fetchPerformance (pa_* balanced scorecard, live values from op_ops_snapshots) + strategic
// objectives from fetchFramework (ppe_*). Department-level performers and YoY history need their own
// stores → reported honestly. Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchPerformance } from "@/lib/analytics/performance";
import { fetchFramework } from "@/lib/priorities/engine";

export async function loadExecPerformance(admin: any, hid: string | null, isSuper: boolean) {
  const perf = await fetchPerformance(admin, hid, isSuper);
  if (!perf.provisioned) return { provisioned: false as const };
  const framework = await fetchFramework(admin).catch(() => ({ provisioned: false }) as any);

  const kpis = (perf.kpis ?? []) as any[];
  const green = kpis.filter(k => k.status === "green").length;
  const amber = kpis.filter(k => k.status === "amber").length;
  const red = kpis.filter(k => k.status === "red").length;
  const kpiTotal = kpis.length;

  // Objectives (ppe_*) — published, on-track = progress >= 60%.
  let objOnTrack: number | null = null, objAtRisk = 0, objectives: any[] = [];
  if (framework.provisioned) {
    const pub = (framework.objectives ?? []).filter((o: any) => o.status === "published");
    objectives = pub;
    if (pub.length) { objOnTrack = Math.round((pub.filter((o: any) => Number(o.progress_pct) >= 60).length / pub.length) * 100); objAtRisk = pub.filter((o: any) => Number(o.progress_pct) < 50).length; }
  }
  const campaigns = framework.provisioned ? (framework.campaigns ?? []) : [];
  const activeCamp = campaigns.filter((c: any) => c.status === "active");
  const initOnTrack = activeCamp.length ? Math.round((activeCamp.filter((c: any) => Number(c.progress_pct) >= 50).length / activeCamp.length) * 100) : null;

  // KPI heat map — perspective × RAG.
  const perspNames = [...new Set(kpis.map(k => k.perspectiveName).filter(Boolean))];
  const heat = perspNames.map(name => {
    const rows = kpis.filter(k => k.perspectiveName === name);
    return { perspective: name, green: rows.filter(k => k.status === "green").length, amber: rows.filter(k => k.status === "amber").length, red: rows.filter(k => k.status === "red").length };
  });

  const scorecard = (perf.scorecard ?? []) as any[];
  const ranked = [...scorecard].sort((a, b) => b.score - a.score);

  // Action centre — off-target KPIs + at-risk objectives.
  const actions = [
    ...kpis.filter(k => k.status === "red").slice(0, 6).map(k => ({ type: "KPI", item: k.name ?? k.code, detail: `${k.perspectiveName ?? "—"} · ${k.achievement != null ? Math.round(k.achievement) + "% of target" : "off target"}`, tone: "rose" })),
    ...objectives.filter((o: any) => Number(o.progress_pct) < 50).slice(0, 3).map((o: any) => ({ type: "Objective", item: o.title, detail: `${Math.round(Number(o.progress_pct))}% progress`, tone: "amber" })),
  ].slice(0, 8);

  return {
    provisioned: true as const, hasData: perf.hasData,
    kpis: {
      overall: perf.overall, objOnTrack, kpisMet: kpiTotal ? Math.round((green / kpiTotal) * 100) : null,
      initOnTrack, variance: red, objAtRisk, kpiTotal,
    },
    scorecard: scorecard.map(s => ({ name: s.name, score: s.score, status: s.status, kpiCount: s.kpiCount, green: s.green, target: s.target })),
    heat,
    varianceDonut: [
      { label: "On target", value: green, tone: "emerald" },
      { label: "Watch", value: amber, tone: "amber" },
      { label: "Off target", value: red, tone: "rose" },
    ],
    objectives: objectives.slice(0, 6).map((o: any) => ({ title: o.title, progress: Math.round(Number(o.progress_pct)), target: o.target_pct != null ? Math.round(Number(o.target_pct)) : null })),
    topPerformers: ranked.slice(0, 5).map(s => ({ name: s.name, score: s.score, status: s.status })),
    bottomPerformers: ranked.slice(-3).reverse().map(s => ({ name: s.name, score: s.score, status: s.status })),
    actions,
    frameworkProvisioned: framework.provisioned,
  };
}
