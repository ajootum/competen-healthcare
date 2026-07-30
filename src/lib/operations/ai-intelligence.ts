// AI & Intelligence (UMG-AI) — the unit's cross-domain intelligence hub. Every UMW domain loader already
// computes rule-based AI signals; this CONSOLIDATES them into one prioritised command view rather than inventing
// a new model. Composes loadCompetencyCentre (workforce + competency + delivery + expiry signals, each already
// AI-derived) with a light operations/quality signal pass, producing a unified recommendation feed, per-domain
// intelligence tiles (each linking to the authoritative surface) and a composite AI-health score. All heuristic
// and grounded in real stores; the LIVE copilot (/api/unit-manager/copilot) adds the LLM layer over the same data.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadCompetencyCentre } from "@/lib/operations/competency-centre";

const NONE = "00000000-0000-0000-0000-000000000000";

// Light operations + quality signal pass — a few real counts, not a full domain load.
async function loadOpsSignals(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const c = (q: any) => Promise.resolve(q).then((r: any) => (r.error ? null : r.count ?? 0)).catch(() => null);
  const [openEsc, activeAlerts, openInc, overdueCapa, beds, occ] = await Promise.all([
    c(scope(admin.from("op_escalations").select("id", { count: "exact", head: true }).in("status", ["open", "acknowledged"]))),
    c(scope(admin.from("op_safety_alerts").select("id", { count: "exact", head: true }).eq("active", true))),
    c(scope(admin.from("op_incidents").select("id", { count: "exact", head: true }).neq("status", "closed"))),
    c(scope(admin.from("op_quality_actions").select("id", { count: "exact", head: true }).in("status", ["open", "overdue"]))),
    c(scope(admin.from("op_beds").select("id", { count: "exact", head: true }))),
    c(scope(admin.from("op_beds").select("id", { count: "exact", head: true }).eq("status", "occupied"))),
  ]);
  const provisioned = [openEsc, activeAlerts, openInc, overdueCapa, beds].some(v => v !== null);
  const occupancy = beds ? Math.round(((occ ?? 0) / beds) * 100) : null;
  return { provisioned, openEsc: openEsc ?? 0, activeAlerts: activeAlerts ?? 0, openInc: openInc ?? 0, overdueCapa: overdueCapa ?? 0, occupancy };
}

// Route a competency/workforce AI insight to the right unit surface by keyword.
function compHref(title: string) {
  const t = title.toLowerCase();
  if (t.includes("credential") || t.includes("expir")) return "/unit-manager/competency/recertification";
  if (t.includes("delivered") || t.includes("assignment")) return "/unit-manager/competency/assignments";
  if (t.includes("validation")) return "/unit-manager/competency-validations";
  if (t.includes("coverage") || t.includes("gap")) return "/unit-manager/competency/coverage";
  return "/unit-manager/competency";
}

const TONE_RANK: Record<string, number> = { red: 0, amber: 1, blue: 2, gray: 3, green: 4 };

export type UnitRec = { domain: string; tone: string; title: string; detail: string; href: string };

