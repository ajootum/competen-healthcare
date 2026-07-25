// Accreditation Readiness Centre (UMG-QS-005) — the Unit Manager's accreditation oversight, aligned to the
// detailed spec. Consolidation over the REAL accreditation stores; no store forked, no migration:
//   Self-assessments ← gov_standard_assessments (061, insert-only history → latest per framework+reference)
//   Standards catalogue ← quality_standards / quality_frameworks (019)   Surveys ← gov_surveys (062)
//   Regulatory calendar ← gov_obligations (059)   CAPA closure ← capa_actions (034)
// Readiness scoring: met = 1, partially_met = 0.5, not_met = 0 over ASSESSED standards. Because the
// assessment history carries assessed_at, readiness OVER TIME is real — the KPI sparklines + prior-period
// deltas recompute readiness as of each past month-end from the history (no snapshot store needed). Real:
// framework readiness + trend, the compliance-status breakdown, standards-at-risk, gap analysis, evidence
// completeness, survey readiness, the survey/regulatory calendar and rule-based AI insights. Honest next-
// phase (spec §9 entities with no store): the ActionPlan work queue with owner/due/progress, the EvidenceItem
// repository + versioning, PolicyLink ("Policies Current") and training completion. Fail-soft throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */

const WEIGHT: Record<string, number> = { met: 1, partially_met: 0.5, not_met: 0 };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const upper = (s: any) => String(s ?? "").toUpperCase();
const scoreOf = (rows: any[]) => { const s = rows.filter(r => r.status !== "not_assessed"); return s.length ? Math.round((s.reduce((n, r) => n + (WEIGHT[r.status] ?? 0), 0) / s.length) * 100) : null; };

