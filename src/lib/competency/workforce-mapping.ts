/* eslint-disable @typescript-eslint/no-explicit-any */
// CMO-007 — Competency Workforce Mapping. Maps each ROLE to its required competency profile (from the standing
// assignment rules, cmo_assignment_rules — "this role requires these competencies") and measures real COVERAGE:
// across each role's staff, what share of the required competencies are achieved (competency_decisions). Surfaces
// mapped vs unmapped roles, per-role coverage, and the critical competency gaps (required competencies most of a
// role's staff lack). Real over cmo_assignment_rules (125) + profiles + competency_decisions (011) +
// framework_competencies. No dedicated mapping table needed — the rules ARE the role→competency map. No migration.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const ACHIEVED = ["competent", "competent_with_conditions", "provisionally_competent"];
const scoped = (q: any, hid: string | null, isSuper: boolean) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
const roleLabel = (r: string | null) => (r ?? "—").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const mapStatus = (mapped: boolean, cov: number | null) => (!mapped ? "Unmapped" : cov == null ? "No staff" : cov >= 90 ? "Fully mapped" : cov >= 50 ? "Partially mapped" : "At risk");
const statusTone = (s: string) => ({ "Fully mapped": "emerald", "Partially mapped": "amber", "At risk": "rose", Unmapped: "slate", "No staff": "slate" } as Record<string, string>)[s] ?? "slate";

export async function loadWorkforceMapping(admin: Admin, hid: string | null, isSuper: boolean) {
  // Role → required competency ids, from the standing assignment rules (the role competency profile).
  const rulesRes = await scoped(admin.from("cmo_assignment_rules").select("target_role, competency_id, competency_name, is_active").eq("is_active", true).limit(8000), hid, isSuper);
  if (rulesRes.error) return { provisioned: false as const };
  const roleReqs = new Map<string, Set<string>>();
  for (const r of (rulesRes.data ?? []) as any[]) { if (!r.target_role || !r.competency_id) continue; if (!roleReqs.has(r.target_role)) roleReqs.set(r.target_role, new Set()); roleReqs.get(r.target_role)!.add(r.competency_id); }

  // Staff by (primary) role.
  const profRes = await scoped(admin.from("profiles").select("id, role").not("role", "is", null).limit(30000), hid, isSuper);
  const staffByRole = new Map<string, string[]>();
  for (const p of (profRes.data ?? []) as any[]) { if (!staffByRole.has(p.role)) staffByRole.set(p.role, []); staffByRole.get(p.role)!.push(p.id); }
  const nurseIds = [...new Set((profRes.data ?? []).map((p: any) => p.id))] as string[];

  // Achieved competency ids per nurse.
  const achievedByNurse = new Map<string, Set<string>>();
  for (let i = 0; i < nurseIds.length; i += 2000) {
    const { data } = await admin.from("competency_decisions").select("nurse_id, competency_id, outcome").in("nurse_id", nurseIds.slice(i, i + 2000)).in("outcome", ACHIEVED).limit(60000);
    for (const d of (data ?? []) as any[]) { if (!achievedByNurse.has(d.nurse_id)) achievedByNurse.set(d.nurse_id, new Set()); achievedByNurse.get(d.nurse_id)!.add(d.competency_id); }
  }

  // Competency names for the gap list.
  const allReqIds = [...new Set([...roleReqs.values()].flatMap(s => [...s]))];
  const compName = new Map<string, string>();
  if (allReqIds.length) { const { data } = await admin.from("framework_competencies").select("id, name").in("id", allReqIds.slice(0, 3000)); (data ?? []).forEach((c: any) => compName.set(c.id, c.name)); }

  // Per-role mapping rows.
  const allRoles = new Set<string>([...staffByRole.keys(), ...roleReqs.keys()]);
  const roleRows = [...allRoles].map(role => {
    const staff = staffByRole.get(role) ?? [];
    const reqs = roleReqs.get(role);
    const required = reqs ? reqs.size : 0;
    const mapped = required > 0;
    let coverage: number | null = null;
    if (mapped && staff.length) {
      let sum = 0;
      for (const n of staff) { const ach = achievedByNurse.get(n) ?? new Set(); let hit = 0; for (const c of reqs!) if (ach.has(c)) hit++; sum += hit / required; }
      coverage = Math.round((sum / staff.length) * 100);
    }
    const status = mapStatus(mapped, coverage);
    return { role, label: roleLabel(role), staff: staff.length, required, coverage, status, tone: statusTone(status) };
  }).filter(r => r.staff > 0 || r.required > 0).sort((a, b) => (a.coverage ?? -1) - (b.coverage ?? -1) || b.staff - a.staff);

  // Critical competency gaps: required competency that <50% of a role's staff have achieved.
  const gaps: any[] = [];
  for (const [role, reqs] of roleReqs) {
    const staff = staffByRole.get(role) ?? [];
    if (!staff.length) continue;
    for (const compId of reqs) {
      const have = staff.filter(n => achievedByNurse.get(n)?.has(compId)).length;
      const pct = Math.round((have / staff.length) * 100);
      if (pct < 50) gaps.push({ role: roleLabel(role), competency: compName.get(compId) ?? "Competency", coverage: pct, affected: staff.length - have });
    }
  }
  gaps.sort((a, b) => a.coverage - b.coverage || b.affected - a.affected);

  const withStaff = roleRows.filter(r => r.staff > 0);
  const mappedRoles = withStaff.filter(r => r.status !== "Unmapped");
  const unmapped = withStaff.filter(r => r.status === "Unmapped");
  const totalStaff = nurseIds.length;
  const workforceMapped = mappedRoles.reduce((a, r) => a + r.staff, 0);
  const covScored = mappedRoles.filter(r => r.coverage != null);

  return {
    provisioned: true as const,
    kpis: {
      roles: withStaff.length,
      rolesMapped: mappedRoles.length,
      profiles: roleReqs.size,
      workforceMapped,
      mappingCoverage: totalStaff ? Math.round((workforceMapped / totalStaff) * 100) : 0,
      avgProfileCoverage: covScored.length ? Math.round(covScored.reduce((a, r) => a + (r.coverage as number), 0) / covScored.length) : null,
      unmappedRoles: unmapped.length,
      criticalGaps: gaps.filter(g => g.coverage < 25).length,
    },
    roleRows: roleRows.slice(0, 60),
    unmapped: unmapped.slice(0, 12),
    gaps: gaps.slice(0, 15),
  };
}
