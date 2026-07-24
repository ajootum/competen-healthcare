// Competency Operations Dashboard (CMO-001) — the operational command centre for competency
// readiness. Composes the enterprise governance KPIs (loadCompetencyOfficeDashboard) with the live
// competency-decision spine (competency_decisions — the governed validation object) to drive the 12
// CMO widgets: organisation readiness, high-risk units, expiring competencies (30/60/90), expiring
// individuals, workforce readiness by CPU, competency risk alerts, domain readiness, evidence/validation
// queue, assessments today, activity feed and rule-based AI recommendations. Everything is tenant-scoped
// and fail-soft; widgets whose store isn't provisioned degrade to an honest state, never fabricated.
// Readiness TRENDS need a readiness_snapshots history the platform doesn't retain yet — honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCompetencyOfficeDashboard } from "@/lib/competency-office-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export async function loadCmoDashboard(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const office = await loadCompetencyOfficeDashboard(admin, hid, isSuper);

  const T = today(), d30 = plusDays(30), d60 = plusDays(60), d90 = plusDays(90);

  // ── Competency-decision spine (latest per nurse:competency) ──────────────────────────────────
  let decisionsReady = true;
  let latest: any[] = [];
  try {
    const { data: decs, error } = await scope(admin.from("competency_decisions")
      .select("nurse_id, competency_id, cpu_id, framework_id, outcome, maturity, expiry_date, critical_failure, validation_outcome, validated_at, created_at")
      .order("created_at", { ascending: false }).limit(20000));
    if (error) throw error;
    const seen = new Set<string>();
    for (const d of decs ?? []) { const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k); latest.push(d); }
  } catch { decisionsReady = false; latest = []; }

  const isCurrent = (d: any) => PASSING.includes(d.outcome) && (!d.expiry_date || d.expiry_date >= T);
  const readiness = {
    score: office.compliance.coverage,
    current: office.compliance.current,
    total: office.compliance.total,
  };
  // Compliance Score (CMO-001 KPI) — distinct from readiness: % of governed competencies that are
  // both VALIDATED and current (mandatory-compliance proxy). Real, and genuinely ≤ readiness.
  const validatedCurrent = latest.filter(d => d.validated_at && isCurrent(d)).length;
  const complianceScore = latest.length ? Math.round((validatedCurrent / latest.length) * 100) : 0;
  const daysTo = (dateStr: string) => Math.round((new Date(dateStr).getTime() - Date.now()) / 86400000);

  // Expiring competencies — currently valid but expiring within 30/60/90 days.
  const expiringIn = (from: string, to: string) => latest.filter(d => PASSING.includes(d.outcome) && d.expiry_date && d.expiry_date >= from && d.expiry_date < to);
  const exp30 = expiringIn(T, d30), exp60 = expiringIn(d30, d60), exp90 = expiringIn(d60, d90);
  const expiringIndividuals = new Set([...exp30, ...exp60, ...exp90].map(d => d.nurse_id)).size;
  const expiring = { d30: exp30.length, d60: exp60.length, d90: exp90.length, individuals: expiringIndividuals };

  // Validation / evidence awaiting review — decisions not yet validated.
  const awaitingValidation = latest.filter(d => !d.validated_at && (d.validation_outcome == null || d.validation_outcome === "returned" || d.validation_outcome === "deferred")).length;

  // ── Workforce readiness by CPU (required vs available → coverage per unit) ────────────────────
  const cpuIds = [...new Set(latest.map(d => d.cpu_id).filter(Boolean))];
  const cpuNames = new Map<string, string>();
  if (cpuIds.length) {
    try {
      const { data: cpus } = await admin.from("clinical_practice_units").select("practice_id, name").in("practice_id", cpuIds).limit(2000);
      (cpus ?? []).forEach((c: any) => cpuNames.set(c.practice_id, c.name));
    } catch { /* fail-soft */ }
  }
  const byCpu = new Map<string, { total: number; current: number }>();
  latest.forEach(d => { if (!d.cpu_id) return; const g = byCpu.get(d.cpu_id) ?? { total: 0, current: 0 }; g.total++; if (isCurrent(d)) g.current++; byCpu.set(d.cpu_id, g); });
  const workforceByCpu = [...byCpu.entries()].map(([id, g]) => ({ id, name: cpuNames.get(id) ?? "Unnamed CPU", total: g.total, current: g.current, pct: g.total ? Math.round((g.current / g.total) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct);
  const HIGH_RISK = 70;
  const highRiskUnits = workforceByCpu.filter(u => u.pct < HIGH_RISK);

  // ── Domain readiness (decisions → competency → domain) ───────────────────────────────────────
  let domains: { name: string; total: number; current: number; pct: number }[] = [];
  const compIds = [...new Set(latest.map(d => d.competency_id).filter(Boolean))];
  if (compIds.length) {
    try {
      const { data: comps } = await admin.from("framework_competencies").select("id, domain_id").in("id", compIds).limit(20000);
      const compDomain = new Map<string, string>((comps ?? []).map((c: any) => [c.id, c.domain_id]));
      const domIds = [...new Set([...compDomain.values()].filter(Boolean))];
      const domName = new Map<string, string>();
      if (domIds.length) { const { data: doms } = await admin.from("framework_domains").select("id, name").in("id", domIds).limit(5000); (doms ?? []).forEach((d: any) => domName.set(d.id, d.name)); }
      const byDom = new Map<string, { total: number; current: number }>();
      latest.forEach(d => { const dom = compDomain.get(d.competency_id); if (!dom) return; const g = byDom.get(dom) ?? { total: 0, current: 0 }; g.total++; if (isCurrent(d)) g.current++; byDom.set(dom, g); });
      domains = [...byDom.entries()].map(([id, g]) => ({ name: domName.get(id) ?? "Domain", total: g.total, current: g.current, pct: g.total ? Math.round((g.current / g.total) * 100) : 0 })).sort((a, b) => a.pct - b.pct);
    } catch { /* fail-soft */ }
  }

  // ── Assessments today (scoped via the hospital's cycles) ─────────────────────────────────────
  const assessments = { provisioned: true, scheduled: 0, inProgress: 0, completed: 0, total: 0 };
  try {
    const { data: cycles } = await scope(admin.from("competency_cycles").select("id").limit(2000));
    const cycleIds = (cycles ?? []).map((c: any) => c.id);
    const q = isSuper ? admin.from("assessments").select("status, created_at").limit(5000)
      : (cycleIds.length ? admin.from("assessments").select("status, created_at").in("cycle_id", cycleIds).limit(5000) : null);
    if (q) {
      const { data: asmts, error } = await q;
      if (error) throw error;
      const todayRows = (asmts ?? []).filter((a: any) => (a.created_at ?? "").slice(0, 10) === T);
      assessments.total = todayRows.length;
      assessments.scheduled = todayRows.filter((a: any) => ["scheduled", "planned", "pending"].includes(a.status)).length;
      assessments.inProgress = todayRows.filter((a: any) => ["in_progress", "started"].includes(a.status)).length;
      assessments.completed = todayRows.filter((a: any) => ["completed", "validated", "passed", "failed"].includes(a.status)).length;
    }
  } catch { assessments.provisioned = false; }

  // ── Activity feed (audit_log competency events) ──────────────────────────────────────────────
  let activity: any[] = [];
  try {
    const { data: au } = await scope(admin.from("audit_log").select("id, action, entity_type, created_at, actor:profiles!actor_id(full_name)").order("created_at", { ascending: false }).limit(60));
    activity = (au ?? []).filter((a: any) => /competenc|assess|evidence|validat|passport|credential|decision/i.test(a.action ?? "")).slice(0, 12);
  } catch { /* fail-soft */ }

  // ── Named enrichment for the operational widgets (people + competency names) ─────────────────
  const expiringSorted = [...exp30, ...exp60].sort((a, b) => (a.expiry_date ?? "").localeCompare(b.expiry_date ?? "")).slice(0, 6);
  const valAwaiting = latest.filter(d => !d.validated_at && (d.validation_outcome == null || d.validation_outcome === "returned" || d.validation_outcome === "deferred")).slice(0, 6);
  const needNurse = [...new Set([...expiringSorted, ...valAwaiting].map(d => d.nurse_id).filter(Boolean))];
  const needComp = [...new Set([...expiringSorted, ...valAwaiting].map(d => d.competency_id).filter(Boolean))];
  const nurseInfo = new Map<string, { name: string; role: string }>();
  const compName = new Map<string, string>();
  if (needNurse.length) { try { const { data } = await admin.from("profiles").select("id, full_name, role").in("id", needNurse).limit(2000); (data ?? []).forEach((p: any) => nurseInfo.set(p.id, { name: p.full_name ?? "—", role: (p.role ?? "").replace(/_/g, " ") })); } catch { /* fail-soft */ } }
  if (needComp.length) { try { const { data } = await admin.from("framework_competencies").select("id, name").in("id", needComp).limit(5000); (data ?? []).forEach((c: any) => compName.set(c.id, c.name)); } catch { /* fail-soft */ } }
  const expiringPeople = expiringSorted.map(d => ({ name: nurseInfo.get(d.nurse_id)?.name ?? "—", role: nurseInfo.get(d.nurse_id)?.role ?? "", competency: compName.get(d.competency_id) ?? "Competency", days: d.expiry_date ? daysTo(d.expiry_date) : null }));
  const validationList = valAwaiting.map(d => ({ nurse: nurseInfo.get(d.nurse_id)?.name ?? "—", competency: compName.get(d.competency_id) ?? "Competency", status: d.validation_outcome === "returned" || d.validation_outcome === "deferred" ? "review" : "pending" }));

  // ── Assessment activity feed (recent) + recent-updates counts ────────────────────────────────
  let assessmentActivity: any[] = [];
  try {
    const { data: cycles } = await scope(admin.from("competency_cycles").select("id").limit(2000));
    const cycleIds = (cycles ?? []).map((c: any) => c.id);
    const q = isSuper ? admin.from("assessments").select("method, status, created_at").order("created_at", { ascending: false }).limit(8)
      : (cycleIds.length ? admin.from("assessments").select("method, status, created_at").in("cycle_id", cycleIds).order("created_at", { ascending: false }).limit(8) : null);
    if (q) { const { data } = await q; assessmentActivity = (data ?? []).map((a: any) => ({ method: (a.method ?? "assessment").replace(/_/g, " "), status: a.status, at: a.created_at })); }
  } catch { /* fail-soft */ }

  // Recent updates — counts of recent competency events by type (audit_log). Honest "recent", best-effort.
  const recentUpdates = { evidence: 0, assessments: 0, competencies: 0, frameworks: 0 };
  try {
    const { data: au } = await scope(admin.from("audit_log").select("action").order("created_at", { ascending: false }).limit(200));
    (au ?? []).forEach((a: any) => { const act = a.action ?? ""; if (/evidence/i.test(act)) recentUpdates.evidence++; else if (/assess/i.test(act)) recentUpdates.assessments++; else if (/competenc|validat|decision/i.test(act)) recentUpdates.competencies++; else if (/framework/i.test(act)) recentUpdates.frameworks++; });
  } catch { /* fail-soft */ }

  // ── Competency risk alerts (from live state) ─────────────────────────────────────────────────
  const criticalFailures = latest.filter(d => d.critical_failure).length;
  const expiredMandatory = latest.filter(d => d.expiry_date && d.expiry_date < T && PASSING.includes(d.outcome)).length;
  const risks: { label: string; detail: string; severity: "high" | "medium" }[] = [];
  if (criticalFailures) risks.push({ label: `${criticalFailures} critical failure${criticalFailures === 1 ? "" : "s"}`, detail: "Require re-assessment and validation", severity: "high" });
  if (expiredMandatory) risks.push({ label: `${expiredMandatory} expired competenc${expiredMandatory === 1 ? "y" : "ies"}`, detail: "Reduces unit readiness until renewed", severity: "high" });
  highRiskUnits.slice(0, 3).forEach(u => risks.push({ label: `${u.name} readiness ${u.pct}%`, detail: `${u.current}/${u.total} current — below ${HIGH_RISK}% threshold`, severity: "medium" }));
  if (exp30.length) risks.push({ label: `${exp30.length} competenc${exp30.length === 1 ? "y" : "ies"} expiring ≤30 days`, detail: `${new Set(exp30.map(d => d.nurse_id)).size} staff affected`, severity: "medium" });

  // ── Rule-based AI recommendations + insights (explainable, from live state) ──────────────────
  const ai: { text: string; action: string; priority: "high" | "medium" | "low"; why: string }[] = [];
  if (criticalFailures) ai.push({ text: `Prioritise re-assessment for ${criticalFailures} critical failure(s)`, action: "Schedule assessment", priority: "high", why: "Critical failures block safe deployment" });
  highRiskUnits.slice(0, 2).forEach(u => ai.push({ text: `Assign targeted learning to ${u.name} (${u.pct}% ready)`, action: "Assign learning", priority: "high", why: `Below ${HIGH_RISK}% readiness threshold` }));
  if (exp30.length) ai.push({ text: `Open a reassessment cycle for ${exp30.length} competenc${exp30.length === 1 ? "y" : "ies"} expiring within 30 days`, action: "Open cycle", priority: "medium", why: "Prevents readiness drop from lapses" });
  if (awaitingValidation) ai.push({ text: `Clear the validation queue — ${awaitingValidation} decision(s) awaiting review`, action: "Validate", priority: "medium", why: "Readiness recalculates on validation" });
  if (domains.length && domains[0].pct < 75) ai.push({ text: `Focus development on ${domains[0].name} (${domains[0].pct}% readiness — lowest domain)`, action: "Review domain", priority: "low", why: "Lowest-readiness competency domain" });

  return {
    ready: decisionsReady || office.compliance.total > 0,
    decisionsReady,
    header: {
      frameworks: office.frameworks.total, competencies: office.competencyCount, cpus: office.cpus.total,
      compliance: office.compliance.coverage, activeCycles: office.activeCycles, pendingApprovals: office.pendingApprovals,
    },
    readiness, complianceScore, expiring, awaitingValidation, workforceByCpu, highRiskUnits, domains, assessments, activity, risks, ai,
    expiringPeople, validationList, assessmentActivity, recentUpdates,
    highRiskThreshold: HIGH_RISK,
  };
}
