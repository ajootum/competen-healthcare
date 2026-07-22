// Policy & Standards Center (GOV-001.2) loader — the enterprise policy library.
// Platform-wide, fail-soft. Real signals only: the policies table has no status
// column (no draft/in_review states) and a single version field, so the KPIs
// map honestly onto what IS stored — active vs retired, platform-wide vs
// tenant-scoped, review currency (due/overdue windows) — and the approval
// pipeline runs through the platform engine's policy_publication workflow.
// Acknowledgements and per-version history have no store yet → honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const DAY = 86400000;

export async function loadPolicyCenter(admin: any) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const soonStr = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);

  const [polRows, hospitals, fwRows, qfRows, stdRows, apprPending, apprRecent] = await Promise.all([
    admin.from("policies").select("id, title, policy_type, version, effective_date, review_date, is_active, hospital_id, approved_by, created_at").order("created_at", { ascending: false }).limit(4000),
    admin.from("hospitals").select("id, name").limit(2000),
    admin.from("frameworks").select("id, name").order("name").limit(1000),
    admin.from("quality_frameworks").select("id, code, name, framework_type, is_active").limit(200),
    admin.from("quality_standards").select("framework_id").limit(20000),
    admin.from("plat_approval_requests").select("*", { count: "exact", head: true }).eq("workflow_key", "policy_publication").eq("status", "pending"),
    admin.from("plat_approval_requests").select("entity_name, status, current_step, total_steps, created_at").eq("workflow_key", "policy_publication").order("created_at", { ascending: false }).limit(6),
  ]);

  const policies = (polRows.error ? [] : polRows.data ?? []) as any[];
  const hospName = new Map<string, string>((hospitals.error ? [] : hospitals.data ?? []).map((h: any) => [h.id, h.name]));

  const active = policies.filter(p => p.is_active !== false);
  const retired = policies.length - active.length;
  const platformWide = active.filter(p => !p.hospital_id).length;
  const dated = active.filter(p => p.review_date);
  const overdue = dated.filter(p => p.review_date < todayStr).length;
  const dueSoon = dated.filter(p => p.review_date >= todayStr && p.review_date <= soonStr).length;
  const approvedCount = policies.filter(p => p.approved_by).length;

  // Library list (recent) with tenant scope resolved.
  const library = policies.slice(0, 8).map(p => ({
    id: p.id, title: p.title, type: p.policy_type, version: p.version,
    scope: p.hospital_id ? (hospName.get(p.hospital_id) ?? "Tenant") : "Platform-wide",
    reviewDate: p.review_date, active: p.is_active !== false,
    overdue: !!(p.review_date && p.review_date < todayStr && p.is_active !== false),
  }));

  // Review calendar — nearest review dates first (overdue surfaces at top).
  const calendar = dated
    .slice().sort((a, b) => String(a.review_date).localeCompare(String(b.review_date)))
    .slice(0, 6)
    .map(p => ({ title: p.title, date: p.review_date, overdue: p.review_date < todayStr, dueSoon: p.review_date >= todayStr && p.review_date <= soonStr }));

  // Standards library (EQOS frameworks + mapped standard refs).
  const stdByFw = bucket(stdRows.error ? [] : stdRows.data ?? [], "framework_id");
  const standards = (qfRows.error ? [] : qfRows.data ?? []).map((f: any) => ({ code: f.code, name: f.name, type: f.framework_type, active: f.is_active, mapped: stdByFw[f.id] ?? 0 }));

  return {
    kpis: {
      total: policies.length, active: active.length, platformWide,
      dueSoon, overdue, retired,
    },
    byType: Object.entries(bucket(active, "policy_type")).map(([type, n]) => ({ type, n })).sort((a, b) => (b.n as number) - (a.n as number)),
    library,
    calendar,
    standards,
    approvals: {
      pending: num(apprPending),
      recent: apprRecent.error ? [] : (apprRecent.data ?? []),
    },
    approvedCount,
    // Pickers for the Policy Center canvas.
    pickers: {
      frameworks: (fwRows.error ? [] : fwRows.data ?? []).map((f: any) => ({ id: f.id, label: f.name })),
      policies: active.slice(0, 500).map(p => ({ id: p.id, label: `${p.title} (v${p.version ?? "1.0"})` })),
    },
    generatedAt: new Date().toISOString(),
  };
}
