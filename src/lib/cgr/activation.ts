/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-028 — Service Activation Readiness gate (§9, over migration 151).
//
// "Before opening a new ICU service, evaluate: required competencies, available staff capability, assessor
// capacity." A service_profile states the requirements; this engine evaluates each ACTIVE profile against each
// department's real workforce:
//
//   requirement met  = staff in the department holding a CURRENT competent decision on that competency
//                      (outcome competent/competent_with_conditions, not expired) at >= min_level,
//                      counted against min_staff.
//   verdict          = NOT READY  if any CRITICAL requirement is unmet (blocks activation regardless of coverage)
//                      CONDITIONAL if criticals are met but other requirements are not
//                      READY      if every requirement is met.
//
// Level convention (documented, not hidden): a decision with maturity NULL counts as 'competent' (ordinal 3) —
// the outcome itself asserts at-least-competent; requirements above 'competent' therefore need recorded maturity.
// Assessor capacity is computed PER DEPARTMENT (CGR-025 computed it org-wide) — a service also needs the
// assessors to sustain it. Safety context stays owned by CGR-026 and is cross-linked, not recomputed.
// Draft profiles are listed but never evaluated: an ungoverned requirements set must not gate anything.

type Admin = any;
const LEVELS = ["novice", "advanced_beginner", "competent", "proficient", "expert", "mentor", "authority"];
const ord = (l: string | null | undefined) => { const i = LEVELS.indexOf(l ?? ""); return i < 0 ? 3 : i + 1; };  // null → 'competent'
const todayISO = () => new Date().toISOString().slice(0, 10);

export type GateVerdict = "ready" | "conditional" | "not_ready";

export async function loadActivationReadiness(admin: Admin) {
  const [profRes, reqRes, deptRes, staffRes, decRes, authRes] = await Promise.all([
    admin.from("service_profiles").select("id, name, code, description, status, hospital_id, created_by_name, created_at").order("created_at", { ascending: false }).limit(200),
    admin.from("service_required_competencies").select("profile_id, competency_id, min_staff, min_level, is_critical, framework_competencies ( name )").limit(2000),
    admin.from("departments").select("id, name").limit(500),
    admin.from("profiles").select("id, department_id").limit(5000),
    admin.from("competency_decisions").select("nurse_id, competency_id, outcome, maturity, expiry_date, created_at").order("created_at", { ascending: false }).limit(8000),
    admin.from("assessor_authorizations").select("user_id, status, valid_until").limit(4000),
  ]);

  if (profRes.error) return { ready: false as const, migrationMissing: /does not exist|schema cache/i.test(String(profRes.error.message ?? "")) };

  const profiles = (profRes.data ?? []) as any[];
  const reqs = (reqRes.error ? [] : reqRes.data ?? []) as any[];
  const depts = (deptRes.error ? [] : deptRes.data ?? []) as any[];
  const staff = (staffRes.error ? [] : staffRes.data ?? []) as any[];
  const decisions = (decRes.error ? [] : decRes.data ?? []) as any[];
  const auths = (authRes.error ? [] : authRes.data ?? []) as any[];
  const today = todayISO();

  // Staff per department.
  const staffByDept = new Map<string, string[]>();
  for (const s of staff) {
    if (!s.department_id) continue;
    const a = staffByDept.get(s.department_id) ?? [];
    a.push(s.id);
    staffByDept.set(s.department_id, a);
  }

  // Latest decision per (nurse, competency); qualification = current + competent(+conditions).
  const latest = new Map<string, any>();
  for (const d of decisions) {
    if (!d.nurse_id || !d.competency_id) continue;
    const k = `${d.nurse_id}|${d.competency_id}`;
    if (!latest.has(k)) latest.set(k, d);
  }
  const qualifies = (nurseId: string, compId: string, minLevel: string | null) => {
    const d = latest.get(`${nurseId}|${compId}`);
    if (!d) return false;
    if (!["competent", "competent_with_conditions"].includes(d.outcome)) return false;
    if (d.expiry_date && d.expiry_date < today) return false;
    return minLevel ? ord(d.maturity) >= ord(minLevel) : true;
  };

  // Active assessors per department (active grant, not past validity).
  const activeAssessors = new Set(auths.filter((a) => a.status === "active" && (!a.valid_until || a.valid_until >= today)).map((a) => a.user_id));
  const assessorsInDept = (deptStaff: string[]) => deptStaff.filter((id) => activeAssessors.has(id)).length;

  const reqsByProfile = new Map<string, any[]>();
  for (const r of reqs) {
    const a = reqsByProfile.get(r.profile_id) ?? [];
    const fc = Array.isArray(r.framework_competencies) ? r.framework_competencies[0] : r.framework_competencies;
    a.push({ ...r, name: fc?.name ?? "—" });
    reqsByProfile.set(r.profile_id, a);
  }

  const out = profiles.map((p) => {
    const pr = reqsByProfile.get(p.id) ?? [];
    const requirements = pr.map((r) => ({ name: r.name, minStaff: r.min_staff, minLevel: r.min_level, critical: r.is_critical }));

    // Only ACTIVE profiles gate; only departments with staff are evaluable.
    const evaluations = p.status !== "active" ? [] : depts
      .filter((d) => (staffByDept.get(d.id) ?? []).length > 0)
      .map((d) => {
        const deptStaff = staffByDept.get(d.id) ?? [];
        const results = pr.map((r) => {
          const have = deptStaff.filter((n) => qualifies(n, r.competency_id, r.min_level)).length;
          return { name: r.name, have, need: r.min_staff, critical: r.is_critical, met: have >= r.min_staff };
        });
        const criticalUnmet = results.filter((r) => r.critical && !r.met).length;
        const unmet = results.filter((r) => !r.met);
        const verdict: GateVerdict = criticalUnmet > 0 ? "not_ready" : unmet.length > 0 ? "conditional" : "ready";
        return {
          department: d.name, staff: deptStaff.length,
          met: results.length - unmet.length, total: results.length,
          coverage: results.length ? Math.round(((results.length - unmet.length) / results.length) * 100) : 0,
          criticalUnmet, unmet: unmet.slice(0, 6), verdict,
          assessors: assessorsInDept(deptStaff),
        };
      })
      .sort((a, b) => b.coverage - a.coverage);

    return {
      id: p.id, name: p.name, code: p.code, description: p.description, status: p.status,
      shared: p.hospital_id == null, createdBy: p.created_by_name ?? "—",
      requirements, criticalCount: requirements.filter((r) => r.critical).length,
      evaluations,
      readyDepts: evaluations.filter((e) => e.verdict === "ready").length,
    };
  });

  const active = out.filter((p) => p.status === "active");
  return {
    ready: true as const,
    migrationMissing: false,
    profiles: out,
    kpis: {
      profiles: out.length,
      active: active.length,
      drafts: out.filter((p) => p.status === "draft").length,
      requirements: reqs.length,
      evaluations: active.reduce((t, p) => t + p.evaluations.length, 0),
      readyPairs: active.reduce((t, p) => t + p.readyDepts, 0),
      blockedPairs: active.reduce((t, p) => t + p.evaluations.filter((e: any) => e.verdict === "not_ready").length, 0),
    },
  };
}
