// Audit & Compliance Centre (UMG-QS-003) — the Unit Manager's clinical-audit oversight, aligned to the
// detailed spec. Consolidation over audits + audit_findings (034) + capa_actions (034, audit-linked CAPA);
// no store forked, no migration. Real (from the audit records' own timestamps + scores): the compliance KPIs
// with a 12-month trend + period delta, audit status, top audit areas with per-area change, best/lowest/
// most-improved/most-declined highlights, the findings breakdown, the CAPA status, overdue CAPAs and rule-
// based AI insights. compliance_pct is numeric → PostgREST STRING → Number()-coerced. Accreditation score +
// "ready in N days" reuse loadAccreditationCenter. Honest next-phase (spec §9 entities that have no store):
// the forward Audit Calendar / AuditSchedule (audits has no scheduled_date), the Evidence repository /
// evidence-completeness, and the finer CAPA sub-stages. Fail-soft + provisioned-aware.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadAccreditationCenter } from "@/lib/super-admin/gov-accreditation";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const TYPE_LABEL: Record<string, string> = { concurrent: "Concurrent", retrospective: "Retrospective", clinical: "Clinical" };
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const TARGET = 85; // default compliance target line (configurable target store is next-phase)

export async function loadAuditCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const T = new Date(), today = T.toISOString().slice(0, 10);
  const [res, capaRes, acc] = await Promise.all([
    scope(admin.from("audits").select("id, audit_type, title, area, status, compliance_pct, items_met, items_not_met, items_na, conducted_by_name, conducted_at, created_at")).order("conducted_at", { ascending: false }).limit(4000),
    scope(admin.from("capa_actions").select("id, title, status, priority, due_date, created_at, audit_id")).order("created_at", { ascending: false }).limit(4000),
    loadAccreditationCenter(admin).catch(() => null) as Promise<any>,
  ]);
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const rows = (res.error ? [] : res.data ?? []) as any[];
  const auditIds = rows.map(a => a.id);
  const capas = (capaRes.error ? [] : capaRes.data ?? []) as any[];

  const completed = rows.filter(a => a.status === "completed");
  const withPct = completed.filter(a => a.compliance_pct != null).map(a => ({ ...a, pct: Number(a.compliance_pct) }));
  const overallCompliance = avg(withPct.map(a => a.pct));

  // ── 12-month buckets ─────────────────────────────────────────────────────────────────────────
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(T.getFullYear(), T.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }) }); }
  const trendCompliance = months.map(m => avg(withPct.filter(a => String(a.conducted_at ?? "").slice(0, 7) === m.key).map(a => a.pct)));
  const thisKey = months[11].key, lastKey = months[10].key;
  const complianceThis = avg(withPct.filter(a => String(a.conducted_at ?? "").slice(0, 7) === thisKey).map(a => a.pct));
  const complianceLast = avg(withPct.filter(a => String(a.conducted_at ?? "").slice(0, 7) === lastKey).map(a => a.pct));
  const complianceDelta = (complianceThis != null && complianceLast != null) ? complianceThis - complianceLast : null;

  // ── Findings ─────────────────────────────────────────────────────────────────────────────────
  // ⚠ AN UNREAD FINDINGS TABLE READ AS A CLEAN AUDIT: highRisk 0, otherNotMet 0, repeat 0 — the three numbers
  // an accreditation lead checks first. `unavailable` marks the block so the page can refuse to draw them.
  const findings = { highRisk: 0, otherNotMet: 0, met: 0, na: 0, total: 0, repeat: 0, unavailable: false };
  const findingRows: any[] = [];
  if (auditIds.length) {
    try {
      const { data, error } = await admin.from("audit_findings").select("audit_id, item_text, is_critical, result").in("audit_id", auditIds).limit(20000);
      if (error) findings.unavailable = true;
      const fr = (data ?? []) as any[]; findingRows.push(...fr);
      findings.total = fr.length;
      findings.highRisk = fr.filter(f => f.result === "not_met" && f.is_critical).length;
      findings.otherNotMet = fr.filter(f => f.result === "not_met" && !f.is_critical).length;
      findings.met = fr.filter(f => f.result === "met").length;
      findings.na = fr.filter(f => f.result === "na").length;
      // Repeat findings — the same not-met item recurring across audits.
      const byItem = new Map<string, number>();
      fr.filter(f => f.result === "not_met").forEach(f => { const k = (f.item_text ?? "").trim().toLowerCase(); if (k) byItem.set(k, (byItem.get(k) ?? 0) + 1); });
      findings.repeat = [...byItem.values()].filter(n => n >= 2).length;
    } catch { /* fail-soft */ }
  }

  // ── CAPA (capa_actions — audit-linked) ───────────────────────────────────────────────────────
  const capaOpenStatuses = ["open", "in_progress"];
  const capa = {
    total: capas.length,
    open: capas.filter(c => c.status === "open").length,
    inProgress: capas.filter(c => c.status === "in_progress").length,
    verified: capas.filter(c => c.status === "verified").length,
    completed: capas.filter(c => ["completed", "closed"].includes(c.status)).length,
    overdue: capas.filter(c => !["completed", "verified", "closed"].includes(c.status) && c.due_date && c.due_date < today).length,
    generatedThisMonth: capas.filter(c => String(c.created_at ?? "").slice(0, 7) === thisKey).length,
    openTotal: capas.filter(c => capaOpenStatuses.includes(c.status)).length,
  };

  // ── Audit status (overdue = non-completed & conducted_at > 30d — SLA proxy; forward schedule is next-phase)
  const staleCut = new Date(Date.now() - 30 * 864e5).toISOString();
  const status = {
    total: rows.length,
    completed: completed.length,
    inProgress: rows.filter(a => a.status === "in_progress").length,
    planned: rows.filter(a => a.status === "planned").length,
    overdue: rows.filter(a => a.status !== "completed" && String(a.conducted_at ?? a.created_at ?? "") < staleCut).length,
  };

  // ── Top areas by compliance + per-area change (latest vs previous completed audit) ───────────
  const byAreaMap = new Map<string, any[]>();
  withPct.forEach(a => { const k = a.area || "Unspecified"; if (!byAreaMap.has(k)) byAreaMap.set(k, []); byAreaMap.get(k)!.push(a); });
  const areaStats = [...byAreaMap.entries()].map(([name, list]) => {
    const sorted = [...list].sort((a, b) => String(b.conducted_at).localeCompare(String(a.conducted_at)));
    const latest = sorted[0]?.pct ?? null, prevA = sorted[1]?.pct ?? null;
    const change = (latest != null && prevA != null) ? latest - prevA : null;
    return { name, compliance: avg(list.map(a => a.pct)) ?? 0, latest: latest ?? 0, change, n: list.length };
  });
  const areas = [...areaStats].sort((a, b) => b.compliance - a.compliance).slice(0, 8);
  const changed = areaStats.filter(a => a.change != null);
  const highlights = {
    best: areaStats.slice().sort((a, b) => b.compliance - a.compliance)[0] ?? null,
    lowest: areaStats.slice().sort((a, b) => a.compliance - b.compliance)[0] ?? null,
    mostImproved: changed.slice().sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0] ?? null,
    mostDeclined: changed.slice().sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0] ?? null,
  };

  // ── Compliance by type + high-risk finding delta (period) ────────────────────────────────────
  const byType = [...new Set(withPct.map(a => TYPE_LABEL[a.audit_type] ?? a.audit_type))].map(name => { const xs = withPct.filter(a => (TYPE_LABEL[a.audit_type] ?? a.audit_type) === name).map(a => a.pct); return { name, n: xs.length, pct: avg(xs) ?? 0 }; }).sort((a, b) => b.pct - a.pct);

  // ── Accreditation score + "ready in N days" ──────────────────────────────────────────────────
  const accReady = acc && acc.ready;
  const accreditationScore = (accReady ? acc.kpis.overall : overallCompliance) ?? null;
  const surveyDays = (accReady && acc.surveys?.upcoming?.length) ? (() => { const ds = acc.surveys.upcoming.filter((s: any) => s.date).map((s: any) => Math.round((new Date(s.date).getTime() - Date.now()) / 864e5)).filter((n: number) => n >= 0).sort((a: number, b: number) => a - b); return ds.length ? ds[0] : null; })() : null;

  const kpis = {
    overallCompliance, complianceDelta, complianceSpark: trendCompliance.map(v => v ?? 0),
    scheduled: status.planned, completed: status.completed, completedPct: status.total ? Math.round((status.completed / status.total) * 100) : 0,
    overdue: status.overdue,
    highRiskFindings: findings.highRisk, repeatFindings: findings.repeat,
    capasGenerated: capa.generatedThisMonth, capasTotal: capa.total,
    accreditationScore, surveyDays,
    total: status.total, inProgress: status.inProgress,
  };

  // ── Findings by level (real mapping) ─────────────────────────────────────────────────────────
  const findingsByLevel = [
    { label: "High Risk (critical, not met)", n: findings.highRisk, color: "#ef4444" },
    { label: "Other findings (not met)", n: findings.otherNotMet, color: "#f59e0b" },
    { label: "Compliant (met)", n: findings.met, color: "#10b981" },
    { label: "Not applicable", n: findings.na, color: "#94a3b8" },
  ];

  // ── Overdue items (real ones only) ───────────────────────────────────────────────────────────
  const overdueItems = [
    { label: "Overdue CAPAs", n: capa.overdue, tone: "rose" },
    { label: "Stale audits (>30d open)", n: status.overdue, tone: "amber" },
    { label: "High-risk findings", n: findings.highRisk, tone: "orange" },
    { label: "Repeat findings", n: findings.repeat, tone: "amber" },
    { label: "Standards with evidence gaps", n: accReady ? (acc.kpis.evidenceGaps ?? 0) : 0, tone: "sky" },
  ];

  // ── Recent audits (real; forward calendar is next-phase) ─────────────────────────────────────
  const recentAudits = rows.slice(0, 6).map(a => ({ title: a.title, type: TYPE_LABEL[a.audit_type] ?? a.audit_type, area: a.area, status: a.status, pct: a.compliance_pct != null ? Number(a.compliance_pct) : null, by: a.conducted_by_name, at: a.conducted_at }));

  // ── AI audit insights (rule-based, explainable) ──────────────────────────────────────────────
  const ai: { text: string; detail: string; confidence: number; tone: string }[] = [];
  const topRepeat = (() => { const m = new Map<string, number>(); findingRows.filter(f => f.result === "not_met").forEach(f => { const k = (f.item_text ?? "").trim(); if (k) m.set(k, (m.get(k) ?? 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]; })();
  if (topRepeat && topRepeat[1] >= 2) ai.push({ text: `High recurrence of "${topRepeat[0]}" across ${topRepeat[1]} audits`, detail: "Recurring non-conformance — consider a targeted CAPA", confidence: Math.min(90, 60 + topRepeat[1] * 6), tone: "rose" });
  if (highlights.mostDeclined && (highlights.mostDeclined.change ?? 0) < 0) ai.push({ text: `${highlights.mostDeclined.name} compliance may drop below target`, detail: `Declined ${Math.abs(highlights.mostDeclined.change ?? 0)}% since the previous audit`, confidence: 74, tone: "amber" });
  if (accReady && (acc.kpis.evidenceGaps ?? 0) > 0) ai.push({ text: `Evidence gap on ${acc.kpis.evidenceGaps} standard(s)`, detail: "Impact: accreditation readiness", confidence: 80, tone: "sky" });
  if (highlights.mostImproved && (highlights.mostImproved.change ?? 0) > 0) ai.push({ text: `${highlights.mostImproved.name} compliance improved significantly`, detail: `Up ${highlights.mostImproved.change}% since the previous audit — keep it up`, confidence: 82, tone: "emerald" });

  return {
    provisioned: true as const, hasData: rows.length > 0,
    kpis, trend: { months: months.map(m => m.label), compliance: trendCompliance, target: TARGET },
    status, areas, highlights, byType, findings, findingsByLevel, capa, overdueItems, recentAudits, ai,
    criticalFindings: findingRows.filter(f => f.result === "not_met" && f.is_critical).slice(0, 8).map(f => ({ item: f.item_text, audit: rows.find(a => a.id === f.audit_id)?.title ?? "Audit" })),
  };
}
