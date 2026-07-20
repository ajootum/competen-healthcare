// Organisation Administration Workspace data (ADM-001) — the enterprise admin
// hub: organisation hierarchy, facilities, departments, users, role assignments,
// position templates, integration health and the administrative audit trail.
//
// Scoping: an organisation owns many hospitals (facilities). We resolve the org
// from the admin's hospital_id, then scope facilities by organisation_id and
// users/departments/position libraries by the org's hospital ids. audit_log has
// NO tenant column, so recent rows are fetched and filtered in-JS to in-scope
// actor ids BEFORE display — never exposing another org's activity. super_admin
// sees the platform-wide view.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

export type Facility = { id: string; name: string | null; city: string | null; country: string | null; tier: string | null; depts: number; users: number };
export type AuditRow = { actor_name: string | null; action: string | null; entity_name: string | null; entity_type: string | null; created_at: string | null };
export type RoleBar = { label: string; count: number };
export type Integration = { name: string; status: "live" | "native" | "off"; detail: string };

export async function loadOrgAdminDashboard(admin: any, hid: string | null, isSuper: boolean) {
  const since = new Date(); since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  // ── Resolve organisation + facilities ──────────────────────────────────────
  let orgId: string | null = null;
  let orgName = "—";
  let orgCount = 1;
  let hospitals: any[] = [];
  if (isSuper) {
    const [{ data: hs }, { count: oc }] = await Promise.all([
      admin.from("hospitals").select("id, name, city, country, tier, created_at").limit(3000),
      admin.from("organisations").select("id", { count: "exact", head: true }),
    ]);
    hospitals = hs ?? [];
    orgCount = oc ?? 0;
    orgName = "All organisations";
  } else {
    const { data: hosp } = await admin.from("hospitals").select("organisation_id").eq("id", hid ?? NONE).limit(1);
    orgId = (hosp ?? [])[0]?.organisation_id ?? null;
    if (orgId) {
      const [{ data: org }, { data: hs }] = await Promise.all([
        admin.from("organisations").select("name").eq("id", orgId).limit(1),
        admin.from("hospitals").select("id, name, city, country, tier, created_at").eq("organisation_id", orgId).limit(3000),
      ]);
      orgName = (org ?? [])[0]?.name ?? "—";
      hospitals = hs ?? [];
    } else if (hid) {
      // Org not resolvable — fail closed to just this facility, never global.
      const { data: hs } = await admin.from("hospitals").select("id, name, city, country, tier, created_at").eq("id", hid).limit(1);
      hospitals = hs ?? [];
    }
  }
  const hospIds: string[] = hospitals.map(h => h.id);
  const scopeHosp = (q: any) => (isSuper ? q : q.in("hospital_id", hospIds.length ? hospIds : [NONE]));

  // ── Users + departments (org-scoped) ───────────────────────────────────────
  let profiles: any[] = [];
  let departments: any[] = [];
  if (isSuper || hospIds.length) {
    const [{ data: profs }, { data: depts }] = await Promise.all([
      scopeHosp(admin.from("profiles").select("id, full_name, email, role, roles, org_role, hospital_id, created_at").order("created_at", { ascending: false }).limit(5000)),
      scopeHosp(admin.from("departments").select("id, name, hospital_id, specialty").limit(3000)),
    ]);
    profiles = profs ?? [];
    departments = depts ?? [];
  }
  const profileIds = new Set<string>(profiles.map(p => p.id));

  // Per-facility rollup
  const deptByHosp = new Map<string, number>();
  for (const d of departments) deptByHosp.set(d.hospital_id, (deptByHosp.get(d.hospital_id) ?? 0) + 1);
  const userByHosp = new Map<string, number>();
  for (const p of profiles) if (p.hospital_id) userByHosp.set(p.hospital_id, (userByHosp.get(p.hospital_id) ?? 0) + 1);
  // Users not mapped to a listed facility (null hospital_id, or — in the
  // platform-wide super view — beyond the facility cap). 0 for org admins, whose
  // profiles are scoped to exactly these facilities, so the KPI and per-facility
  // rollup always reconcile.
  const hospIdSet = new Set<string>(hospIds);
  const usersUnattached = profiles.filter(p => !p.hospital_id || !hospIdSet.has(p.hospital_id)).length;
  const facilities: Facility[] = hospitals.map(h => ({
    id: h.id, name: h.name, city: h.city, country: h.country, tier: h.tier,
    depts: deptByHosp.get(h.id) ?? 0, users: userByHosp.get(h.id) ?? 0,
  }));

  // ── Role assignment metrics (by org role) ──────────────────────────────────
  const orgRoleMap = new Map<string, number>();
  let assignedOrgRoles = 0;
  for (const p of profiles) {
    const r = p.org_role ?? null;
    if (r) { assignedOrgRoles++; orgRoleMap.set(r, (orgRoleMap.get(r) ?? 0) + 1); }
    else orgRoleMap.set("unassigned", (orgRoleMap.get("unassigned") ?? 0) + 1);
  }
  const roleBars: RoleBar[] = [...orgRoleMap.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  const users = {
    total: profiles.length,
    newUsers30d: profiles.filter(p => p.created_at && p.created_at >= sinceIso).length,
    assignedOrgRoles,
    unassignedRoles: profiles.length - assignedOrgRoles,
  };

  // ── Position templates. super_admin counts all templates directly; org admins
  // resolve through their bounded library set, chunking the id list so a large
  // .in() can never overflow the GET URL and silently return zero.
  const templates = { total: 0, active: 0, draft: 0, retired: 0 };
  try {
    let tpls: any[] = [];
    if (isSuper) {
      const { data } = await admin.from("position_templates").select("status").limit(20000);
      tpls = data ?? [];
    } else {
      const { data: libs } = await admin.from("position_library").select("id").in("hospital_id", hospIds.length ? hospIds : [NONE]).limit(5000);
      const libIds = (libs ?? []).map((l: any) => l.id);
      for (let i = 0; i < libIds.length; i += 200) {
        const { data } = await admin.from("position_templates").select("status").in("position_library_id", libIds.slice(i, i + 200)).limit(8000);
        if (data) tpls.push(...data);
      }
    }
    templates.total = tpls.length;
    templates.active = tpls.filter((t: any) => t.status === "active").length;
    templates.draft = tpls.filter((t: any) => t.status === "draft").length;
    templates.retired = tpls.filter((t: any) => t.status === "retired").length;
  } catch { /* WAE not provisioned */ }

  // ── Administrative audit trail (fetch recent, filter to in-scope actors) ────
  const audit = { recent: [] as AuditRow[], total: 0, distinctActions: 0, actionBars: [] as RoleBar[] };
  try {
    const { data } = await admin.from("audit_log").select("actor_id, actor_name, action, entity_name, entity_type, created_at").order("created_at", { ascending: false }).limit(2000);
    const all = data ?? [];
    const rows = isSuper ? all : all.filter((r: any) => r.actor_id && profileIds.has(r.actor_id));
    audit.total = rows.length;
    const actionMap = new Map<string, number>();
    for (const r of rows) if (r.action) actionMap.set(r.action, (actionMap.get(r.action) ?? 0) + 1);
    audit.distinctActions = actionMap.size;
    audit.actionBars = [...actionMap.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    audit.recent = rows.slice(0, 50).map((r: any) => ({ actor_name: r.actor_name, action: r.action, entity_name: r.entity_name, entity_type: r.entity_type, created_at: r.created_at }));
  } catch { /* ignore */ }

  // ── Integration health (only report what is genuinely wired) ───────────────
  // "live" requires the provider the client actually supports end-to-end
  // (Anthropic) — a key for another provider is configured but not operational.
  const ai = await import("@/lib/ai/config").then((m: any) => m.aiStatus?.() ?? { configured: false, provider: null }).catch(() => ({ configured: false, provider: null }));
  const aiLive = !!ai.configured && ai.provider === "anthropic";
  const integrations: Integration[] = [
    { name: "AI Intelligence Layer", status: aiLive ? "live" : "off", detail: aiLive ? "Model provider configured (Anthropic)" : ai.configured ? `${ai.provider === "openai" ? "OpenAI" : ai.provider === "gemini" ? "Gemini" : "Provider"} key set — not yet wired end-to-end` : "No model provider key set" },
    { name: "Workforce Assignment Engine", status: "native", detail: "Platform-native · position templates → provisioning" },
    { name: "Competency Engine", status: "native", detail: "Platform-native" },
    { name: "Learning Engine", status: "native", detail: "Platform-native" },
    { name: "Assessment Engine", status: "native", detail: "Platform-native" },
    { name: "Notification Engine", status: "native", detail: "Platform-native" },
    { name: "External integrations", status: "off", detail: "No external systems connected" },
  ];
  const integrationHealth = { live: integrations.filter(i => i.status === "live").length, native: integrations.filter(i => i.status === "native").length, off: integrations.filter(i => i.status === "off").length };

  return {
    summary: { orgName, orgId, orgCount, facilities: hospitals.length, departments: departments.length, users: profiles.length, newUsers30d: users.newUsers30d, usersUnattached },
    facilities, departments, profiles, users, roleBars, templates, audit, integrations, integrationHealth, isSuper,
  };
}
