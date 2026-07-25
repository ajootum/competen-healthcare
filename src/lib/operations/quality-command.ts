// Quality & Safety Command Centre (UMG-QS-001) — the Unit Manager's executive quality dashboard. Per the
// spec §4 / §19 Data Source Register this is a CONSOLIDATION surface over the platform's existing quality /
// safety stores — it composes, it does not fork source records:
//   Incidents         ← op_incidents (073)              Audits + findings ← audits/audit_findings (034)
//   CAPA / RCA / QI    ← op_quality_actions (073)         Risk register     ← gov_risks + gov_controls (060)
//   Accreditation      ← gov_standard_assessments (061) via loadAccreditationCenter + audit-derived readiness
//   Clinical indicators← quality_indicators (019) via loadClinicalIndicators
// The ONE store it owns is the immutable quality-score snapshot history (quality_score_snapshots, migration
// 091, sanctioned by §26/§33): it upserts today's composite health score + KPIs per hospital per day and
// reads the history to draw the KPI sparklines, the prior-period deltas and the 12-month quality trend.
// Real: the Quality Health Summary (§6 weighted composite), the executive KPI ribbon with sub-metrics, the
// Priority Action Queue (§8), incident trend, audit compliance, CAPA pipeline, patient-safety breakdown, the
// residual 5×5 risk heat map + top risks, accreditation framework cards, alerts and rule-based AI insights.
// Honest: sparklines/deltas/12-month trend are empty until snapshots accrue; the 8-stage CAPA lifecycle and
// write quick-actions belong to the source modules (§21). Fail-soft + provisioned-aware throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadQualityDashboard } from "@/lib/quality-accreditation-data";
import { loadClinicalIndicators } from "@/lib/operations/clinical-indicators";
import { loadAccreditationCenter } from "@/lib/super-admin/gov-accreditation";
import { band as riskBand } from "@/lib/super-admin/gov-risk";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));

const INC_TYPE_LABEL: Record<string, string> = { medication: "Medication", falls: "Falls", equipment: "Equipment", pressure_injury: "Pressure Injury", infection: "Infection / HAI", behaviour: "Behaviour", documentation: "Documentation", sentinel: "Sentinel", other: "Other" };
const INC_TYPES = ["medication", "falls", "equipment", "pressure_injury", "infection", "behaviour", "documentation", "sentinel", "other"];
const SEV_BAND: Record<string, string> = { critical: "critical", high: "major", medium: "moderate", low: "minor" };
const BANDS = ["critical", "major", "moderate", "minor", "nearMiss"] as const;
// §6 Quality Health Summary dimension weights (re-normalised over the provisioned dimensions).
const HEALTH_BAND = (s: number) => (s >= 90 ? "Performing well" : s >= 80 ? "Stable with concerns" : s >= 70 ? "Improvement required" : s >= 60 ? "High management attention" : "Critical intervention required");

