// Networks & Enterprise Groups module (ENT-001 §2) loaders — directory + single
// network profile. Networks are the `enterprises` table; member organisations
// link via organisations.enterprise_id. Live data; fail-soft on audit.
/* eslint-disable @typescript-eslint/no-explicit-any */

const statusOf = (o: any): string => o.status ?? (o.is_active === false ? "draft" : "active");

export async function loadNetworkDirectory(admin: any) {
  const [entRes, orgRes, hospRes, profRes] = await Promise.all([
    admin.from("enterprises").select("*").order("created_at", { ascending: false }).limit(1000),
    admin.from("organisations").select("id, name, enterprise_id, hq_country").limit(2000),
    admin.from("hospitals").select("id, organisation_id, country").limit(4000),
    admin.from("profiles").select("id, organisation_id").limit(50000),
  ]);
  const enterprises = (entRes.data ?? []) as any[];
  const orgs = (orgRes.data ?? []) as any[];
  const hospitals = (hospRes.data ?? []) as any[];
  const profiles = (profRes.data ?? []) as any[];

  const orgsByEnt = new Map<string, any[]>();
  for (const o of orgs) { if (!o.enterprise_id) continue; if (!orgsByEnt.has(o.enterprise_id)) orgsByEnt.set(o.enterprise_id, []); orgsByEnt.get(o.enterprise_id)!.push(o); }
  const facsByOrg = new Map<string, any[]>();
  for (const h of hospitals) { if (!h.organisation_id) continue; if (!facsByOrg.has(h.organisation_id)) facsByOrg.set(h.organisation_id, []); facsByOrg.get(h.organisation_id)!.push(h); }
  const usersByOrg = new Map<string, number>();
  for (const p of profiles) if (p.organisation_id) usersByOrg.set(p.organisation_id, (usersByOrg.get(p.organisation_id) ?? 0) + 1);

  const rows = enterprises.map(e => {
    const members = orgsByEnt.get(e.id) ?? [];
    const facs = members.flatMap(m => facsByOrg.get(m.id) ?? []);
    const countries = new Set<string>([e.hq_country, ...members.map(m => m.hq_country), ...facs.map(f => f.country)].filter(Boolean));
    const users = members.reduce((s, m) => s + (usersByOrg.get(m.id) ?? 0), 0);
    return {
      id: e.id, name: e.name, type: e.health_system_type ?? "network", hq: e.hq_country ?? "—",
      status: e.is_active === false ? "inactive" : "active",
      members: members.length, facilities: facs.length, users, countries: countries.size, createdAt: e.created_at,
    };
  });
  const unassignedOrgs = orgs.filter(o => !o.enterprise_id).length;
  const summary = {
    total: rows.length, active: rows.filter(r => r.status === "active").length,
    memberOrgs: orgs.filter(o => o.enterprise_id).length, unassignedOrgs,
    countries: new Set(enterprises.map(e => e.hq_country).filter(Boolean)).size,
  };
  return { rows, summary };
}

export async function loadNetworkProfile(admin: any, id: string) {
  const { data: ent } = await admin.from("enterprises").select("*").eq("id", id).maybeSingle();
  if (!ent) return null;

  const [orgRes, auditRes] = await Promise.all([
    admin.from("organisations").select("*").eq("enterprise_id", id).order("created_at", { ascending: false }),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").eq("entity_type", "enterprise").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
  ]);
  const members = (orgRes.data ?? []) as any[];
  const memberIds = members.map(m => m.id);

  let facilities = 0, users = 0;
  const byCountry = new Map<string, number>();
  // "Countries" is the SAME definition as the directory (loadNetworkDirectory):
  // the deduped union of network HQ + member-org countries + facility countries,
  // so a network reports one consistent number across both views.
  const countrySet = new Set<string>();
  if (ent.hq_country) countrySet.add(ent.hq_country);
  if (memberIds.length) {
    const [hRes, pRes] = await Promise.all([
      admin.from("hospitals").select("id, organisation_id, country").in("organisation_id", memberIds).limit(4000),
      admin.from("profiles").select("id", { count: "exact", head: true }).in("organisation_id", memberIds),
    ]);
    const hs = (hRes.data ?? []) as any[];
    facilities = hs.length;
    users = pRes.count ?? 0;
    for (const m of members) { const cc = m.hq_country ?? "—"; byCountry.set(cc, (byCountry.get(cc) ?? 0) + 1); if (m.hq_country) countrySet.add(m.hq_country); }
    for (const h of hs) if (h.country) countrySet.add(h.country);
  }
  const audit = auditRes.error ? [] : ((auditRes.data ?? []) as any[]);

  return {
    network: {
      id: ent.id, name: ent.name, type: ent.health_system_type ?? "network", hq: ent.hq_country ?? "—",
      status: ent.is_active === false ? "inactive" : "active", createdAt: ent.created_at, tenantId: ent.tenant_id ?? null,
    },
    members: members.map(m => ({ id: m.id, name: m.name, type: m.type ?? "private", country: m.hq_country ?? "—", status: statusOf(m) })),
    counts: { members: members.length, facilities, users, countries: countrySet.size },
    countries: [...byCountry.entries()].map(([country, n]) => ({ country, orgs: n })).sort((a, b) => b.orgs - a.orgs),
    audit, auditReady: !auditRes.error,
  };
}
