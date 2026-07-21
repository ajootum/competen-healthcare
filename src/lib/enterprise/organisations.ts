// Organisations module (ENT-001 §1) loaders — directory + single-organisation
// profile. The organisation is the top tenant-level entity. All live data;
// select("*") keeps it drift-proof, fail-soft on tables added by 052.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const ORG_STATUSES = ["draft", "onboarding", "active", "suspended", "restricted", "archived", "closed"] as const;
export const ORG_TYPES = ["government", "private", "ngo", "faith_based", "academic"] as const;

const statusOf = (o: any): string => o.status ?? (o.is_active === false ? "draft" : "active");
const rolesOf = (p: any): string[] => (p.roles?.length ? p.roles : [p.role]).filter(Boolean);

export async function loadOrgDirectory(admin: any) {
  const [orgRes, hospRes, profRes, entRes] = await Promise.all([
    admin.from("organisations").select("*").order("created_at", { ascending: false }).limit(2000),
    admin.from("hospitals").select("id, organisation_id, admin_id").limit(4000),
    admin.from("profiles").select("id, organisation_id, role, roles").limit(50000),
    admin.from("enterprises").select("id, name").limit(1000),
  ]);
  const orgs = (orgRes.data ?? []) as any[];
  const hospitals = (hospRes.data ?? []) as any[];
  const profiles = (profRes.data ?? []) as any[];
  const entName = new Map<string, string>(((entRes.data ?? []) as any[]).map(e => [e.id, e.name]));

  const usersBy = new Map<string, number>();
  for (const p of profiles) if (p.organisation_id) usersBy.set(p.organisation_id, (usersBy.get(p.organisation_id) ?? 0) + 1);
  const facsBy = new Map<string, any[]>();
  for (const h of hospitals) { if (!h.organisation_id) continue; if (!facsBy.has(h.organisation_id)) facsBy.set(h.organisation_id, []); facsBy.get(h.organisation_id)!.push(h); }
  const orgAdmin = new Set(profiles.filter(p => p.organisation_id && (rolesOf(p).includes("hospital_admin") || rolesOf(p).includes("super_admin"))).map(p => p.organisation_id));

  const rows = orgs.map(o => ({
    id: o.id, name: o.name, code: o.org_code ?? null, type: o.type ?? "private",
    country: o.hq_country ?? o.region ?? "—", status: statusOf(o),
    network: o.enterprise_id ? entName.get(o.enterprise_id) ?? null : null,
    users: usersBy.get(o.id) ?? 0, facilities: (facsBy.get(o.id) ?? []).length,
    hasAdmin: orgAdmin.has(o.id) || (facsBy.get(o.id) ?? []).some((h: any) => h.admin_id),
    createdAt: o.created_at,
  }));

  const by = (s: string) => rows.filter(r => r.status === s).length;
  const summary = {
    total: rows.length, active: by("active"), onboarding: by("onboarding") + by("draft"),
    suspended: by("suspended") + by("restricted"), archived: by("archived") + by("closed"),
    noAdmin: rows.filter(r => !r.hasAdmin).length,
    countries: new Set(orgs.map(o => o.hq_country).filter(Boolean)).size,
  };
  return { rows, summary, networks: (entRes.data ?? []) as any[] };
}

export async function loadOrgProfile(admin: any, id: string) {
  const { data: org } = await admin.from("organisations").select("*").eq("id", id).maybeSingle();
  if (!org) return null;

  const [hospRes, profRes, userCountRes, entRes] = await Promise.all([
    admin.from("hospitals").select("*").eq("organisation_id", id).order("created_at", { ascending: false }),
    admin.from("profiles").select("id, full_name, email, role, roles, hospital_id, account_status, position_id").eq("organisation_id", id).limit(5000),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("organisation_id", id),
    org.enterprise_id ? admin.from("enterprises").select("id, name").eq("id", org.enterprise_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const facilities = (hospRes.data ?? []) as any[];
  const users = (profRes.data ?? []) as any[];
  // Exact total — the users[] list is capped for display, so the KPI must not
  // silently under-report a large organisation.
  const userCount = userCountRes.count ?? users.length;
  const facIds = facilities.map(f => f.id);

  // Structure counts across the org's facilities.
  let departments = 0, units = 0;
  if (facIds.length) {
    const depRes = await admin.from("departments").select("id, hospital_id").in("hospital_id", facIds).limit(8000);
    const deps = (depRes.data ?? []) as any[];
    departments = deps.length;
    if (deps.length) { const uRes = await admin.from("units").select("id", { count: "exact", head: true }).in("department_id", deps.map(d => d.id)); units = uRes.count ?? 0; }
  }

  // Subscription (fail-soft) + audit (fail-soft).
  const [subRes, auditRes] = await Promise.all([
    org.tenant_id ? admin.from("plat_subscriptions").select("status, renews_at, trial_ends_at, seats_purchased, plan_id").eq("tenant_id", org.tenant_id).order("created_at", { ascending: false }).limit(1) : Promise.resolve({ data: [], error: null }),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").eq("entity_type", "organisation").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
  ]);
  const subscription = subRes.error ? null : (subRes.data ?? [])[0] ?? null;
  const audit = auditRes.error ? [] : ((auditRes.data ?? []) as any[]);

  const admins = users.filter(u => rolesOf(u).includes("hospital_admin") || rolesOf(u).includes("super_admin"));
  const roleTally: Record<string, number> = {};
  for (const u of users) for (const r of rolesOf(u)) roleTally[r] = (roleTally[r] ?? 0) + 1;

  return {
    org: {
      id: org.id, name: org.name, legalName: org.legal_name ?? null, code: org.org_code ?? null,
      type: org.type ?? "private", country: org.hq_country ?? "—", region: org.region ?? null,
      status: statusOf(org), website: org.website ?? null, email: org.email ?? null, phone: org.phone ?? null,
      description: org.description ?? null, network: (entRes as any).data ?? null, tenantId: org.tenant_id ?? null,
    },
    facilities: facilities.map(f => ({ id: f.id, name: f.name, type: f.type, country: f.country, city: f.city, status: f.status ?? (f.admin_id ? "active" : "onboarding"), hasAdmin: !!f.admin_id })),
    users: users.map(u => ({ id: u.id, name: u.full_name, email: u.email, roles: rolesOf(u), status: u.account_status ?? "active" })),
    userCount,
    admins: admins.map(a => ({ id: a.id, name: a.full_name, email: a.email })),
    structure: { facilities: facilities.length, departments, units },
    roleTally, subscription, audit, auditReady: !auditRes.error,
  };
}