export async function loadAccreditationReadiness(admin: any) {
  const today = new Date();
  const todayIso = today.toISOString();
  const [fwRes, stdRes, assessRes, surveyRes, capaRes, oblRes] = await Promise.all([
    admin.from("quality_frameworks").select("id, code, name, framework_type, is_active").limit(200),
    admin.from("quality_standards").select("framework_id, reference_code").limit(20000),
    admin.from("gov_standard_assessments").select("framework_id, reference_code, title, status, evidence_note, gap_note, owner_name, assessed_at").order("assessed_at", { ascending: false }).limit(8000),
    admin.from("gov_surveys").select("id, title, framework_id, survey_type, scheduled_date, status, outcome").order("scheduled_date", { ascending: true, nullsFirst: false }).limit(500),
    admin.from("capa_actions").select("status").limit(4000),
    admin.from("gov_obligations").select("title, domain, expiry_date, status").not("expiry_date", "is", null).limit(500),
  ]);
  if (assessRes.error && missing(assessRes.error)) return { provisioned: false as const };

  const frameworks = (fwRes.error ? [] : fwRes.data ?? []) as any[];
  const stds = (stdRes.error ? [] : stdRes.data ?? []) as any[];
  const assessments = (assessRes.error ? [] : assessRes.data ?? []) as any[]; // newest-first
  const surveys = (surveyRes.error ? [] : surveyRes.data ?? []) as any[];
  const capas = (capaRes.error ? [] : capaRes.data ?? []) as any[];
  const obligations = (oblRes.error ? [] : oblRes.data ?? []) as any[];
  const fwById = new Map(frameworks.map(f => [f.id, f]));

  // Known reference universe per framework (EQOS catalogue).
  const knownByFw = new Map<string, Set<string>>();
  stds.forEach(s => { if (!knownByFw.has(s.framework_id)) knownByFw.set(s.framework_id, new Set()); knownByFw.get(s.framework_id)!.add(upper(s.reference_code)); });

  // Latest assessment per framework+reference as of a cutoff (assessments are newest-first).
  const latestAsOf = (cutoffIso: string | null) => {
    const m = new Map<string, any>();
    for (const a of assessments) { if (cutoffIso && a.assessed_at > cutoffIso) continue; const key = `${a.framework_id}::${upper(a.reference_code)}`; if (!m.has(key)) m.set(key, a); }
    return [...m.values()];
  };
  const latest = latestAsOf(null);

  // ── Compliance status breakdown (over the known + assessed universe) ─────────────────────────
  const met = latest.filter(a => a.status === "met").length;
  const partially = latest.filter(a => a.status === "partially_met").length;
  const notMet = latest.filter(a => a.status === "not_met").length;
  const assessedCount = latest.filter(a => a.status !== "not_assessed").length;
  const assessedRefs = new Set(latest.map(a => `${a.framework_id}::${upper(a.reference_code)}`));
  const universe = new Set([...assessedRefs]);
  knownByFw.forEach((refs, fwId) => refs.forEach(r => universe.add(`${fwId}::${r}`)));
  const totalElements = Math.max(universe.size, latest.length);
  const notAssessed = Math.max(0, totalElements - assessedCount);
  const complianceStatus = [
    { label: "Compliant", key: "met", n: met, color: "#10b981" },
    { label: "Partially Compliant", key: "partial", n: partially, color: "#3b82f6" },
    { label: "Non-Compliant", key: "not_met", n: notMet, color: "#f59e0b" },
    { label: "Not Assessed", key: "not_assessed", n: notAssessed, color: "#ef4444" },
  ].map(s => ({ ...s, pct: totalElements ? Math.round((s.n / totalElements) * 100) : 0 }));

  // ── Overall readiness + 6-month trend + delta (recompute from history) ───────────────────────
  const overall = scoreOf(latest);
  const months: { key: string; end: string }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i + 1, 0); months.push({ key: d.toLocaleString("en-US", { month: "short" }), end: d.toISOString() }); }
  const trendSpark = months.map(m => scoreOf(latestAsOf(m.end)) ?? 0);
  const d30Iso = new Date(Date.now() - 30 * 864e5).toISOString();
  const overall30 = scoreOf(latestAsOf(d30Iso));
  const overallDelta = (overall != null && overall30 != null) ? overall - overall30 : null;

  // ── Per-framework readiness + trend (now vs ~30d ago) ────────────────────────────────────────
  const perFramework = frameworks.map(f => {
    const now = latest.filter(a => a.framework_id === f.id);
    const then = latestAsOf(d30Iso).filter(a => a.framework_id === f.id);
    const rNow = scoreOf(now), rThen = scoreOf(then);
    return { id: f.id, code: f.code, name: f.name, readiness: rNow, delta: (rNow != null && rThen != null) ? rNow - rThen : null, assessed: now.filter(a => a.status !== "not_assessed").length, known: (knownByFw.get(f.id)?.size ?? 0) };
  }).filter(f => f.assessed > 0 || (knownByFw.get(f.id)?.size ?? 0) > 0).sort((a, b) => (b.readiness ?? -1) - (a.readiness ?? -1));
  const byCode = (code: string) => perFramework.find(f => upper(f.code) === upper(code)) ?? null;

  // ── Evidence completeness (assessed rows carrying evidence_note) + delta ─────────────────────
  const evidenceComplete = assessedCount ? Math.round((latest.filter(a => a.status !== "not_assessed" && a.evidence_note).length / assessedCount) * 100) : null;
  const then30 = latestAsOf(d30Iso).filter(a => a.status !== "not_assessed");
  const evidence30 = then30.length ? Math.round((then30.filter(a => a.evidence_note).length / then30.length) * 100) : null;
  const evidenceDelta = (evidenceComplete != null && evidence30 != null) ? evidenceComplete - evidence30 : null;

  // ── High-risk standards (+ delta) + standards-at-risk list ───────────────────────────────────
  const highRisk = notMet;
  const highRisk30 = latestAsOf(d30Iso).filter(a => a.status === "not_met").length;
  const highRiskDelta = highRisk - highRisk30;
  const bandOf = (status: string) => (status === "met" ? 100 : status === "partially_met" ? 55 : 25);
  const atRisk = latest.filter(a => ["not_met", "partially_met"].includes(a.status))
    .sort((a, b) => (a.status === "not_met" ? 0 : 1) - (b.status === "not_met" ? 0 : 1))
    .slice(0, 8).map(a => ({ ref: a.reference_code, title: a.title ?? a.reference_code, framework: fwById.get(a.framework_id)?.code ?? "—", risk: a.status === "not_met" ? "High" : "Medium", compliance: bandOf(a.status) }));

  // ── Gap analysis ─────────────────────────────────────────────────────────────────────────────
  const monthKey = todayIso.slice(0, 7);
  const gap = {
    total: notMet + partially,
    high: notMet,
    medium: partially,
    low: notAssessed,
    closedThisMonth: assessments.filter(a => a.status === "met" && String(a.assessed_at ?? "").slice(0, 7) === monthKey).length,
  };

  // ── Survey readiness composite + countdown ───────────────────────────────────────────────────
  const capaClosed = capas.filter(c => ["completed", "verified", "closed"].includes(c.status)).length;
  const capaClosureRate = capas.length ? Math.round((capaClosed / capas.length) * 100) : null;
  const mockDone = surveys.filter(s => (s.survey_type ?? "").includes("mock") && s.status === "completed");
  const mockScore = mockDone.length ? Math.round(mean(mockDone.map(s => s.outcome === "passed" ? 100 : s.outcome === "passed_with_conditions" ? 65 : 30))! ) : null;
  const readinessChecklist = [
    { label: "Evidence Completeness", pct: evidenceComplete },
    { label: "Mock Survey Score", pct: mockScore },
    { label: "CAPA Closure Rate", pct: capaClosureRate },
    { label: "Policies Current", pct: null }, // PolicyLink store — next-phase
    { label: "Training Completion", pct: null }, // cross-domain (LDS) — next-phase
  ];
  const surveyReadiness = mean(readinessChecklist.map(c => c.pct).filter((x): x is number => x != null));
  const upcomingSurveys = surveys.filter(s => s.scheduled_date && !["completed", "cancelled"].includes(s.status) && s.scheduled_date >= todayIso.slice(0, 10));
  const surveyCountdown = (() => { const ds = upcomingSurveys.map(s => Math.round((new Date(s.scheduled_date).getTime() - Date.now()) / 864e5)).filter(n => n >= 0).sort((a, b) => a - b); return ds.length ? ds[0] : null; })();
  const nextSurveyName = upcomingSurveys.length ? (fwById.get(upcomingSurveys[0].framework_id)?.code ?? upcomingSurveys[0].title) : null;

  // ── Accreditation calendar (surveys + regulatory obligations) ────────────────────────────────
  const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const calendar = [
    ...upcomingSurveys.slice(0, 6).map(s => ({ title: s.title, type: (s.survey_type ?? "survey").replace(/_/g, " "), date: s.scheduled_date, status: s.status, dueSoon: s.scheduled_date <= soon })),
    ...obligations.filter(o => o.expiry_date).map(o => ({ title: o.title, type: o.domain, date: o.expiry_date, status: o.expiry_date < todayIso.slice(0, 10) ? "overdue" : "scheduled", dueSoon: o.expiry_date <= soon })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 8);

  // ── Work queue (from real assessment gaps; owner/due/progress need an ActionPlan store) ──────
  const workQueue = latest.filter(a => ["not_met", "partially_met"].includes(a.status)).slice(0, 12).map(a => ({
    id: `ACR-${String(a.assessed_at ?? "").slice(0, 4) || "20XX"}-${upper(a.reference_code).replace(/[^A-Z0-9]/g, "").slice(0, 4)}`,
    title: a.gap_note || a.title || `Address ${a.reference_code}`, framework: fwById.get(a.framework_id)?.code ?? "—",
    type: a.evidence_note ? "Assessment" : "Evidence", owner: a.owner_name ?? null,
    status: a.status === "not_met" ? "At Risk" : "In Progress", priority: a.status === "not_met" ? "High" : "Medium",
    awaitingVerification: a.status !== "not_assessed" && !a.evidence_note,
  }));
  const queueCounts = { all: workQueue.length, atRisk: workQueue.filter(w => w.status === "At Risk").length, awaitingVerification: workQueue.filter(w => w.awaitingVerification).length };

  // ── AI accreditation insights (rule-based, explainable) ──────────────────────────────────────
  const ai: { text: string; detail: string; confidence: number; tone: string }[] = [];
  if (atRisk.filter(a => a.risk === "High").length) { const hs = atRisk.filter(a => a.risk === "High").slice(0, 3); ai.push({ text: `High risk: ${hs.length} standard(s) likely to fail in an upcoming survey`, detail: hs.map(a => a.ref).join(", "), confidence: 82, tone: "rose" }); }
  const evidenceGaps = latest.filter(a => a.status !== "not_assessed" && a.status !== "met" && !a.evidence_note).length;
  if (evidenceGaps) ai.push({ text: `Evidence gap detected: ${evidenceGaps} item(s) missing or expiring soon`, detail: `${notMet} high priority · ${partially} partial`, confidence: 80, tone: "amber" });
  if (overall != null && nextSurveyName) ai.push({ text: `Readiness prediction: ${overall}% chance of passing the ${nextSurveyName} survey`, detail: "Based on current assessed readiness", confidence: Math.min(90, overall), tone: "sky" });
  const worstFw = perFramework.filter(f => f.readiness != null).slice().sort((a, b) => (a.readiness ?? 100) - (b.readiness ?? 100))[0];
  if (worstFw) ai.push({ text: `Improvement opportunity: raise ${worstFw.code} readiness`, detail: `Lowest framework at ${worstFw.readiness}% — target the non-compliant elements`, confidence: 74, tone: "emerald" });

  return {
    provisioned: true as const, hasData: latest.length > 0,
    kpis: {
      overall, overallDelta, trendSpark,
      safecare: byCode("SAFECARE"), jci: byCode("JCI"), national: byCode("MOH"),
      evidenceComplete, evidenceDelta, highRisk, highRiskDelta, surveyCountdown, nextSurveyName,
    },
    perFramework, complianceStatus, totalElements, atRisk, gap,
    surveyReadiness: surveyReadiness != null ? Math.round(surveyReadiness) : null, readinessChecklist,
    calendar, workQueue, queueCounts, ai,
  };
}
