// HEX-009 Strategy & Transformation (executive lens) — strategy-to-results over ppe_* (fetchFramework)
// + the balanced scorecard (fetchPerformance) + strategic risks (gov_risks). Benefits-realisation,
// change/adoption and scenario stores are ABSENT → reported honestly. Tenant-scoped where applicable.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchFramework } from "@/lib/priorities/engine";
import { fetchPerformance } from "@/lib/analytics/performance";

const NONE = "00000000-0000-0000-0000-000000000000";
const THEME_TONE = ["teal", "blue", "indigo", "violet", "amber", "rose", "emerald", "slate"];

export async function loadExecStrategy(admin: any, hid: string | null, isSuper: boolean) {
  const framework = await fetchFramework(admin);
  if (!framework.provisioned) return { provisioned: false as const };
  const perf = await fetchPerformance(admin, hid, isSuper).catch(() => ({ provisioned: false }) as any);
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const objectives = (framework.objectives ?? []).filter((o: any) => o.status === "published");
  const campaigns = (framework.campaigns ?? []) as any[];
  const themes = (framework.themes ?? []) as any[];
  const approvals = (framework.approvals ?? []) as any[];

  const strategyProgress = objectives.length ? Math.round(objectives.reduce((s: number, o: any) => s + Number(o.progress_pct || 0), 0) / objectives.length) : null;
  const objOnTrack = objectives.length ? Math.round((objectives.filter((o: any) => Number(o.progress_pct) >= 60).length / objectives.length) * 100) : null;
  const activeInitiatives = campaigns.filter(c => c.status === "active");
  const transformationProgress = activeInitiatives.length ? Math.round(activeInitiatives.reduce((s: number, c: any) => s + Number(c.progress_pct || 0), 0) / activeInitiatives.length) : null;
  const initiativeBudget = campaigns.reduce((s: number, c: any) => s + Number(c.budget || 0), 0);
  const pendingApprovals = approvals.filter(a => a.state === "pending").length;

  // Strategic risks (light, scoped).
  let strategicRisksHigh = 0, topRisks: any[] = [];
  try {
    const { data } = await scope(admin.from("gov_risks").select("title, category, likelihood, impact, residual_likelihood, residual_impact, owner_name, status").eq("category", "strategic").limit(2000));
    const rows = ((data ?? []) as any[]).filter(r => r.status !== "closed");
    strategicRisksHigh = rows.filter(r => Number(r.likelihood) * Number(r.impact) >= 10).length;
    topRisks = [...rows].sort((a, b) => (Number(b.likelihood) * Number(b.impact)) - (Number(a.likelihood) * Number(a.impact))).slice(0, 5).map(r => ({ title: r.title, inherent: Number(r.likelihood) * Number(r.impact), residual: (r.residual_likelihood && r.residual_impact) ? Number(r.residual_likelihood) * Number(r.residual_impact) : Number(r.likelihood) * Number(r.impact), owner: r.owner_name }));
  } catch { /* optional */ }

  // Strategy map — themes with their objective counts + avg progress.
  const strategyMap = themes.slice(0, 6).map((t: any, i: number) => {
    const objs = objectives.filter((o: any) => o.theme_id === t.id);
    return { name: t.name, count: objs.length, progress: objs.length ? Math.round(objs.reduce((s: number, o: any) => s + Number(o.progress_pct || 0), 0) / objs.length) : 0, tone: THEME_TONE[i % THEME_TONE.length] };
  });

  const topInitiatives = [...campaigns].sort((a, b) => Number(b.progress_pct || 0) - Number(a.progress_pct || 0)).slice(0, 5).map(c => {
    const theme = themes.find((t: any) => t.id === c.theme_id);
    return { title: c.name, theme: theme?.name ?? "—", progress: Math.round(Number(c.progress_pct || 0)), status: c.status };
  });

  // Benefits proxy — initiative budget by theme (honest: budget under management, not realised value).
  const budgetByTheme = themes.map((t: any, i: number) => ({ label: t.name, value: Math.round(campaigns.filter(c => c.theme_id === t.id).reduce((s: number, c: any) => s + Number(c.budget || 0), 0)), tone: THEME_TONE[i % THEME_TONE.length] })).filter(x => x.value > 0);

  return {
    provisioned: true as const,
    kpis: {
      strategyProgress, objOnTrack, activeInitiatives: activeInitiatives.length, totalInitiatives: campaigns.length,
      initiativeBudget, transformationProgress, strategicRisksHigh, pendingApprovals,
    },
    strategyMap, topInitiatives, topRisks,
    scorecard: perf.provisioned ? (perf.scorecard ?? []).map((s: any) => ({ label: s.name, pct: s.score, value: `${s.score}%` })) : [],
    budgetByTheme,
    transformation: {
      onTrack: campaigns.filter(c => c.status === "active" && Number(c.progress_pct) >= 50).length,
      atRisk: campaigns.filter(c => c.status === "active" && Number(c.progress_pct) < 50).length,
      completed: campaigns.filter(c => c.status === "completed").length,
      notStarted: campaigns.filter(c => c.status === "planned").length,
    },
  };
}
