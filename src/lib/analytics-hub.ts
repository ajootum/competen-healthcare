// Competency Analytics (CMO-006) — the enterprise competency-intelligence hub. Aggregates the metrics
// computed across the CMO modules: composes loadCmoDashboard (readiness, compliance, domains, heatmap
// by unit, high-risk units, AI, readiness-snapshot trend) and adds cross-domain KPIs (assessment
// success, credential validity) via light targeted queries — no re-running the heavy domain loaders.
// Benchmarking needs a peer/enterprise comparison dataset the platform doesn't have — honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCmoDashboard } from "@/lib/cmo-dashboard";

const NONE = "00000000-0000-0000-0000-000000000000";
const PASS = 3;
const today = () => new Date().toISOString().slice(0, 10);

export async function loadAnalyticsHub(admin: any, hid: string | null, isSuper: boolean) {
  const cmo = await loadCmoDashboard(admin, hid, isSuper);
  const T = today();

  // Assessment success (pass rate among scored, completed assessments) — light, cycle-scoped.
  let assessmentSuccess: number | null = null;
  try {
    let cycleIds: string[] = [];
    if (!isSuper) { const { data: cyc } = await admin.from("competency_cycles").select("id").eq("hospital_id", hid ?? NONE).limit(3000); cycleIds = (cyc ?? []).map((c: any) => c.id); }
    const base = admin.from("assessments").select("status, score");
    const q = isSuper ? base.limit(20000) : (cycleIds.length ? base.in("cycle_id", cycleIds).limit(20000) : null);
    if (q) {
      const { data } = await q;
      const scored = (data ?? []).filter((a: any) => ["complete", "validated"].includes(a.status) && a.score != null);
      assessmentSuccess = scored.length ? Math.round((scored.filter((a: any) => a.score >= PASS).length / scored.length) * 100) : null;
    }
  } catch { /* fail-soft */ }

  // Credential validity (% valid) — light, staff-scoped.
  let credentialValidity: number | null = null;
  try {
    let staffIds: string[] = [];
    if (!isSuper) { const { data } = await admin.from("profiles").select("id").eq("hospital_id", hid ?? NONE).limit(20000); staffIds = (data ?? []).map((p: any) => p.id); }
    const base = admin.from("professional_credentials").select("status, verified, expiry_date");
    const q = isSuper ? base.limit(20000) : (staffIds.length ? base.in("nurse_id", staffIds).limit(20000) : null);
    if (q) {
      const { data } = await q; const rows = data ?? [];
      const valid = rows.filter((c: any) => (!c.expiry_date || c.expiry_date >= T) && (c.verified || ["valid", "active", "approved"].includes((c.status ?? "").toLowerCase()))).length;
      credentialValidity = rows.length ? Math.round((valid / rows.length) * 100) : null;
    }
  } catch { /* fail-soft */ }

  // The 11 CMO-006 analytics modules → their authoritative CMO surfaces.
  const modules = [
    { name: "Executive Dashboard", href: "/competency-office" },
    { name: "Readiness Analytics", href: "/competency-office" },
    { name: "Compliance Analytics", href: "/competency-office/compliance" },
    { name: "Assessment Analytics", href: "/competency-office/assessments" },
    { name: "Credential Analytics", href: "/competency-office/credentialing" },
    { name: "Framework Analytics", href: "/competency-office/frameworks" },
    { name: "Workforce Readiness", href: "/competency-office/readiness" },
    { name: "Trend Analysis", href: "/competency-office/analytics" },
    { name: "Benchmarking", href: "/competency-office/analytics" },
    { name: "Predictive Analytics", href: "/competency-office/analytics" },
    { name: "Reports & Exports", href: "/competency-office/analytics" },
  ];

  return {
    ready: cmo.ready,
    readiness: cmo.readiness.score,
    compliance: cmo.complianceScore,
    assessmentSuccess,
    credentialValidity,
    highRiskUnits: cmo.highRiskUnits,
    heatmap: cmo.workforceByCpu,
    domains: cmo.domains,
    trends: cmo.trends,
    ai: cmo.ai,
    expiring: cmo.expiring,
    modules,
  };
}
