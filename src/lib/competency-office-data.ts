// Competency Office Workspace data (CPO-001) — enterprise competency governance:
// framework status, CPU lifecycle, competency compliance, pending approvals and
// assessment readiness. Frameworks/templates are scoped to the caller's hospital
// PLUS the shared master library (hospital_id null); CPUs are a shared master
// library. competency_decisions/cycles are hospital-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];

export async function loadCompetencyOfficeDashboard(admin: any, hid: string | null, isSuper: boolean) {
  // own + master library (hospital_id null)
  const scopeOwnOrMaster = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const scopeHospital = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const count = (rows: any[], key: string, val: string) => rows.filter(r => r[key] === val).length;

  // ── Frameworks (own + master)
  let frameworks = { total: 0, published: 0, draft: 0, inReview: 0, core: 0, specialty: 0, role: 0 };
  let competencyCount = 0;
  let fwIds: string[] = [];
  try {
    const { data: fws } = await scopeOwnOrMaster(admin.from("frameworks").select("id, library, pub_status").limit(3000));
    const rows = fws ?? [];
    fwIds = rows.map((f: any) => f.id);
    frameworks = {
      total: rows.length,
      published: count(rows, "pub_status", "published"),
      draft: count(rows, "pub_status", "draft"),
      inReview: count(rows, "pub_status", "in_review"),
      core: count(rows, "library", "core"),
      specialty: count(rows, "library", "specialty"),
      role: count(rows, "library", "role"),
    };
    if (fwIds.length) {
      const { data: doms } = await admin.from("framework_domains").select("id").in("framework_id", fwIds).limit(5000);
      const domIds = (doms ?? []).map((d: any) => d.id);
      if (domIds.length) {
        const { count: c } = await admin.from("framework_competencies").select("id", { count: "exact", head: true }).in("domain_id", domIds);
        competencyCount = c ?? 0;
      }
    }
  } catch { /* pre-migration */ }

  // ── CPU library lifecycle (shared master content — no hospital_id)
  const cpus = { total: 0, published: 0, draft: 0, inReview: 0, approved: 0, archived: 0 };
  try {
    const { data: cpuRows } = await admin.from("clinical_practice_units").select("pub_status").limit(3000);
    const rows = cpuRows ?? [];
    cpus.total = rows.length;
    cpus.published = count(rows, "pub_status", "published");
    cpus.draft = count(rows, "pub_status", "draft");
    cpus.inReview = count(rows, "pub_status", "in_review");
    cpus.approved = count(rows, "pub_status", "approved");
    cpus.archived = count(rows, "pub_status", "archived");
  } catch { /* pre-migration */ }

  // ── Position templates + adoption (Workforce Assignment Engine)
  const templates = { total: 0, active: 0, positions: 0 };
  try {
    const { data: libs } = await scopeOwnOrMaster(admin.from("position_library").select("id").limit(2000));
    const libIds = (libs ?? []).map((l: any) => l.id);
    if (libIds.length) {
      const { data: tpls } = await admin.from("position_templates").select("id, status").in("position_library_id", libIds).limit(5000);
      templates.total = (tpls ?? []).length;
      templates.active = (tpls ?? []).filter((t: any) => t.status === "active").length;
    }
    // Own-hospital position instances — independent of the template library scope,
    // so counted outside the libIds guard.
    const { count: pc } = await scopeHospital(admin.from("positions").select("id", { count: "exact", head: true }));
    templates.positions = pc ?? 0;
  } catch { /* WAE not provisioned */ }

  // ── Pending governance approvals: own+master framework/CPU reviews.
  // change_requests has no tenant column, so its global count is only added for
  // super_admin (a hospital admin must not see other tenants' change requests).
  let pendingApprovals = frameworks.inReview + cpus.inReview;
  if (isSuper) {
    try {
      const { count: cr } = await admin.from("change_requests").select("id", { count: "exact", head: true }).eq("status", "open");
      pendingApprovals += cr ?? 0;
    } catch { /* table absent */ }
  }

  // ── Competency compliance (hospital-scoped decisions)
  let compliance = { total: 0, current: 0, coverage: 0 };
  try {
    const { data: decs } = await scopeHospital(admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, created_at").order("created_at", { ascending: false }).limit(20000));
    const seen = new Set<string>(); const latest: any[] = [];
    for (const d of decs ?? []) { const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k); latest.push(d); }
    const today = new Date().toISOString().slice(0, 10);
    const current = latest.filter(d => PASSING.includes(d.outcome) && (!d.expiry_date || d.expiry_date >= today)).length;
    compliance = { total: latest.length, current, coverage: latest.length ? Math.round((current / latest.length) * 100) : 0 };
  } catch { /* pre-migration */ }

  // ── Assessment readiness (active cycles)
  let activeCycles = 0;
  try {
    const { count } = await scopeHospital(admin.from("competency_cycles").select("id", { count: "exact", head: true }).eq("status", "active"));
    activeCycles = count ?? 0;
  } catch { /* pre-migration */ }

  return { frameworks, competencyCount, cpus, templates, pendingApprovals, compliance, activeCycles };
}
