import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

// Unit Manager Workspace data (COE §4.6) — operational performance for a clinical
// unit: the operational picture plus workforce competency coverage and quality.
// Tenant-scoped; degrades gracefully pre-migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
const NONE = "00000000-0000-0000-0000-000000000000";

// Latest decision per (nurse, competency) → coverage summary.
function summariseDecisions(rows: any[]) {
  const seen = new Set<string>(); const latest: any[] = [];
  for (const d of rows) { const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k); latest.push(d); }
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(); soon.setDate(soon.getDate() + 60); const soonStr = soon.toISOString().slice(0, 10);
  const isExpired = (d: any) => d.outcome === "expired" || (d.expiry_date && d.expiry_date < today);
  // Mutually exclusive buckets so competent + expired + gaps === total.
  const competent = latest.filter(d => PASSING.includes(d.outcome) && !isExpired(d)).length;
  const expired = latest.filter(d => isExpired(d)).length;
  const expiring = latest.filter(d => PASSING.includes(d.outcome) && d.expiry_date && d.expiry_date >= today && d.expiry_date <= soonStr).length;
  const gaps = latest.filter(d => !isExpired(d) && !PASSING.includes(d.outcome)).length;
  const total = latest.length;
  const coverage = total ? Math.round((competent / total) * 100) : 0;
  return { total, competent, expired, expiring, gaps, coverage, latest };
}

export async function loadUnitManagerDashboard(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);

  // Workforce competency coverage (hospital_id stamped on decisions by migration 027).
  let capability = { total: 0, competent: 0, expired: 0, expiring: 0, gaps: 0, coverage: 0, latest: [] as any[] };
  try {
    const { data: decs } = await scope(admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, created_at").order("created_at", { ascending: false }).limit(20000));
    capability = summariseDecisions(decs ?? []);
  } catch { /* pre-migration */ }

  // Quality & improvement (audits + CAPA).
  const quality = { audits: 0, avgCompliance: null as number | null, openCapa: 0, criticalCapa: 0 };
  try {
    const { data: audits } = await scope(admin.from("audits").select("status, compliance_pct").limit(500));
    const done = (audits ?? []).filter((a: any) => a.status === "completed" && a.compliance_pct != null);
    quality.audits = (audits ?? []).length;
    quality.avgCompliance = done.length ? Math.round(done.reduce((s: number, a: any) => s + a.compliance_pct, 0) / done.length) : null;
    const { data: capa } = await scope(admin.from("capa_actions").select("status, priority").limit(500));
    const open = (capa ?? []).filter((c: any) => !["completed", "verified", "closed"].includes(c.status));
    quality.openCapa = open.length;
    quality.criticalCapa = open.filter((c: any) => c.priority === "high" || c.priority === "critical").length;
  } catch { /* pre-migration */ }

  // Unit workforce size (scoped consistently with the other KPIs).
  let staffCount = 0;
  try {
    const { count } = await scope(admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "nurse"));
    staffCount = count ?? 0;
  } catch { /* ignore */ }

  // Assessment oversight — active cycles + educator validations pending.
  const assessment = { activeCycles: 0, pendingValidations: 0 };
  try {
    const { data: cyc } = await scope(admin.from("competency_cycles").select("id, status").limit(3000));
    const cycles = cyc ?? [];
    assessment.activeCycles = cycles.filter((c: any) => c.status === "active").length;
    const cycleIds = cycles.map((c: any) => c.id);
    if (cycleIds.length) {
      const { data: scores } = await admin.from("competency_scores").select("is_passing, educator_validated").in("cycle_id", cycleIds).limit(8000);
      assessment.pendingValidations = (scores ?? []).filter((s: any) => s.is_passing && !s.educator_validated).length;
    }
  } catch { /* pre-migration */ }

  // Learning compliance — pathway-item completion across the unit's workforce.
  const learning = { total: 0, completed: 0, compliance: 0 };
  try {
    const { data: nurses } = await scope(admin.from("profiles").select("id").eq("role", "nurse").limit(2000));
    const nurseIds = (nurses ?? []).map((n: any) => n.id);
    if (nurseIds.length) {
      const { data: pws } = await admin.from("learning_pathways").select("id").in("nurse_id", nurseIds).limit(2000);
      const pwIds = (pws ?? []).map((p: any) => p.id);
      if (pwIds.length) {
        const { data: items } = await admin.from("pathway_items").select("status").in("pathway_id", pwIds).limit(8000);
        learning.total = (items ?? []).length;
        learning.completed = (items ?? []).filter((i: any) => i.status === "completed").length;
        learning.compliance = learning.total ? Math.round((learning.completed / learning.total) * 100) : 0;
      }
    }
  } catch { /* ignore */ }

  return { ready, ops: data, capability, quality, staffCount, assessment, learning };
}

// Detailed competency coverage for the Workforce Capability page.
export async function loadUnitCapability(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("competency_decisions").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { ready: false, summary: summariseDecisions([]), perNurse: [] };

  const { data: decs } = await scope(admin.from("competency_decisions")
    .select("nurse_id, competency_id, outcome, expiry_date, created_at, profiles!nurse_id(full_name)")
    .order("created_at", { ascending: false }).limit(20000));
  const summary = summariseDecisions(decs ?? []);
  const today = new Date().toISOString().slice(0, 10);

  // Per-nurse readiness from the deduped latest decisions.
  const byNurse = new Map<string, { name: string; total: number; competent: number; expired: number; gaps: number }>();
  for (const d of summary.latest) {
    const name = (d.profiles as any)?.full_name ?? "—";
    const n = byNurse.get(d.nurse_id) ?? { name, total: 0, competent: 0, expired: 0, gaps: 0 };
    n.total++;
    const expired = d.outcome === "expired" || (d.expiry_date && d.expiry_date < today);
    if (expired) n.expired++;
    else if (PASSING.includes(d.outcome)) n.competent++;
    else n.gaps++;
    byNurse.set(d.nurse_id, n);
  }
  const perNurse = [...byNurse.values()]
    .map(n => ({ ...n, coverage: n.total ? Math.round((n.competent / n.total) * 100) : 0 }))
    .sort((a, b) => a.coverage - b.coverage);
  return { ready: true, summary, perNurse };
}