export async function loadUnitIntelligence(admin: any, hid: string | null, isSuper: boolean) {
  const [comp, ops]: [any, any] = await Promise.all([
    loadCompetencyCentre(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    loadOpsSignals(admin, hid, isSuper),
  ]);

  const recs: UnitRec[] = [];
  // Workforce + competency intelligence (already AI-derived in the competency centre).
  for (const a of (comp.ai ?? []) as any[]) {
    if (a.tone === "green") continue; // green = "all stable", not an action
    recs.push({ domain: "Competency", tone: a.tone, title: a.title, detail: a.detail, href: compHref(a.title) });
  }
  // Operations & quality intelligence (from the light signal pass).
  if (ops.activeAlerts) recs.push({ domain: "Safety", tone: ops.activeAlerts >= 3 ? "red" : "amber", title: `${ops.activeAlerts} active safety alert${ops.activeAlerts === 1 ? "" : "s"}`, detail: "Open safety alerts on the unit need review and closure.", href: "/unit-manager/quality/patient-safety" });
  if (ops.openEsc) recs.push({ domain: "Operations", tone: ops.openEsc >= 3 ? "red" : "amber", title: `${ops.openEsc} open escalation${ops.openEsc === 1 ? "" : "s"}`, detail: "Escalations are awaiting acknowledgement or resolution.", href: "/unit-manager/ops-command/safety" });
  if (ops.overdueCapa) recs.push({ domain: "Quality", tone: "amber", title: `${ops.overdueCapa} open/overdue CAPA action${ops.overdueCapa === 1 ? "" : "s"}`, detail: "Corrective actions are open past their target.", href: "/unit-manager/capa" });
  if (ops.openInc) recs.push({ domain: "Quality", tone: ops.openInc >= 5 ? "amber" : "gray", title: `${ops.openInc} incident${ops.openInc === 1 ? "" : "s"} still open`, detail: "Incidents remain under investigation or awaiting action.", href: "/unit-manager/quality/incidents" });
  if (ops.occupancy != null && ops.occupancy >= 90) recs.push({ domain: "Capacity", tone: ops.occupancy >= 95 ? "red" : "amber", title: `Bed occupancy at ${ops.occupancy}%`, detail: "Capacity pressure — review discharge planning and flow.", href: "/unit-manager/patient-operations/beds" });
  recs.sort((a, b) => (TONE_RANK[a.tone] ?? 5) - (TONE_RANK[b.tone] ?? 5));

  // Per-domain intelligence tiles — each links to the authoritative surface (built elsewhere; not duplicated).
  const r: any = comp.readiness ?? {};
  const domains = [
    { key: "Operational", icon: "🧠", href: "/unit-manager/ops-performance", headline: ops.occupancy != null ? `Occupancy ${ops.occupancy}%` : "Live ops", signals: (ops.openEsc ?? 0) + (ops.activeAlerts ?? 0), tone: ops.openEsc || ops.activeAlerts ? "amber" : "green" },
    { key: "Workforce", icon: "👥", href: "/unit-manager/workforce-intelligence", headline: r.score != null ? `Readiness ${r.score}%` : "Readiness", signals: (r.risks ?? []).length, tone: (r.risks ?? []).some((x: any) => x.severity === "critical") ? "red" : (r.risks ?? []).length ? "amber" : "green" },
    { key: "Competency", icon: "🎯", href: "/unit-manager/competency", headline: comp.kpis?.coverage != null ? `Coverage ${comp.kpis.coverage}%` : "Coverage", signals: (comp.kpis?.credentialsExpired ?? 0) + (comp.kpis?.deliveredOverdue ?? 0), tone: comp.kpis?.credentialsExpired ? "red" : (comp.kpis?.deliveredOverdue || comp.kpis?.credentialsExpiring) ? "amber" : "green" },
    { key: "Quality", icon: "🛡️", href: "/unit-manager/quality/ai", headline: `${ops.openInc ?? 0} open · ${ops.overdueCapa ?? 0} CAPA`, signals: (ops.openInc ?? 0) + (ops.overdueCapa ?? 0), tone: ops.overdueCapa ? "amber" : "green" },
    { key: "Predictive", icon: "🔮", href: "/unit-manager/performance/predictive", headline: "Forecasts & scorecard", signals: 0, tone: "gray" },
  ];

  const provisioned = comp.provisioned === true || ops.provisioned === true;
  const critical = recs.filter(x => x.tone === "red").length;
  const warn = recs.filter(x => x.tone === "amber").length;
  const aiHealth = provisioned ? Math.max(35, 100 - critical * 12 - warn * 4) : null;
  const signalCount = recs.length + domains.filter(d => d.signals > 0).length;
  const confidence = provisioned ? Math.min(95, 72 + Math.min(18, signalCount * 2)) : null;

  const agents = ["Workforce Intelligence", "Competency Intelligence", "Safety & Escalation", "Capacity & Flow", "Quality Intelligence", "Predictive Engine", "Recommendation Engine"];

  return { provisioned, aiHealth, confidence, criticalCount: critical, warnCount: warn, recommendations: recs, domains, agents, generatedAt: new Date().toISOString() };
}
