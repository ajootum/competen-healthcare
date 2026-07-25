// Mortality & Morbidity Centre (UMG-QS-009) — the Unit Manager's lens over the M&M case register (mm_cases +
// mm_contributory_factors + mm_period_stats, migration 100). Real: the KPI ribbon (mortality/morbidity RATE per
// 1000 discharges with MoM deltas, deaths, serious morbidity, pending reviews, RCA/CAPA completion, preventable
// deaths, composite AI risk index), the case-mix overview, a 6-month rate trend, case-status summary, top causes
// of death, recent registers, preventability distribution, top contributory factors, RCA gauge, benchmarking
// (your unit real; peer/hospital/national are reference — external feed next-phase) and derived alerts + AI
// insights. Fail-soft + provisioned-aware. Hospital-scoped. No PHI.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const ym = (d: string) => String(d ?? "").slice(0, 7);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const REVIEW_OPEN = ["new", "initial_review", "rca_in_progress", "peer_review", "pending_capa"];

export async function loadMortalityMorbidity(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const psRes = await scope(admin.from("mm_period_stats").select("period, discharges")).order("period", { ascending: true });
  if (psRes.error && missing(psRes.error)) return { provisioned: false as const };
  const stats = (psRes.error ? [] : psRes.data ?? []) as any[];

  const cRes = await scope(admin.from("mm_cases").select("id, case_ref, case_type, patient_ref, patient_age, patient_sex, unit, event_date, primary_diagnosis, event_type, severity, cause_of_death, cause_category, status, preventability, rca_required, rca_status, capa_required, capa_status, review_meeting_date")).limit(20000);
  const cases = (cRes.error ? [] : cRes.data ?? []) as any[];
  if (!cases.length) return { provisioned: true as const, hasData: false };

  // Periods (last 6) + discharge denominator per period.
  const periods = (stats.length ? stats.map(s => s.period) : [...new Set(cases.map(c => ym(c.event_date) + "-01"))].sort()).slice(-6);
  const dischargeBy = new Map(stats.map(s => [ym(s.period), Number(s.discharges)]));
  const curP = periods[periods.length - 1], prevP = periods[periods.length - 2];
  const inMonth = (c: any, p: string) => ym(c.event_date) === ym(p);
  const cur = cases.filter(c => inMonth(c, curP));
  const prev = prevP ? cases.filter(c => inMonth(c, prevP)) : [];

  const deaths = (list: any[]) => list.filter(c => c.case_type === "mortality");
  const morb = (list: any[]) => list.filter(c => c.case_type === "morbidity");
  const rate = (list: any[], type: "mortality" | "morbidity", p: string) => { const disc = dischargeBy.get(ym(p)) || 0; const n = list.filter(c => c.case_type === type).length; return disc ? Math.round((n / disc) * 1000 * 10) / 10 : 0; };

  const curDeaths = deaths(cur), curMorb = morb(cur);
  const seriousNow = curMorb.filter(c => c.severity === "serious").length;
  const preventableNow = curDeaths.filter(c => ["definitely", "probably"].includes(c.preventability)).length;
  const reviewedDeaths = curDeaths.filter(c => c.preventability);
  const rcaReq = cur.filter(c => c.rca_required), rcaDone = rcaReq.filter(c => c.rca_status === "complete");
  const capaReq = cur.filter(c => c.capa_required), capaDone = capaReq.filter(c => c.capa_status === "complete");
  const pending = cur.filter(c => REVIEW_OPEN.includes(c.status));

  // Composite AI risk index (0–1) from preventable-death ratio, open-review load and serious-morbidity share.
  const preventableRatio = curDeaths.length ? preventableNow / curDeaths.length : 0;
  const openRatio = cur.length ? pending.length / cur.length : 0;
  const seriousRatio = curMorb.length ? seriousNow / curMorb.length : 0;
  const aiRisk = Math.min(1, Math.round((preventableRatio * 0.55 + openRatio * 0.3 + seriousRatio * 0.25) * 100) / 100);

  const mRate = rate(cur, "mortality", curP), mRatePrev = prev.length ? rate(prev, "mortality", prevP) : null;
  const bRate = rate(cur, "morbidity", curP), bRatePrev = prev.length ? rate(prev, "morbidity", prevP) : null;

  const kpis = {
    mortalityRate: mRate, mortalityDelta: mRatePrev != null ? Math.round((mRate - mRatePrev) * 10) / 10 : null,
    morbidityRate: bRate, morbidityDelta: bRatePrev != null ? Math.round((bRate - bRatePrev) * 10) / 10 : null,
    deaths: curDeaths.length, deathsDelta: prev.length ? curDeaths.length - deaths(prev).length : null,
    seriousMorbidity: seriousNow, seriousDelta: prev.length ? seriousNow - morb(prev).filter(c => c.severity === "serious").length : null,
    pendingReviews: pending.length, pendingMortality: pending.filter(c => c.case_type === "mortality").length, pendingMorbidity: pending.filter(c => c.case_type === "morbidity").length,
    rcaCompletion: pct(rcaDone.length, rcaReq.length), capaCompletion: pct(capaDone.length, capaReq.length),
    preventableDeaths: preventableNow, preventablePct: pct(preventableNow, curDeaths.length),
    aiRisk,
    totalCases: cur.length,
  };

  // Overview (case mix) + case-status summary.
  const st = (s: string, list = cur) => list.filter(c => c.status === s).length;
  const overview = { total: cur.length, deaths: curDeaths.length, seriousMorbidity: seriousNow, underReview: cur.filter(c => ["initial_review", "rca_in_progress", "peer_review"].includes(c.status)).length, completed: cur.filter(c => c.status === "closed" || c.rca_status === "complete").length, closed: st("closed") };
  const caseStatus = [
    { label: "New Cases", n: st("new") }, { label: "Under Initial Review", n: st("initial_review") }, { label: "RCA in Progress", n: st("rca_in_progress") },
    { label: "Pending Peer Review", n: st("peer_review") }, { label: "Pending CAPA", n: st("pending_capa") }, { label: "Closed", n: st("closed") },
  ];

  // Trend over 6 periods.
  const trend = { periods, mortality: periods.map(p => rate(cases.filter(c => inMonth(c, p)), "mortality", p)), morbidity: periods.map(p => rate(cases.filter(c => inMonth(c, p)), "morbidity", p)), preventable: periods.map(p => { const dd = deaths(cases.filter(c => inMonth(c, p))); const disc = dischargeBy.get(ym(p)) || 0; const pv = dd.filter(c => ["definitely", "probably"].includes(c.preventability)).length; return disc ? Math.round((pv / disc) * 1000 * 100) / 100 : 0; }) };

  // Top causes of death (this month).
  const causeLabel: Record<string, string> = { sepsis: "Sepsis / Septic Shock", neurological: "Neurological Injury", cardiorespiratory: "Cardiorespiratory Failure", postoperative: "Post-operative Complications", haemorrhage: "Haemorrhage", other: "Other" };
  const causeMap = new Map<string, number>();
  curDeaths.forEach(c => { const cat = c.cause_category ?? "other"; causeMap.set(cat, (causeMap.get(cat) ?? 0) + 1); });
  const topCauses = [...causeMap.entries()].map(([cat, n]) => ({ label: causeLabel[cat] ?? cat, n, pct: pct(n, curDeaths.length) })).sort((a, b) => b.n - a.n).slice(0, 5);

  // Registers (latest first).
  const byDate = (a: any, b: any) => (a.event_date < b.event_date ? 1 : -1);
  const recentMortality = [...curDeaths].sort(byDate).slice(0, 5).map(c => ({ ref: c.case_ref, patient: `${c.patient_ref} (${c.patient_sex}/${c.patient_age})`, unit: c.unit, date: c.event_date, diagnosis: c.primary_diagnosis, status: c.status }));
  const recentMorbidity = [...curMorb].sort(byDate).slice(0, 5).map(c => ({ ref: c.case_ref, event: c.event_type, unit: c.unit, date: c.event_date, status: c.status }));

  // Preventability distribution (reviewed deaths).
  const prevLabel: Record<string, string> = { definitely: "Definitely Preventable", probably: "Probably Preventable", possibly: "Possibly Preventable", probably_not: "Probably Not Preventable", not: "Not Preventable", insufficient: "Insufficient Info" };
  const prevMap = new Map<string, number>();
  reviewedDeaths.forEach(c => prevMap.set(c.preventability, (prevMap.get(c.preventability) ?? 0) + 1));
  const preventability = { reviewed: reviewedDeaths.length, breakdown: Object.keys(prevLabel).map(kk => ({ key: kk, label: prevLabel[kk], n: prevMap.get(kk) ?? 0, pct: pct(prevMap.get(kk) ?? 0, reviewedDeaths.length) })).filter(x => x.n > 0) };

  // Contributory factors (this month).
  let contributoryFactors: { label: string; n: number; pct: number }[] = [];
  try {
    const curIds = cur.map(c => c.id);
    if (curIds.length) {
      const { data: fac } = await admin.from("mm_contributory_factors").select("factor").in("case_id", curIds).limit(20000);
      const facLabel: Record<string, string> = { infection_sepsis: "Infection / Sepsis", delay_diagnosis: "Delay in Diagnosis", clinical_decision: "Clinical Decision Making", communication: "Communication", resource_equipment: "Resource / Equipment", documentation: "Documentation", medication: "Medication", monitoring: "Monitoring" };
      const fm = new Map<string, number>(); (fac ?? []).forEach((f: any) => fm.set(f.factor, (fm.get(f.factor) ?? 0) + 1));
      const tot = (fac ?? []).length;
      contributoryFactors = [...fm.entries()].map(([f, n]) => ({ label: facLabel[f] ?? f, n, pct: pct(n, tot) })).sort((a, b) => b.n - a.n).slice(0, 6);
    }
  } catch { /* fail-soft */ }

  // Benchmarking — your unit real; peer/hospital/national are reference values (external feed next-phase).
  const benchmarking = { yourUnit: mRate, peerAvg: 3.2, hospitalAvg: 2.8, nationalAvg: 4.1 };

  // Alerts (derived) + rule-based AI insights.
  const alerts: any[] = [];
  if (curDeaths.length) alerts.push({ text: `New death registered in ${curDeaths[0].unit}`, sev: "New", ref: curDeaths.sort(byDate)[0].case_ref });
  const overdueRca = cur.find(c => c.rca_status === "in_progress" && c.case_type === "mortality");
  if (overdueRca) alerts.push({ text: `RCA outstanding for Case ${overdueRca.case_ref}`, sev: "Overdue", ref: overdueRca.case_ref });
  if (kpis.preventablePct >= 20) alerts.push({ text: `Preventable death rate above threshold (${kpis.preventablePct}%)`, sev: "Critical" });
  if (cur.some(c => c.review_meeting_date)) alerts.push({ text: "M&M review meeting scheduled", sev: "Info" });
  if (capaReq.length > capaDone.length) alerts.push({ text: `${capaReq.length - capaDone.length} CAPA action(s) outstanding`, sev: "Warning" });

  const aiInsights = [
    ...(topCauses[0]?.label.includes("Sepsis") ? [{ text: `Sepsis is the leading cause of death this month (${topCauses[0].n} of ${curDeaths.length}) — review early-recognition pathways.`, conf: 86, tone: "red" }] : []),
    ...(kpis.mortalityDelta != null && kpis.mortalityDelta > 0 ? [{ text: `Mortality rate rose ${kpis.mortalityDelta}/1000 vs last month — monitor closely.`, conf: 78, tone: "amber" }] : (kpis.mortalityDelta != null ? [{ text: `Mortality rate improved ${Math.abs(kpis.mortalityDelta)}/1000 vs last month.`, conf: 80, tone: "low" }] : [])),
    ...(seriousNow > 0 ? [{ text: `${seriousNow} serious morbidity events this month — ${contributoryFactors[0]?.label ?? "contributory factors"} is the top factor.`, conf: 74, tone: "amber" }] : []),
    ...(kpis.rcaCompletion < 90 ? [{ text: `RCA completion is ${kpis.rcaCompletion}% — ${rcaReq.length - rcaDone.length} review(s) still open.`, conf: 72, tone: "low" }] : []),
  ].slice(0, 4);

  return { provisioned: true as const, hasData: true, kpis, overview, caseStatus, trend, topCauses, recentMortality, recentMorbidity, preventability, contributoryFactors, benchmarking, alerts, aiInsights };
}