export async function loadQualityCommand(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const nowIso = new Date().toISOString(), T = nowIso.slice(0, 10);
  const monthStart = T.slice(0, 8) + "01";

  const riskSel = admin.from("gov_risks").select("id, title, category, likelihood, impact, residual_likelihood, residual_impact, status, owner_name, review_date").neq("status", "closed");
  const ctrlSel = admin.from("gov_controls").select("id, effectiveness, risk_id");
  const [qd, incRes, qaRes, riskRes, ctrlRes, indBlk, accCentre] = await Promise.all([
    loadQualityDashboard(admin, hid, isSuper).catch(() => null) as Promise<any>,
    scope(admin.from("op_incidents").select("id, incident_type, severity, near_miss, status, description, corrective_action, created_at")).order("created_at", { ascending: false }).limit(4000),
    scope(admin.from("op_quality_actions").select("id, action_type, title, priority, status, owner_name, due_at, created_at")).order("created_at", { ascending: false }).limit(4000),
    (isSuper ? riskSel : riskSel.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`)).limit(2000),
    (isSuper ? ctrlSel : ctrlSel.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`)).limit(3000),
    loadClinicalIndicators(admin, hid, isSuper).catch(() => null) as Promise<any>,
    loadAccreditationCenter(admin).catch(() => null) as Promise<any>,
  ]);

  // ── Incidents (op_incidents) ─────────────────────────────────────────────────────────────────
  const incProvisioned = !(incRes.error && missing(incRes.error));
  const incidents = (incRes.error ? [] : incRes.data ?? []) as any[];
  const openInc = incidents.filter(i => i.status !== "closed");
  const bandOf = (i: any) => (i.near_miss ? "nearMiss" : SEV_BAND[i.severity] ?? "minor");
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }) }); }
  const monthIdx = new Map(months.map((m, i) => [m.key, i]));
  const series: Record<string, number[]> = Object.fromEntries(BANDS.map(b => [b, new Array(6).fill(0)]));
  const totals: Record<string, number> = Object.fromEntries(BANDS.map(b => [b, 0]));
  incidents.forEach(i => { const b = bandOf(i); totals[b]++; const mi = monthIdx.get(String(i.created_at ?? "").slice(0, 7)); if (mi != null) series[b][mi]++; });
  const byType = INC_TYPES.map(t => ({ type: t, label: INC_TYPE_LABEL[t], n: openInc.filter(i => i.incident_type === t).length })).filter(x => x.n > 0 || ["falls", "medication", "pressure_injury", "infection"].includes(x.type)).slice(0, 8);
  const criticalIncs = openInc.filter(i => i.severity === "critical");
  const criticalOpen = criticalIncs.length;
  const newThisPeriod = incidents.filter(i => String(i.created_at ?? "") >= monthStart).length;
  const awaitingRca = criticalIncs.filter(i => !i.corrective_action).length;
  const awaitingAction = openInc.filter(i => i.status === "awaiting_action").length;
  const incidentsBlk = { provisioned: incProvisioned, trend: { months: months.map(m => m.label), series }, totals, byType, open: openInc.length, criticalOpen, nearMiss: totals.nearMiss, newThisPeriod, awaitingRca, awaitingAction };

  // ── Quality actions / CAPA (op_quality_actions) ──────────────────────────────────────────────
  const qaProvisioned = !(qaRes.error && missing(qaRes.error));
  const qa = (qaRes.error ? [] : qaRes.data ?? []) as any[];
  const isOverdue = (a: any) => a.status !== "completed" && (a.status === "overdue" || (a.due_at && a.due_at < nowIso));
  const d7 = new Date(Date.now() + 7 * 86400000).toISOString();
  const capaOpen = qa.filter(a => a.action_type === "capa" && a.status !== "completed").length;
  const capaOverdueRows = qa.filter(isOverdue);
  const capa = {
    provisioned: qaProvisioned,
    open: qa.filter(a => a.status === "open").length,
    inProgress: qa.filter(a => a.status === "in_progress").length,
    overdue: capaOverdueRows.length,
    completed: qa.filter(a => a.status === "completed").length,
    openCapa: capaOpen,
    dueSoon: qa.filter(a => a.status !== "completed" && a.due_at && a.due_at >= nowIso && a.due_at <= d7).length,
    highPriority: qa.filter(a => a.status !== "completed" && a.priority === "high").length,
    total: qa.length,
  };

  // ── Risk register (gov_risks + gov_controls) — residual scoring ──────────────────────────────
  const riskProvisioned = !(riskRes.error && missing(riskRes.error));
  const risksRaw = (riskRes.error ? [] : riskRes.data ?? []) as any[];
  const controls = (ctrlRes.error ? [] : ctrlRes.data ?? []) as any[];
  const ineffectiveControls = controls.filter(c => c.effectiveness === "ineffective").length;
  const ctrlByRisk = new Map<string, any[]>();
  controls.forEach(c => { if (!c.risk_id) return; if (!ctrlByRisk.has(c.risk_id)) ctrlByRisk.set(c.risk_id, []); ctrlByRisk.get(c.risk_id)!.push(c); });
  const ctrlEff = (rid: string) => { const cs = ctrlByRisk.get(rid) ?? []; if (!cs.length) return "none"; if (cs.some(c => c.effectiveness === "effective")) return "effective"; if (cs.some(c => c.effectiveness === "partially_effective")) return "partial"; if (cs.some(c => c.effectiveness === "ineffective")) return "ineffective"; return "not_tested"; };
  const scored = risksRaw.map(r => {
    const inherent = (r.likelihood ?? 3) * (r.impact ?? 3);
    const rL = r.residual_likelihood ?? r.likelihood ?? 3, rI = r.residual_impact ?? r.impact ?? 3;
    const residual = rL * rI;
    return { ...r, inherent, residual, rL, rI, band: riskBand(residual), reviewOverdue: !!(r.review_date && r.review_date < T), control: ctrlEff(r.id) };
  });
  // Residual heat map (count by residual likelihood × impact).
  const heat: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0));
  scored.forEach(r => { heat[Math.max(1, Math.min(5, r.rL)) - 1][Math.max(1, Math.min(5, r.rI)) - 1]++; });
  const extreme = scored.filter(r => r.band === "critical").length;
  const highRiskCount = scored.filter(r => r.band === "high").length;
  const highOrExtreme = scored.filter(r => r.residual >= 15).length; // preserved KPI ("high risks")
  const topScored = [...scored].sort((a, b) => b.residual - a.residual);
  const topRisks = topScored.slice(0, 6).map((r, i) => ({ rank: i + 1, title: r.title, category: (r.category ?? "").replace(/_/g, " "), inherent: r.inherent, residual: r.residual, likelihood: r.rL, impact: r.rI, score: r.residual, band: r.band, owner: r.owner_name, control: r.control, reviewOverdue: r.reviewOverdue, status: r.status }));
  const risksBlk = { provisioned: riskProvisioned, heat, top: topRisks, high: highOrExtreme, extreme, highBand: highRiskCount, total: risksRaw.length, reviewOverdue: scored.filter(r => r.reviewOverdue).length, ineffectiveControls, escalated: risksRaw.filter(r => r.status === "escalated").length };

  // ── Audits + accreditation (loadQualityDashboard / QAS-001) ──────────────────────────────────
  const audits = {
    provisioned: !!qd,
    total: qd?.audits?.total ?? 0, planned: qd?.audits?.planned ?? 0, inProgress: qd?.audits?.inProgress ?? 0,
    completed: qd?.audits?.completed ?? 0, avgCompliance: qd?.audits?.avgCompliance ?? null,
    findingsOpen: qd?.findings?.open ?? 0, findingsCritical: qd?.findings?.critical ?? 0,
    pending: (qd?.audits?.planned ?? 0) + (qd?.audits?.inProgress ?? 0),
  };
  // Accreditation framework cards (real per-framework readiness from loadAccreditationCenter, enterprise
  // programme) with an audit-derived fallback readiness.
  const accProvisioned = !!accCentre && accCentre.ready;
  const accreditation = {
    readiness: (accProvisioned ? accCentre.kpis.overall : qd?.accreditationReadiness) ?? null,
    standards: qd?.standards ?? 0, indicators: qd?.indicators ?? 0, objects: qd?.objects ?? 0,
    evidenceGaps: accProvisioned ? (accCentre.kpis.evidenceGaps ?? 0) : 0,
    frameworks: accProvisioned ? (accCentre.perFramework ?? []).slice(0, 6).map((f: any) => ({ code: f.code, name: f.name, readiness: f.readiness })) : [],
    surveyDays: accProvisioned && accCentre.surveys?.upcoming?.length ? nextSurveyDays(accCentre.surveys.upcoming) : null,
  };

  // ── Clinical indicator performance (loadClinicalIndicators) ──────────────────────────────────
  const indKpis = indBlk?.kpis ?? null;
  const indicatorPerf = indKpis && indKpis.measured ? Math.round((indKpis.onTarget / indKpis.measured) * 100) : null;

  // ── KPI ribbon (composite, honest — null when the source isn't provisioned) ──────────────────
  const complianceScore = audits.avgCompliance;
  const capaEffectiveness = capa.total ? Math.round((capa.completed / capa.total) * 100) : null;
  const qFactors: number[] = [];
  if (complianceScore != null) qFactors.push(complianceScore);
  if (capaEffectiveness != null) qFactors.push(capaEffectiveness);
  if (incProvisioned) qFactors.push(clamp(100 - criticalOpen * 8 - incidentsBlk.open * 1.5));
  const qualityScore = mean(qFactors);
  const sFactors: number[] = [];
  if (incProvisioned) sFactors.push(clamp(100 - criticalOpen * 10 - totals.major * 4 - incidentsBlk.open * 1));
  if (riskProvisioned) sFactors.push(clamp(100 - highOrExtreme * 6));
  const safetyIndex = mean(sFactors);

  // ── Quality Health Summary (§6 weighted composite over the provisioned dimensions) ───────────
  const controlPerf = controls.length ? Math.round((controls.filter(c => c.effectiveness === "effective").length / controls.length) * 100) : (riskProvisioned ? clamp(100 - highOrExtreme * 6) : null);
  const dims: { label: string; value: number; weight: number }[] = [];
  const pushDim = (label: string, value: number | null, weight: number) => { if (value != null) dims.push({ label, value, weight }); };
  pushDim("Patient Safety", safetyIndex, 25);
  pushDim("Audit Compliance", complianceScore, 15);
  pushDim("Clinical Indicators", indicatorPerf, 15);
  pushDim("CAPA Effectiveness", capaEffectiveness, 15);
  pushDim("Risk Control", controlPerf, 10);
  pushDim("Accreditation", accreditation.readiness, 10);
  const wSum = dims.reduce((n, d) => n + d.weight, 0);
  const healthScore = wSum ? Math.round(dims.reduce((n, d) => n + d.value * d.weight, 0) / wSum) : null;
  const health = { score: healthScore, band: healthScore != null ? HEALTH_BAND(healthScore) : "—", dimensions: dims, completeness: Math.round((dims.length / 6) * 100), criticalException: criticalOpen > 0 || extreme > 0 };

  const kpis = {
    qualityScore, safetyIndex, complianceScore, accreditationReadiness: accreditation.readiness,
    openCapa: capa.openCapa, criticalIncidents: criticalOpen, highRisks: highOrExtreme,
    healthScore, indicatorPerf,
    capaOverdue: capa.overdue, capaDueSoon: capa.dueSoon, capaHigh: capa.highPriority,
    incidentsNew: newThisPeriod, incidentsAwaitingRca: awaitingRca,
    risksExtreme: extreme, risksHigh: highRiskCount, risksReviewOverdue: risksBlk.reviewOverdue, risksIneffectiveControls: ineffectiveControls,
  };

  // ── Priority Action Queue (§8 — consolidated, prioritised, drill-down; write actions next-phase)
  type QueueItem = { priority: "critical" | "high" | "medium" | "low"; action: string; source: string; related: string; owner: string | null; due: string | null; age: number; href: string };
  const queue: QueueItem[] = [];
  criticalIncs.forEach(i => queue.push({ priority: "critical", action: i.corrective_action ? "Critical incident review" : "Assign RCA", source: "Incidents", related: i.description ?? "Critical incident", owner: null, due: null, age: daysSince(i.created_at), href: "/unit-manager/quality/incidents" }));
  openInc.filter(i => i.status === "awaiting_action").slice(0, 8).forEach(i => queue.push({ priority: "high", action: "Corrective action", source: "Incidents", related: i.description ?? "Incident", owner: null, due: null, age: daysSince(i.created_at), href: "/unit-manager/quality/incidents" }));
  capaOverdueRows.slice(0, 10).forEach(a => queue.push({ priority: a.priority === "high" ? "critical" : "high", action: "Overdue CAPA", source: "CAPA", related: a.title, owner: a.owner_name ?? null, due: a.due_at ? String(a.due_at).slice(0, 10) : null, age: daysSince(a.created_at), href: "/unit-manager/capa" }));
  topScored.filter(r => r.residual >= 16 || r.status === "escalated").slice(0, 6).forEach(r => queue.push({ priority: r.residual >= 20 ? "critical" : "high", action: "Risk escalation", source: "Risk", related: r.title, owner: r.owner_name ?? null, due: r.review_date ?? null, age: 0, href: "/unit-manager/quality/risk" }));
  scored.filter(r => r.reviewOverdue).slice(0, 4).forEach(r => queue.push({ priority: "medium", action: "Risk review overdue", source: "Risk", related: r.title, owner: r.owner_name ?? null, due: r.review_date ?? null, age: 0, href: "/unit-manager/quality/risk" }));
  if (audits.findingsCritical) queue.push({ priority: "high", action: "Failed audit criteria", source: "Audit", related: `${audits.findingsCritical} critical finding(s) need CAPA`, owner: null, due: null, age: 0, href: "/unit-manager/quality/audits" });
  if (accreditation.evidenceGaps) queue.push({ priority: "medium", action: "Accreditation evidence gap", source: "Accreditation", related: `${accreditation.evidenceGaps} standard(s) missing evidence`, owner: null, due: null, age: 0, href: "/unit-manager/quality/accreditation" });
  const prRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  queue.sort((a, b) => (prRank[a.priority] - prRank[b.priority]) || (b.age - a.age));
  const actionQueue = queue.slice(0, 12);
  const queueCounts = { critical: queue.filter(q => q.priority === "critical").length, high: queue.filter(q => q.priority === "high").length, total: queue.length };

  // ── Alerts & Notifications (derived, real, with relative age) ────────────────────────────────
  const alerts: { level: "high" | "medium" | "low"; title: string; detail: string }[] = [];
  if (criticalOpen) alerts.push({ level: "high", title: `${criticalOpen} critical incident${criticalOpen === 1 ? "" : "s"} require review`, detail: "RCA assignment needed before closure" });
  if (audits.findingsCritical) alerts.push({ level: "high", title: `${audits.findingsCritical} critical audit finding${audits.findingsCritical === 1 ? "" : "s"}`, detail: "Failed critical criteria — CAPA required" });
  if (capa.overdue) alerts.push({ level: "medium", title: `${capa.overdue} CAPA${capa.overdue === 1 ? "" : "s"} overdue`, detail: "Corrective actions past their due date" });
  if (highOrExtreme) alerts.push({ level: "medium", title: `${highOrExtreme} high/extreme risk${highOrExtreme === 1 ? "" : "s"} require attention`, detail: "Residual rating ≥ 15 on the 5×5 register" });
  if (audits.pending) alerts.push({ level: "low", title: `${audits.pending} audit${audits.pending === 1 ? "" : "s"} in progress or planned`, detail: "Track to completion for compliance" });
  if (risksBlk.reviewOverdue) alerts.push({ level: "low", title: `${risksBlk.reviewOverdue} risk review${risksBlk.reviewOverdue === 1 ? "" : "s"} due`, detail: "Scheduled risk review date has passed" });

  // ── AI Quality Insights (rule-based, explainable, with a confidence heuristic) ───────────────
  const ai: { text: string; action: string; href: string; priority: "high" | "medium" | "low"; why: string; confidence: number; type: string }[] = [];
  if (criticalOpen) ai.push({ text: `Assign root-cause analysis to ${criticalOpen} critical incident(s)`, action: "Open incidents", href: "/unit-manager/quality/incidents", priority: "high", why: "Critical incidents require RCA before closure (business rule)", confidence: 92, type: "recommended priority" });
  if (audits.avgCompliance != null && audits.avgCompliance < 85) ai.push({ text: `Audit compliance at ${audits.avgCompliance}% — likely audit failure risk on low standards`, action: "Open audits", href: "/unit-manager/quality/audits", priority: "medium", why: "Below the 85% accreditation-readiness threshold", confidence: 76, type: "likely audit failure" });
  if (highOrExtreme) ai.push({ text: `${highOrExtreme} high/extreme risk(s) need mitigation or escalation`, action: "Risk register", href: "/unit-manager/quality/risk", priority: "high", why: "High risks auto-escalate to Executive Actions", confidence: 88, type: "recommended priority" });
  if (capa.overdue) ai.push({ text: `Probable CAPA delay — ${capa.overdue} overdue action(s) need owners and new dates`, action: "Open CAPA", href: "/unit-manager/capa", priority: "medium", why: "Overdue corrective actions leave findings unresolved", confidence: 71, type: "probable CAPA delay" });
  const topIncType = byType.slice().sort((a, b) => b.n - a.n)[0];
  if (incProvisioned && topIncType && topIncType.n >= 3) ai.push({ text: `Emerging pattern: ${topIncType.label} incidents are the most frequent open type (${topIncType.n})`, action: "Review pattern", href: "/unit-manager/quality/incidents", priority: "medium", why: "Highest open incident-type concentration", confidence: 68, type: "emerging incident pattern" });
  if (incProvisioned && totals.nearMiss > 0) ai.push({ text: `${totals.nearMiss} near-miss report(s) — review for systemic prevention`, action: "Review", href: "/unit-manager/quality/incidents", priority: "low", why: "Near-miss reporting is a leading safety indicator", confidence: 64, type: "recurring root-cause theme" });

  // ── Snapshot history (§26/§33) — upsert today, read history for sparklines / deltas / 12-mo trend
  let trends: any = null;
  if (hid && !isSuper) {
    try {
      await admin.from("quality_score_snapshots").upsert({
        hospital_id: hid, snapshot_date: T,
        health_score: healthScore, quality_score: qualityScore, safety_index: safetyIndex, compliance_score: complianceScore,
        open_capas: capa.openCapa, overdue_capas: capa.overdue, critical_incidents: criticalOpen, high_risks: highOrExtreme,
        patient_safety_events: incidentsBlk.open, updated_at: nowIso,
      }, { onConflict: "hospital_id,snapshot_date" });
      const { data: snaps } = await admin.from("quality_score_snapshots")
        .select("snapshot_date, health_score, quality_score, safety_index, compliance_score, open_capas, critical_incidents, high_risks")
        .eq("hospital_id", hid).order("snapshot_date", { ascending: true }).limit(400);
      const rows = (snaps ?? []) as any[];
      const spark = (k: string) => rows.slice(-12).map(r => r[k] ?? 0);
      // prior-period delta: newest vs the closest snapshot ≥28 days earlier.
      const latest = rows[rows.length - 1];
      const priorDate = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
      const prior = [...rows].reverse().find(r => r.snapshot_date <= priorDate);
      const delta = (k: string) => (latest && prior && latest[k] != null && prior[k] != null) ? latest[k] - prior[k] : null;
      // 12-month trend: latest snapshot per month.
      const byMonth = new Map<string, any>();
      rows.forEach(r => byMonth.set(String(r.snapshot_date).slice(0, 7), r));
      const trend12 = [...byMonth.entries()].slice(-12).map(([m, r]) => ({ month: m.slice(5), quality: r.quality_score, safety: r.safety_index, compliance: r.compliance_score }));
      trends = {
        points: rows.length,
        quality: { spark: spark("quality_score"), delta: delta("quality_score") },
        safety: { spark: spark("safety_index"), delta: delta("safety_index") },
        compliance: { spark: spark("compliance_score"), delta: delta("compliance_score") },
        openCapa: { spark: spark("open_capas"), delta: delta("open_capas") },
        critical: { spark: spark("critical_incidents"), delta: delta("critical_incidents") },
        highRisks: { spark: spark("high_risks"), delta: delta("high_risks") },
        health: { spark: spark("health_score"), delta: delta("health_score") },
        trend12,
      };
    } catch { trends = null; }
  }

  const ready = incProvisioned || qaProvisioned || riskProvisioned || (audits.provisioned && audits.total > 0);

  return {
    ready, asOf: T, refreshedAt: nowIso, scope: isSuper ? "Enterprise" : "Hospital",
    health, kpis, trends,
    incidents: incidentsBlk, audits, capa, risks: risksBlk, accreditation, clinicalIndicators: indKpis,
    actionQueue, queueCounts, alerts, ai,
  };
}

function nextSurveyDays(upcoming: any[]): number | null {
  const dated = upcoming.filter(s => s.date).map(s => Math.round((new Date(s.date).getTime() - Date.now()) / 86400000)).filter(n => n >= 0).sort((a, b) => a - b);
  return dated.length ? dated[0] : null;
}
