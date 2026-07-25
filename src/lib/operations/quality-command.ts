// Quality & Safety Command Centre (UMG-QS-001) — the Unit Manager's executive quality dashboard. Per the
// spec §4 Widget Data Sources / Widget Source Footnotes this is a CONSOLIDATION surface over the platform's
// existing quality/safety stores — it composes, it does not fork a new store:
//   Incidents        ← op_incidents (073, SSW incident register)
//   CAPA / RCA / QI   ← op_quality_actions (073, operational quality actions)
//   Audits + findings ← audits / audit_findings (034) via loadQualityDashboard (QAS-001)
//   Accreditation      ← audit-compliance-derived readiness (loadQualityDashboard)
//   Risk register      ← gov_risks (060, the enterprise 5x5 register)
//   Clinical indicators← quality_indicators (019)
// Real: the KPI ribbon, incident trend (6mo x severity), audit-compliance donut, CAPA pipeline, the
// patient-safety incident breakdown, the 5x5 risk heat map + top risks, alerts and rule-based AI insights.
// Honest next-phase: the 12-month composite quality TREND (needs an analytics-snapshot history the platform
// doesn't retain — §7) and Mortality & Morbidity (no store). Every source is fail-soft + provisioned-aware.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadQualityDashboard } from "@/lib/quality-accreditation-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

const INC_TYPE_LABEL: Record<string, string> = { medication: "Medication", falls: "Falls", equipment: "Equipment", pressure_injury: "Pressure Injury", infection: "Infection / HAI", behaviour: "Behaviour", documentation: "Documentation", sentinel: "Sentinel", other: "Other" };
const INC_TYPES = ["medication", "falls", "equipment", "pressure_injury", "infection", "behaviour", "documentation", "sentinel", "other"];
// Incident severity → the executive trend bands. near_miss incidents move to their own band (mutually exclusive).
const SEV_BAND: Record<string, string> = { critical: "critical", high: "major", medium: "moderate", low: "minor" };
const BANDS = ["critical", "major", "moderate", "minor", "nearMiss"] as const;

