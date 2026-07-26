// QAW-009 Accreditation Readiness & Survey Management — survey command centre.
// Grounded in gov_surveys (062) + gov_standard_assessments (061, latest-per-standard) + the CAPA
// action plan (capa_actions). Framework readiness = % of latest assessments met. Tracers, evidence
// rooms and interview prep have no store yet → reported honestly as next-phase. Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function loadReadiness(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  const { data: asmtRows, error } = await scope(admin.from("gov_standard_assessments").select("framework_id, reference_code, title, status, gap_note, assessed_at").order("assessed_at", { ascending: false }).limit(20000));
  if (error) return { provisioned: false as const };
  const assessments = (asmtRows ?? []) as any[];
  const latest = new Map<string, any>();
  assessments.forEach(a => { const key = `${a.framework_id}|${a.reference_code}`; if (!latest.has(key)) latest.set(key, a); });
  const latestArr = [...latest.values()];

  const { data: fwRows } = await admin.from("quality_frameworks").select("id, code, name").limit(200);
  const fwById = new Map((fwRows ?? []).map((f: any) => [f.id, f]));

  // Catalogue total (for "assessed of total").
  let totalStandards = 0;
  try {
    const { data: objs } = await scope(admin.from("quality_objects").select("id").limit(4000));
    const objIds = (objs ?? []).map((o: any) => o.id);
    for (let i = 0; i < objIds.length; i += 200) {
      const { count } = await admin.from("quality_standards").select("id", { count: "exact", head: true }).in("quality_object_id", objIds.slice(i, i + 200));
      totalStandards += count ?? 0;
    }
  } catch { /* optional */ }

  const cnt = (s: string) => latestArr.filter(a => a.status === s).length;
  const met = cnt("met"), partial = cnt("partially_met"), notMet = cnt("not_met"), notAssessed = cnt("not_assessed");
  const assessed = met + partial + notMet;
  const readiness = assessed ? Math.round((met / assessed) * 100) : null;

  // Readiness by framework ("domain").
  const fwAgg = new Map<string, { met: number; assessed: number }>();
  latestArr.forEach(a => { if (a.status === "not_assessed") return; const g = fwAgg.get(a.framework_id) ?? { met: 0, assessed: 0 }; g.assessed++; if (a.status === "met") g.met++; fwAgg.set(a.framework_id, g); });
  const byDomain = [...fwAgg.entries()].map(([fid, g], i) => ({ label: (fwById.get(fid) as any)?.code ?? "Framework", pct: g.assessed ? Math.round((g.met / g.assessed) * 100) : 0, value: g.assessed, tone: ["teal", "blue", "indigo", "violet", "amber", "rose"][i % 6] })).sort((a, b) => b.value - a.value);

  const topGaps = latestArr.filter(a => ["not_met", "partially_met"].includes(a.status)).slice(0, 6).map(a => ({ ref: a.reference_code, title: a.title, framework: (fwById.get(a.framework_id) as any)?.code ?? "—", status: a.status }));

  // Readiness trend (% met per month).
  const monthAgg = new Map<string, { met: number; assessed: number }>();
  assessments.forEach(a => { if (a.status === "not_assessed") return; const k = String(a.assessed_at).slice(0, 7); const g = monthAgg.get(k) ?? { met: 0, assessed: 0 }; g.assessed++; if (a.status === "met") g.met++; monthAgg.set(k, g); });
  const trend = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v.assessed ? Math.round((v.met / v.assessed) * 100) : 0 }));

  // Surveys.
  const { data: svRows } = await scope(admin.from("gov_surveys").select("title, framework_id, survey_type, surveyor, scheduled_date, end_date, status, outcome").order("scheduled_date", { ascending: false }).limit(2000));
  const surveys = (svRows ?? []) as any[];
  const mockCompleted = surveys.filter(s => s.survey_type === "mock" && s.status === "completed").length;
  const upcomingSurveys = surveys.filter(s => s.scheduled_date && s.scheduled_date >= today && !["completed", "cancelled"].includes(s.status)).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  const nextSurvey = upcomingSurveys[0];
  const daysToNext = nextSurvey ? Math.round((Date.parse(nextSurvey.scheduled_date) - Date.parse(today)) / 86400000) : null;

  // Action plan (CAPA).
  const { data: capaRows } = await scope(admin.from("capa_actions").select("status, due_date").limit(4000));
  const capa = (capaRows ?? []) as any[];
  const capOpen = capa.filter(c => !["completed", "verified", "closed"].includes(c.status));
  const actionPlan = {
    total: capa.length,
    completed: capa.filter(c => ["completed", "verified", "closed"].includes(c.status)).length,
    inProgress: capOpen.filter(c => c.status === "in_progress").length,
    overdue: capOpen.filter(c => c.due_date && c.due_date < today).length,
    notStarted: capOpen.filter(c => c.status === "open").length,
  };

  return {
    provisioned: true as const,
    kpis: { readiness, assessed, totalStandards, highGaps: notMet, mockCompleted, actionsInProgress: actionPlan.inProgress + actionPlan.notStarted, daysToNext },
    byDomain, topGaps, trend,
    statusDonut: [
      { label: "Compliant", value: met, tone: "emerald" },
      { label: "Minor gaps", value: partial, tone: "amber" },
      { label: "Major gaps", value: notMet, tone: "rose" },
      { label: "Not assessed", value: notAssessed, tone: "slate" },
    ],
    upcomingSurveys: upcomingSurveys.slice(0, 5).map(s => ({ title: s.title, type: s.survey_type, when: s.scheduled_date, status: s.status, framework: (fwById.get(s.framework_id) as any)?.code ?? "—" })),
    recentSurveys: surveys.slice(0, 6).map(s => ({ title: s.title, type: s.survey_type, status: s.status, outcome: s.outcome, when: s.scheduled_date })),
    actionPlan,
  };
}
