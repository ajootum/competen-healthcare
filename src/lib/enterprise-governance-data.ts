// Enterprise Governance Workspace data (EGV-001) — multi-organisation governance:
// enterprise standards, cross-org benchmarking, regulatory compliance and
// enterprise analytics across the organisations in an enterprise GROUP.
//
// Tenant model: an enterprise is a set of organisations sharing a non-empty
// organisations.group_name. Scope is FAIL-SAFE — a non-super admin only ever
// sees organisations that share their org's exact group_name; a null/empty group
// scopes to their own organisation alone (never matching other null-group orgs,
// which would leak). super_admin governs the whole platform. Master frameworks
// (hospital_id null) are the shared standards library, visible to all.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];

export type OrgRow = {
  id: string; name: string;
  facilities: number; users: number;
  compTotal: number; compCurrent: number; compPct: number | null;
  auditN: number; auditPct: number | null;
};

// Fetch rows by hospital_id: global for super, chunked .in() otherwise so a large
// id list can never overflow the GET URL.
async function fetchByHospital(admin: any, table: string, select: string, isSuper: boolean, hospIds: string[], cap: number, orderCol?: string) {
  const q = (base: any) => { let x = base.select(select); if (orderCol) x = x.order(orderCol, { ascending: false }); return x; };
  if (isSuper) { const { data } = await q(admin.from(table)).limit(cap); return data ?? []; }
  const out: any[] = [];
  for (let i = 0; i < hospIds.length; i += 200) {
    const { data } = await q(admin.from(table)).in("hospital_id", hospIds.slice(i, i + 200)).limit(cap);
    if (data) out.push(...data);
  }
  return out;
}