export async function loadQualityCommand(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const nowIso = new Date().toISOString(), T = nowIso.slice(0, 10);

  // gov_risks: hospital-scoped OR platform-wide (hospital_id null). Filters must follow .select().
  const riskSel = admin.from("gov_risks").select("id, title, category, likelihood, impact, status, owner_name, review_date").neq("status", "closed");
  const [qd, incRes, qaRes, riskRes] = await Promise.all([
    loadQualityDashboard(admin, hid, isSuper).catch(() => null) as Promise<any>,
    scope(admin.from("op_incidents").select("id, incident_type, severity, near_miss, status, description, created_at")).order("created_at", { ascending: false }).limit(4000),
    scope(admin.from("op_quality_actions").select("id, action_type, title, priority, status, owner_name, due_at, created_at")).order("created_at", { ascending: false }).limit(4000),
    (isSuper ? riskSel : riskSel.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`)).limit(2000),
  ]);

  // ── Incidents (op_incidents) ─────────────────────────────────────────────────────────────────
  const incProvisioned = !(incRes.error && missing(incRes.error));
  const incidents = (incRes.error ? [] : incRes.data ?? []) as any[];
  const openInc = incidents.filter(i => i.status !== "closed");
  const bandOf = (i: any) => (i.near_miss ? "nearMiss" : SEV_BAND[i.severity] ?? "minor");
  // 6-month trend, band series per month.
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }) }); }
  const monthIdx = new Map(months.map((m, i) => [m.key, i]));
  const series: Record<string, number[]> = Object.fromEntries(BANDS.map(b => [b, new Array(6).fill(0)]));
  const totals: Record<string, number> = Object.fromEntries(BANDS.map(b => [b, 0]));
  incidents.forEach(i => { const b = bandOf(i); totals[b]++; const mi = monthIdx.get(String(i.created_at ?? "").slice(0, 7)); if (mi != null) series[b][mi]++; });
  const byType = INC_TYPES.map(t => ({ type: t, label: INC_TYPE_LABEL[t], n: openInc.filter(i => i.incident_type === t).length })).filter(x => x.n > 0 || ["falls", "medication", "pressure_injury", "infection"].includes(x.type)).slice(0, 8);
  const criticalOpen = openInc.filter(i => i.severity === "critical").length;
  const incidentsBlk = { provisioned: incProvisioned, trend: { months: months.map(m => m.label), series }, totals, byType, open: openInc.length, criticalOpen, nearMiss: totals.nearMiss };

  // ── Quality actions / CAPA (op_quality_actions) ──────────────────────────────────────────────
  const qaProvisioned = !(qaRes.error && missing(qaRes.error));
  const qa = (qaRes.error ? [] : qaRes.data ?? []) as any[];
  const isOverdue = (a: any) => a.status !== "completed" && (a.status === "overdue" || (a.due_at && a.due_at < nowIso));
  const capaOpen = qa.filter(a => a.action_type === "capa" && a.status !== "completed").length;
  const capa = {
    provisioned: qaProvisioned,
    open: qa.filter(a => a.status === "open").length,
    inProgress: qa.filter(a => a.status === "in_progress").length,
    overdue: qa.filter(isOverdue).length,
    completed: qa.filter(a => a.status === "completed").length,
    openCapa: capaOpen,
    total: qa.length,
    recent: qa.filter(a => a.status !== "completed").slice(0, 6).map(a => ({ title: a.title, type: a.action_type, priority: a.priority, status: a.status, owner: a.owner_name, due: a.due_at })),
  };
  // Pipeline stages from the real statuses (no synthetic "verification" stage — honest).
  capa.total = qa.length;

  // ── Risk register (gov_risks) — 5x5 heat map + top risks ─────────────────────────────────────
  const riskProvisioned = !(riskRes.error && missing(riskRes.error));
  const risks = (riskRes.error ? [] : riskRes.data ?? []) as any[];
  // heat[likelihood-1][impact-1] = count. Score = likelihood * impact.
  const heat: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0));
  risks.forEach(r => { const l = Math.max(1, Math.min(5, r.likelihood ?? 3)), im = Math.max(1, Math.min(5, r.impact ?? 3)); heat[l - 1][im - 1]++; });
  const scored = risks.map(r => ({ title: r.title, category: (r.category ?? "").replace(/_/g, " "), likelihood: r.likelihood ?? 3, impact: r.impact ?? 3, score: (r.likelihood ?? 3) * (r.impact ?? 3), status: r.status, owner: r.owner_name })).sort((a, b) => b.score - a.score);
  const highRisks = scored.filter(r => r.score >= 15).length;
  const risksBlk = { provisioned: riskProvisioned, heat, top: scored.slice(0, 6), high: highRisks, total: risks.length };

  // ── Audits + accreditation (reuse loadQualityDashboard / QAS-001) ────────────────────────────
  const audits = {
    provisioned: !!qd,
    total: qd?.audits?.total ?? 0, planned: qd?.audits?.planned ?? 0, inProgress: qd?.audits?.inProgress ?? 0,
    completed: qd?.audits?.completed ?? 0, avgCompliance: qd?.audits?.avgCompliance ?? null,
    findingsOpen: qd?.findings?.open ?? 0, findingsCritical: qd?.findings?.critical ?? 0,
    pending: (qd?.audits?.planned ?? 0) + (qd?.audits?.inProgress ?? 0),
  };
  const accreditation = { readiness: qd?.accreditationReadiness ?? null, standards: qd?.standards ?? 0, indicators: qd?.indicators ?? 0, objects: qd?.objects ?? 0 };

  // ── KPI ribbon (composite, honest — null when the source isn't provisioned) ──────────────────
  const complianceScore = audits.avgCompliance;
  const capaEffectiveness = capa.total ? Math.round((capa.completed / capa.total) * 100) : null;
  // Quality Score — mean of the provisioned quality signals.
  const qFactors: number[] = [];
  if (complianceScore != null) qFactors.push(complianceScore);
  if (capaEffectiveness != null) qFactors.push(capaEffectiveness);
  if (incProvisioned) qFactors.push(clamp(100 - criticalOpen * 8 - incidentsBlk.open * 1.5));
  const qualityScore = mean(qFactors);
  // Patient Safety Index — from incident severity load + risk pressure.
  const sFactors: number[] = [];
  if (incProvisioned) sFactors.push(clamp(100 - criticalOpen * 10 - totals.major * 4 - incidentsBlk.open * 1));
  if (riskProvisioned) sFactors.push(clamp(100 - highRisks * 6));
  const safetyIndex = mean(sFactors);

  const kpis = {
    qualityScore, safetyIndex, complianceScore, accreditationReadiness: accreditation.readiness,
    openCapa: capa.openCapa, criticalIncidents: criticalOpen, highRisks,
  };

  // ── Alerts & Notifications (derived, real) ───────────────────────────────────────────────────
  const alerts: { level: "high" | "medium" | "low"; title: string; detail: string }[] = [];
  if (criticalOpen) alerts.push({ level: "high", title: `${criticalOpen} critical incident${criticalOpen === 1 ? "" : "s"} require review`, detail: "RCA assignment needed before closure" });
  if (audits.findingsCritical) alerts.push({ level: "high", title: `${audits.findingsCritical} critical audit finding${audits.findingsCritical === 1 ? "" : "s"}`, detail: "Failed critical criteria — CAPA required" });
  if (capa.overdue) alerts.push({ level: "medium", title: `${capa.overdue} CAPA${capa.overdue === 1 ? "" : "s"} overdue`, detail: "Corrective actions past their due date" });
  if (highRisks) alerts.push({ level: "medium", title: `${highRisks} high risk${highRisks === 1 ? "" : "s"} require attention`, detail: "Risk rating ≥ 15 on the 5×5 register" });
  if (audits.pending) alerts.push({ level: "low", title: `${audits.pending} audit${audits.pending === 1 ? "" : "s"} in progress or planned`, detail: "Track to completion for compliance" });
  const reviewDue = risks.filter(r => r.review_date && r.review_date < T).length;
  if (reviewDue) alerts.push({ level: "low", title: `${reviewDue} risk review${reviewDue === 1 ? "" : "s"} due`, detail: "Scheduled risk review date has passed" });

  // ── AI Quality Insights (rule-based, explainable) ────────────────────────────────────────────
  const ai: { text: string; action: string; href: string; priority: "high" | "medium" | "low"; why: string }[] = [];
  if (criticalOpen) ai.push({ text: `Assign root-cause analysis to ${criticalOpen} critical incident(s)`, action: "Open incidents", href: "/supervisor/quality-safety", priority: "high", why: "Critical incidents require RCA before closure (business rule)" });
  if (audits.avgCompliance != null && audits.avgCompliance < 85) ai.push({ text: `Audit compliance at ${audits.avgCompliance}% — target the lowest-scoring standards`, action: "Open audits", href: "/quality-accreditation", priority: "medium", why: "Below the 85% accreditation-readiness threshold" });
  if (highRisks) ai.push({ text: `${highRisks} high risk(s) on the register need mitigation or escalation`, action: "Risk register", href: "/unit-manager/quality/risk", priority: "high", why: "High risks auto-escalate to Executive Actions" });
  if (capa.overdue) ai.push({ text: `Recover ${capa.overdue} overdue CAPA(s) — assign owners and new dates`, action: "Open CAPA", href: "/unit-manager/capa", priority: "medium", why: "Overdue corrective actions leave findings unresolved" });
  if (incProvisioned && totals.nearMiss > 0) ai.push({ text: `${totals.nearMiss} near-miss report(s) — review for systemic prevention`, action: "Review", href: "/supervisor/quality-safety", priority: "low", why: "Near-miss reporting is a leading safety indicator" });

  const ready = incProvisioned || qaProvisioned || riskProvisioned || (audits.provisioned && audits.total > 0);

  return {
    ready, asOf: T, scope: isSuper ? "Enterprise" : "Hospital",
    kpis, incidents: incidentsBlk, audits, capa, risks: risksBlk, accreditation, alerts, ai,
  };
}
