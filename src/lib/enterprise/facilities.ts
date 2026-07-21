// Facilities module (ENT-001 §3) loaders — directory + single-facility profile.
// A facility is a hospital/clinic/campus (the `hospitals` table). Live data;
// select("*") is drift-proof, fail-soft on 052 tables (divisions/services/audit).
/* eslint-disable @typescript-eslint/no-explicit-any */

export const FACILITY_TYPES = ["hospital", "clinic", "health_center", "nursing_home", "diagnostic_center"] as const;
export const FACILITY_STATUSES = ["draft", "onboarding", "active", "suspended", "archived"] as const;

const statusOf = (h: any): string => h.status ?? (h.admin_id ? "active" : "onboarding");
const rolesOf = (p: any): string[] => (p.roles?.length ? p.roles : [p.role]).filter(Boolean);

export async function loadFacilityDirectory(admin: any) {
  const [hospRes, orgRes, deptRes, profRes] = await Promise.all([
    admin.from("hospitals").select("*").order("created_at", { ascending: false }).limit(4000),
    admin.from("organisations").select("id, name").limit(2000),
    admin.from("departments").select("id, hospital_id").limit(8000),
    admin.from("profiles").select("id, hospital_id").limit(50000),
  ]);
  const hospitals = (hospRes.data ?? []) as any[];
  const orgName = new Map<string, string>(((orgRes.data ?? []) as any[]).map(o => [o.id, o.name]));
  const deptBy = new Map<string, number>();
  for (const d of (deptRes.data ?? []) as any[]) deptBy.set(d.hospital_id, (deptBy.get(d.hospital_id) ?? 0) + 1);
  const userBy = new Map<string, number>();
  for (const p of (profRes.data ?? []) as any[]) if (p.hospital_id) userBy.set(p.hospital_id, (userBy.get(p.hospital_id) ?? 0) + 1);

  const rows = hospitals.map(h => ({
    id: h.id, name: h.name, code: h.facility_code ?? null, type: h.type ?? "hospital",
    org: h.organisation_id ? orgName.get(h.organisation_id) ?? null : null,
    country: h.country ?? "—", city: h.city ?? null, tier: h.tier ?? "free", status: statusOf(h),
    departments: deptBy.get(h.id) ?? 0, users: userBy.get(h.id) ?? 0, hasAdmin: !!h.admin_id,
  }));
  const by = (s: string) => rows.filter(r => r.status === s).length;
  const summary = {
    total: rows.length, active: by("active"), onboarding: by("onboarding") + by("draft"),
    unlinked: rows.filter(r => !r.org).length, noAdmin: rows.filter(r => !r.hasAdmin).length,
    countries: new Set(hospitals.map(h => h.country).filter(Boolean)).size,
  };
  return { rows, summary, orgs: (orgRes.data ?? []) as any[] };
}

export async function loadFacilityProfile(admin: any, id: string) {
  const { data: h } = await admin.from("hospitals").select("*").eq("id", id).maybeSingle();
  if (!h) return null;

  const [orgRes, divRes, deptRes, profRes, svcRes, auditRes] = await Promise.all([
    h.organisation_id ? admin.from("organisations").select("id, name").eq("id", h.organisation_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("ent_divisions").select("id, name").eq("hospital_id", id),
    admin.from("departments").select("*").eq("hospital_id", id),
    admin.from("profiles").select("id, full_name, email, role, roles, account_status").eq("hospital_id", id).limit(5000),
    admin.from("ent_services").select("id, name, category").or(`hospital_id.eq.${id}${h.organisation_id ? `,organisation_id.eq.${h.organisation_id}` : ""}`).limit(2000),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").eq("entity_type", "facility").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
  ]);
  const departments = (deptRes.data ?? []) as any[];
  const users = (profRes.data ?? []) as any[];
  const deptIds = departments.map(d => d.id);
  let units = 0;
  if (deptIds.length) { const uRes = await admin.from("units").select("id", { count: "exact", head: true }).in("department_id", deptIds); units = uRes.count ?? 0; }
  const userCountRes = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("hospital_id", id);

  const services = svcRes.error ? [] : ((svcRes.data ?? []) as any[]);
  const divisions = divRes.error ? [] : ((divRes.data ?? []) as any[]);
  const audit = auditRes.error ? [] : ((auditRes.data ?? []) as any[]);

  // Leadership: named profiles for director/admin + department heads.
  const leaderIds = [h.director_id, h.admin_id, ...departments.map(d => d.head_id)].filter(Boolean);
  const leaders = new Map<string, string>();
  if (leaderIds.length) { const { data: lp } = await admin.from("profiles").select("id, full_name").in("id", leaderIds); for (const p of (lp ?? []) as any[]) leaders.set(p.id, p.full_name); }

  return {
    facility: {
      id: h.id, name: h.name, code: h.facility_code ?? null, type: h.type ?? "hospital",
      org: (orgRes as any).data ?? null, country: h.country ?? "—", city: h.city ?? null, tier: h.tier ?? "free",
      status: statusOf(h), director: h.director_id ? leaders.get(h.director_id) ?? null : null, admin: h.admin_id ? leaders.get(h.admin_id) ?? null : null,
    },
    departments: departments.map(d => ({ id: d.id, name: d.name, code: d.code ?? null, type: d.dept_type ?? d.specialty ?? null, head: d.head_id ? leaders.get(d.head_id) ?? null : null, status: d.status ?? (d.is_active === false ? "archived" : "active") })),
    users: users.map(u => ({ id: u.id, name: u.full_name, email: u.email, roles: rolesOf(u), status: u.account_status ?? "active" })),
    userCount: userCountRes.count ?? users.length,
    services, divisions,
    structure: { divisions: divisions.length, departments: departments.length, units },
    audit, auditReady: !auditRes.error,
  };
}