export async function loadEnterpriseGovernance(admin: any, hid: string | null, isSuper: boolean) {
  const today = new Date().toISOString().slice(0, 10);

  // ── Resolve the enterprise organisation set ────────────────────────────────
  let orgs: any[] = [];
  let enterpriseName = "Enterprise";
  let scopeMode: "platform" | "group" | "single" = "single";
  if (isSuper) {
    const { data } = await admin.from("organisations").select("id, name, group_name").limit(2000);
    orgs = data ?? [];
    scopeMode = "platform";
    enterpriseName = "All organisations";
  } else {
    // A non-super admin is scoped to their OWN organisation only. group_name is
    // free text with no uniqueness/ownership guarantee, so it cannot be trusted
    // as a cross-tenant boundary — spanning organisations by it could merge two
    // unrelated enterprises that happen to share a value. Cross-organisation
    // governance is therefore a platform (super_admin) capability.
    const { data: hosp } = await admin.from("hospitals").select("organisation_id").eq("id", hid ?? NONE).limit(1);
    const myOrgId = (hosp ?? [])[0]?.organisation_id ?? null;
    if (myOrgId) {
      const { data: mine } = await admin.from("organisations").select("id, name, group_name").eq("id", myOrgId).limit(1);
      const mo = (mine ?? [])[0];
      orgs = mo ? [mo] : [];
      scopeMode = "single";
      enterpriseName = mo?.name ?? "—";
    }
  }
  const orgIds: string[] = orgs.map(o => o.id);
  const orgName = new Map<string, string>(orgs.map(o => [o.id, o.name ?? "—"]));

  // ── Facilities → organisation map ──────────────────────────────────────────
  let hospitals: any[] = [];
  if (orgIds.length) {
    const out: any[] = [];
    for (let i = 0; i < orgIds.length; i += 200) {
      const { data } = await admin.from("hospitals").select("id, organisation_id").in("organisation_id", orgIds.slice(i, i + 200)).limit(8000);
      if (data) out.push(...data);
    }
    hospitals = out;
  }
  const hospToOrg = new Map<string, string>(hospitals.map(h => [h.id, h.organisation_id]));
  const hospIds: string[] = hospitals.map(h => h.id);

  // ── Per-org aggregates ─────────────────────────────────────────────────────
  const agg = new Map<string, OrgRow>();
  for (const id of orgIds) agg.set(id, { id, name: orgName.get(id) ?? "—", facilities: 0, users: 0, compTotal: 0, compCurrent: 0, compPct: null, auditN: 0, auditPct: null });
  for (const h of hospitals) { const r = agg.get(h.organisation_id); if (r) r.facilities++; }

  // Users per org
  const profs = orgIds.length ? await fetchByHospital(admin, "profiles", "hospital_id", isSuper, hospIds, 40000) : [];
  for (const p of profs) { const o = hospToOrg.get(p.hospital_id); const r = o && agg.get(o); if (r) r.users++; }

  // Competency currency per org (latest decision per nurse+competency). Ordered
  // newest-first at the DB so, if the cap is hit, we keep the most recent
  // decisions — the ones that survive the latest-per-pair dedup.
  const decs = orgIds.length ? await fetchByHospital(admin, "competency_decisions", "nurse_id, competency_id, outcome, expiry_date, created_at, hospital_id", isSuper, hospIds, 60000, "created_at") : [];
  decs.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const seen = new Set<string>();
  for (const dRow of decs) {
    const k = `${dRow.nurse_id}:${dRow.competency_id}`;
    if (seen.has(k)) continue; seen.add(k);
    const o = hospToOrg.get(dRow.hospital_id); const r = o && agg.get(o);
    if (!r) continue;
    r.compTotal++;
    if (PASSING.includes(dRow.outcome) && (!dRow.expiry_date || dRow.expiry_date >= today)) r.compCurrent++;
  }

  // Quality/regulatory compliance per org (avg compliance of completed audits)
  const auditSum = new Map<string, number>();
  const audits = orgIds.length ? await fetchByHospital(admin, "audits", "status, compliance_pct, hospital_id", isSuper, hospIds, 20000) : [];
  for (const a of audits) {
    if (a.status !== "completed" || a.compliance_pct == null) continue;
    const o = hospToOrg.get(a.hospital_id); const r = o && agg.get(o);
    if (!r) continue;
    r.auditN++;
    auditSum.set(o!, (auditSum.get(o!) ?? 0) + Number(a.compliance_pct));
  }
  for (const r of agg.values()) {
    r.compPct = r.compTotal ? Math.round((r.compCurrent / r.compTotal) * 100) : null;
    r.auditPct = r.auditN ? Math.round((auditSum.get(r.id) ?? 0) / r.auditN) : null;
  }

  const benchmark: OrgRow[] = [...agg.values()].sort((a, b) => (b.compPct ?? -1) - (a.compPct ?? -1));

  // ── Enterprise standards (shared master framework library) ─────────────────
  const standards = { total: 0, published: 0, draft: 0, other: 0, compliancePct: null as number | null };
  try {
    const { data: fw } = await admin.from("frameworks").select("pub_status").is("hospital_id", null).eq("is_active", true).limit(3000);
    const rows = fw ?? [];
    standards.total = rows.length;
    standards.published = rows.filter((f: any) => f.pub_status === "published").length;
    standards.draft = rows.filter((f: any) => f.pub_status === "draft").length;
    standards.other = standards.total - standards.published - standards.draft;
    standards.compliancePct = standards.total ? Math.round((standards.published / standards.total) * 100) : null;
  } catch { /* pre-migration */ }

  // ── Enterprise KPIs (averages over orgs that HAVE data) ────────────────────
  const withComp = benchmark.filter(o => o.compPct != null);
  const withAudit = benchmark.filter(o => o.auditPct != null);
  const kpis = {
    organisations: orgs.length,
    facilities: hospitals.length,
    users: profs.length,
    avgCompetency: withComp.length ? Math.round(withComp.reduce((s, o) => s + (o.compPct ?? 0), 0) / withComp.length) : null,
    avgCompliance: withAudit.length ? Math.round(withAudit.reduce((s, o) => s + (o.auditPct ?? 0), 0) / withAudit.length) : null,
    standardsCompliance: standards.compliancePct,
  };

  // ── Strategic governance alerts ────────────────────────────────────────────
  const alerts: { icon: string; text: string; tone: string }[] = [];
  for (const o of benchmark) {
    if (o.compPct != null && o.compPct < 60) alerts.push({ icon: "🔴", text: `${o.name}: competency currency ${o.compPct}% — below governance threshold`, tone: "red" });
    else if (o.compTotal === 0 && o.facilities > 0) alerts.push({ icon: "⚪", text: `${o.name}: no competency decisions recorded yet`, tone: "gray" });
    if (o.auditN === 0 && o.facilities > 0) alerts.push({ icon: "⚠️", text: `${o.name}: no completed quality audits`, tone: "amber" });
  }
  if (standards.draft > 0) alerts.push({ icon: "📝", text: `${standards.draft} enterprise standard${standards.draft !== 1 ? "s" : ""} in draft — pending publication`, tone: "amber" });

  // Disclose when a fetch hit its cap, so large-platform figures are never
  // presented as complete when they are actually a most-recent-N sample.
  const truncated = profs.length >= 40000 || decs.length >= 60000 || audits.length >= 20000;

  return { enterpriseName, scopeMode, orgs, kpis, benchmark, standards, alerts, truncated, isSuper };
}
