// Compliance Centre (CMO-002) — the enterprise command centre for competency-related compliance.
// The §5 Compliance Dashboard over the live competency spine (competency_decisions) + professional
// credentials + framework domains. Real: overall compliance, mandatory completion, expiring (30d),
// named high-risk staff (hard-stop: expired mandatory / critical failure), credential validity,
// compliance by domain, heatmap by unit, expiring individuals, AI insights and activity. Honest
// next-phase: accreditation standards mapping, exceptions, remediation plans and regulatory rule
// packs (each needs its own store) — surfaced as honest states, never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCmoDashboard } from "@/lib/cmo-dashboard";

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysTo = (s: string) => Math.round((new Date(s).getTime() - Date.now()) / 86400000);

export async function loadComplianceCentre(admin: any, hid: string | null, isSuper: boolean) {
  const cmo = await loadCmoDashboard(admin, hid, isSuper);
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const T = today(), d30 = plusDays(30);

  // Staff in scope (for credential tenant-scoping via nurse_id).
  let staffIds: string[] = [];
  try {
    const { data } = isSuper ? await admin.from("profiles").select("id").limit(20000)
      : await admin.from("profiles").select("id").eq("hospital_id", hid ?? NONE).limit(20000);
    staffIds = (data ?? []).map((p: any) => p.id);
  } catch { /* fail-soft */ }

  // ── Named high-risk staff (hard-stop: expired mandatory OR critical failure) ─────────────────
  let highRiskStaff: any[] = [];
  try {
    const { data: decs, error } = await scope(admin.from("competency_decisions")
      .select("nurse_id, competency_id, outcome, expiry_date, critical_failure, created_at, profiles!nurse_id(full_name)")
      .order("created_at", { ascending: false }).limit(20000));
    if (error) throw error;
    const seen = new Set<string>(); const latest: any[] = [];
    for (const d of decs ?? []) { const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k); latest.push(d); }
    const byNurse = new Map<string, { name: string; expired: number; critical: number }>();
    latest.forEach(d => {
      const expired = !!(d.expiry_date && d.expiry_date < T && PASSING.includes(d.outcome));
      const critical = !!d.critical_failure;
      if (!expired && !critical) return;
      const g = byNurse.get(d.nurse_id) ?? { name: d.profiles?.full_name ?? "—", expired: 0, critical: 0 };
      if (expired) g.expired++; if (critical) g.critical++;
      byNurse.set(d.nurse_id, g);
    });
    highRiskStaff = [...byNurse.entries()].map(([id, g]) => ({
      id, name: g.name, expired: g.expired, critical: g.critical,
      reason: g.critical ? `${g.critical} critical failure${g.critical === 1 ? "" : "s"}` : `${g.expired} expired mandatory`,
      score: Math.min(100, g.critical * 40 + g.expired * 20),
    })).sort((a, b) => b.score - a.score).slice(0, 8);
  } catch { /* fail-soft */ }

  // ── Professional credential validity (scoped via staff) ──────────────────────────────────────
  const credentials = { provisioned: true, valid: 0, expiring: 0, expired: 0, total: 0, expiringPeople: [] as any[] };
  try {
    const base = admin.from("professional_credentials").select("credential_type, title, expiry_date, status, nurse_id, profiles!nurse_id(full_name)");
    const q = isSuper ? base.limit(20000) : (staffIds.length ? base.in("nurse_id", staffIds).limit(20000) : base.eq("nurse_id", NONE));
    const { data: creds, error } = await q;
    if (error) throw error;
    const rows = creds ?? [];
    credentials.total = rows.length;
    rows.forEach((c: any) => {
      if (!c.expiry_date) { if (c.status === "valid" || c.status === "active" || c.verified) credentials.valid++; return; }
      if (c.expiry_date < T) credentials.expired++;
      else if (c.expiry_date <= d30) credentials.expiring++;
      else credentials.valid++;
    });
    credentials.expiringPeople = rows
      .filter((c: any) => c.expiry_date && c.expiry_date >= T && c.expiry_date <= d30)
      .sort((a: any, b: any) => (a.expiry_date ?? "").localeCompare(b.expiry_date ?? ""))
      .slice(0, 6)
      .map((c: any) => ({ name: c.profiles?.full_name ?? "—", credential: c.title ?? (c.credential_type ?? "Credential").replace(/_/g, " "), days: daysTo(c.expiry_date) }));
  } catch { credentials.provisioned = false; }

  // ── Accreditation readiness (quality standards) — honest if not provisioned ──────────────────
  const accreditation = { provisioned: false, standards: 0, frameworks: 0 };
  try {
    const { count: fc, error: e1 } = await admin.from("quality_frameworks").select("id", { count: "exact", head: true });
    if (e1) throw e1;
    accreditation.frameworks = fc ?? 0;
    const { count: sc } = await admin.from("quality_standards").select("id", { count: "exact", head: true });
    accreditation.standards = sc ?? 0;
    accreditation.provisioned = true;
  } catch { accreditation.provisioned = false; }

  // ── Compliance metrics (§5.1) ────────────────────────────────────────────────────────────────
  const mandatory = {
    completion: cmo.readiness.score,
    complete: cmo.readiness.current,
    due: cmo.expiring.d30,
    overdue: Math.max(0, cmo.readiness.total - cmo.readiness.current - cmo.expiring.d30),
  };

  return {
    ready: cmo.ready,
    overallCompliance: cmo.complianceScore,
    readiness: cmo.readiness,
    mandatory,
    expiring: cmo.expiring,
    expiringPeople: cmo.expiringPeople,
    highRiskStaff,
    credentials,
    accreditation,
    domains: cmo.domains,
    heatmap: cmo.workforceByCpu,
    highRiskUnits: cmo.highRiskUnits,
    risks: cmo.risks,
    ai: cmo.ai,
    activity: cmo.activity,
    highRiskThreshold: cmo.highRiskThreshold,
  };
}
