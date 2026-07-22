// Regulatory & Accreditation Center (GOV-001.6) loader — framework readiness
// computed from REAL self-assessments (gov_standard_assessments, migration 061,
// insert-only history → latest row wins per framework+reference), against the
// EQOS standards catalogue (quality_standards reference codes per framework).
// Readiness scoring: met = 1, partially_met = 0.5, not_met = 0 over assessed
// standards; coverage = assessed refs / known refs. Cross-module signals:
// the regulatory calendar reads gov_obligations (059) and indicator attainment
// compares latest indicator_measurements to their targets. Fail-soft with an
// honest banner until 061 runs; surveys/inspections have no store yet.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const DAY = 86400000;

export async function loadAccreditationCenter(admin: any) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const soonStr = new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);

  const [fwRows, stdRows, assessRows, oblRows, indRows, measRows, openCapa, surveyRows] = await Promise.all([
    admin.from("quality_frameworks").select("id, code, name, framework_type, is_active").limit(200),
    admin.from("quality_standards").select("framework_id, reference_code, title").limit(20000),
    admin.from("gov_standard_assessments").select("framework_id, reference_code, title, status, gap_note, evidence_note, owner_name, assessed_at").order("assessed_at", { ascending: false }).limit(5000),
    admin.from("gov_obligations").select("title, domain, expiry_date, status").in("domain", ["regulatory", "licence"]).not("expiry_date", "is", null).limit(500),
    admin.from("quality_indicators").select("id, name, target_value, direction, is_active").eq("is_active", true).not("target_value", "is", null).limit(1000),
    admin.from("indicator_measurements").select("indicator_id, value, period").order("period", { ascending: false }).limit(5000),
    admin.from("capa_actions").select("*", { count: "exact", head: true }).not("status", "in", "(completed,verified,closed)"),
    admin.from("gov_surveys").select("id, title, framework_id, survey_type, surveyor, scheduled_date, status, outcome, created_at").order("scheduled_date", { ascending: true, nullsFirst: false }).limit(500),
  ]);

  const frameworks = (fwRows.error ? [] : fwRows.data ?? []) as any[];
  const stds = (stdRows.error ? [] : stdRows.data ?? []) as any[];
  const ready = !assessRows.error;
  const assessments = (ready ? assessRows.data ?? [] : []) as any[];

  // Known reference codes per framework (EQOS catalogue).
  const knownByFw = new Map<string, Set<string>>();
  for (const s of stds) {
    if (!knownByFw.has(s.framework_id)) knownByFw.set(s.framework_id, new Set());
    knownByFw.get(s.framework_id)!.add(String(s.reference_code).toUpperCase());
  }

  // Latest assessment per framework+reference (rows arrive newest-first).
  const latest = new Map<string, any>();
  for (const a of assessments) {
    const key = `${a.framework_id}::${String(a.reference_code).toUpperCase()}`;
    if (!latest.has(key)) latest.set(key, a);
  }
  const latestList = [...latest.values()];

  const WEIGHT: Record<string, number> = { met: 1, partially_met: 0.5, not_met: 0 };
  const scoreOf = (rows: any[]) => {
    const scored = rows.filter(r => r.status !== "not_assessed");
    if (!scored.length) return null;
    return Math.round((scored.reduce((s, r) => s + (WEIGHT[r.status] ?? 0), 0) / scored.length) * 100);
  };

  // Per-framework readiness.
  const perFramework = frameworks.map(f => {
    const mine = latestList.filter(a => a.framework_id === f.id);
    const known = knownByFw.get(f.id) ?? new Set<string>();
    const assessedRefs = new Set(mine.map(a => String(a.reference_code).toUpperCase()));
    const universe = new Set([...known, ...assessedRefs]);
    return {
      id: f.id, code: f.code, name: f.name, type: f.framework_type,
      readiness: scoreOf(mine),
      assessed: assessedRefs.size, known: universe.size,
      met: mine.filter(a => a.status === "met").length,
      partially: mine.filter(a => a.status === "partially_met").length,
      notMet: mine.filter(a => a.status === "not_met").length,
    };
  }).sort((a, b) => (b.assessed - a.assessed));

  const met = latestList.filter(a => a.status === "met").length;
  const partially = latestList.filter(a => a.status === "partially_met").length;
  const notMet = latestList.filter(a => a.status === "not_met").length;
  const knownTotal = perFramework.reduce((s, f) => s + f.known, 0);
  const notAssessed = Math.max(0, knownTotal - latestList.filter(a => a.status !== "not_assessed").length);
  const evidenceGaps = latestList.filter(a => a.status !== "not_assessed" && a.status !== "met" && !a.evidence_note).length;
  const overall = scoreOf(latestList);

  // Recent assessments feed (raw history — shows re-assessment trail).
  const fwCode = new Map<string, string>(frameworks.map(f => [f.id, f.code]));
  const recent = assessments.slice(0, 8).map(a => ({
    fw: fwCode.get(a.framework_id) ?? "—", ref: a.reference_code, title: a.title,
    status: a.status, gap: a.gap_note, evidence: !!a.evidence_note, at: a.assessed_at,
  }));

  // Regulatory calendar from the obligations register (cross-module, fail-soft).
  const calendar = (oblRows.error ? [] : oblRows.data ?? [])
    .filter((o: any) => o.expiry_date)
    .sort((a: any, b: any) => String(a.expiry_date).localeCompare(String(b.expiry_date)))
    .slice(0, 6)
    .map((o: any) => ({ title: o.title, date: o.expiry_date, domain: o.domain, overdue: o.expiry_date < todayStr, dueSoon: o.expiry_date >= todayStr && o.expiry_date <= soonStr }));

  // Indicator attainment: latest measurement per indicator vs target.
  const inds = (indRows.error ? [] : indRows.data ?? []) as any[];
  const latestMeas = new Map<string, number>();
  for (const m of (measRows.error ? [] : measRows.data ?? []) as any[]) if (!latestMeas.has(m.indicator_id)) latestMeas.set(m.indicator_id, Number(m.value));
  let attained = 0, measured = 0;
  for (const ind of inds) {
    const v = latestMeas.get(ind.id);
    if (v == null) continue;
    measured++;
    const ok = ind.direction === "lower_is_better" ? v <= Number(ind.target_value) : v >= Number(ind.target_value);
    if (ok) attained++;
  }

  // ── Surveys & inspections (migration 062; fail-soft) ────────────────────────
  const surveysReady = !surveyRows.error;
  const surveys = (surveysReady ? surveyRows.data ?? [] : []) as any[];
  const activeSurveys = surveys.filter(s => !["completed", "cancelled"].includes(s.status));
  const upcomingSurveys = activeSurveys.slice(0, 5).map(s => ({
    id: s.id, title: s.title, type: s.survey_type, surveyor: s.surveyor,
    fw: fwCode.get(s.framework_id) ?? null, date: s.scheduled_date, status: s.status,
    dueSoon: !!(s.scheduled_date && s.scheduled_date >= todayStr && s.scheduled_date <= soonStr),
  }));
  const completedSurveys = surveys.filter(s => s.status === "completed");
  const surveyOutcomes = {
    passed: completedSurveys.filter(s => s.outcome === "passed").length,
    conditions: completedSurveys.filter(s => s.outcome === "passed_with_conditions").length,
    failed: completedSurveys.filter(s => s.outcome === "failed").length,
  };

  return {
    ready,
    surveysReady,
    surveys: { upcoming: upcomingSurveys, active: activeSurveys.length, completed: completedSurveys.length, outcomes: surveyOutcomes },
    kpis: {
      overall: ready ? overall : null,
      met: ready ? met : null,
      partially: ready ? partially : null,
      notMet: ready ? notMet : null,
      notAssessed: ready ? notAssessed : null,
      evidenceGaps: ready ? evidenceGaps : null,
    },
    perFramework,
    recent,
    calendar,
    indicators: { attained, measured, total: inds.length },
    openActions: num(openCapa),
    pickers: {
      frameworks: frameworks.map(f => ({ id: f.id, label: `${f.code} — ${f.name}` })),
      refsByFramework: Object.fromEntries([...knownByFw.entries()].map(([id, refs]) => [id, [...refs].sort().slice(0, 200)])),
      surveys: activeSurveys.slice(0, 200).map(s => ({ id: s.id, label: `${s.title} (${String(s.status).replace(/_/g, " ")})` })),
    },
    generatedAt: new Date().toISOString(),
  };
}
