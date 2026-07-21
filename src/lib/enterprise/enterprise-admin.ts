// Enterprise Administration overview loader (ENT-001). Aggregates the real
// organisational hierarchy — enterprises → organisations → facilities →
// departments → units, plus positions, services, templates and people — into
// the section dashboard: KPI ribbon, structure explorer, onboarding pipeline,
// setup issues, activity and top organisations. Everything is live data; where a
// column/table is not provisioned yet the dependent figure degrades to a null /
// honest state rather than a fabricated number. Queries use select("*") on core
// tables so newly-added columns (052) are read when present and ignored when not.
/* eslint-disable @typescript-eslint/no-explicit-any */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EnterpriseAdmin = Awaited<ReturnType<typeof loadEnterpriseAdmin>>;

export async function loadEnterpriseAdmin(admin: any) {
  const [entRes, orgRes, hospRes, deptRes, unitRes, profRes, posRes] = await Promise.all([
    admin.from("enterprises").select("id, name, health_system_type, hq_country, is_active, created_at").limit(1000),
    admin.from("organisations").select("*").order("created_at", { ascending: false }).limit(2000),
    admin.from("hospitals").select("*").order("created_at", { ascending: false }).limit(4000),
    admin.from("departments").select("*").limit(8000),
    admin.from("units").select("*").limit(20000),
    admin.from("profiles").select("id, full_name, email, role, roles, organisation_id, hospital_id, department_id, created_at").limit(50000),
    admin.from("positions").select("id, title, department_id, hospital_id, status").limit(8000),
  ]);

  const enterprises = (entRes.data ?? []) as any[];
  const orgs = (orgRes.data ?? []) as any[];
  const hospitals = (hospRes.data ?? []) as any[];
  const departments = (deptRes.data ?? []) as any[];
  const units = (unitRes.data ?? []) as any[];
  const profiles = (profRes.data ?? []) as any[];
  const positions = (posRes.data ?? []) as any[];

  // Fail-soft: tables/columns added by migration 052 may not be applied yet.
  const [svcRes, tplRes, platTplRes, auditRes] = await Promise.all([
    admin.from("ent_services").select("id, organisation_id, name, category, is_active").limit(8000),
    admin.from("ent_templates").select("id, name, template_type, status").limit(2000),
    admin.from("plat_org_templates").select("id, name, is_active").limit(2000),
    admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  const services = svcRes.error ? [] : ((svcRes.data ?? []) as any[]);
  const entTemplates = tplRes.error ? [] : ((tplRes.data ?? []) as any[]);
  const platTemplates = platTplRes.error ? [] : ((platTplRes.data ?? []) as any[]);
  const templatesReady = !tplRes.error || !platTplRes.error;
  const auditReady = !auditRes.error;
  const audit = auditReady ? ((auditRes.data ?? []) as any[]) : [];

  const rolesOf = (p: any): string[] => (p.roles?.length ? p.roles : [p.role]).filter(Boolean);
  const orgStatus = (o: any): string => o.status ?? (o.is_active === false ? "draft" : "active");

  // ── KPI ribbon ────────────────────────────────────────────────────────────
  const pendingSetups = orgs.filter(o => ["draft", "onboarding", "restricted"].includes(orgStatus(o))).length
    + hospitals.filter(h => !h.admin_id).length;
  const kpis = {
    organisations: orgs.length,
    networks: enterprises.length,
    facilities: hospitals.length,
    users: profiles.length,
    departments: departments.length,
    units: units.length,
    positions: positions.length,
    services: svcRes.error ? null : services.length,
    templates: templatesReady ? entTemplates.length + platTemplates.length : null,
    pendingSetups,
  };

  // ── Enterprise structure explorer (network → org → facility → dept → unit) ──
  const unitsByDept = new Map<string, any[]>();
  for (const u of units) { const k = u.department_id; if (!unitsByDept.has(k)) unitsByDept.set(k, []); unitsByDept.get(k)!.push(u); }
  const deptsByHosp = new Map<string, any[]>();
  for (const d of departments) { const k = d.hospital_id; if (!deptsByHosp.has(k)) deptsByHosp.set(k, []); deptsByHosp.get(k)!.push(d); }
  const hospByOrg = new Map<string | null, any[]>();
  for (const h of hospitals) { const k = h.organisation_id ?? null; if (!hospByOrg.has(k)) hospByOrg.set(k, []); hospByOrg.get(k)!.push(h); }
  const orgByEnt = new Map<string | null, any[]>();
  for (const o of orgs) { const k = o.enterprise_id ?? null; if (!orgByEnt.has(k)) orgByEnt.set(k, []); orgByEnt.get(k)!.push(o); }

  const buildOrg = (o: any) => {
    const facs = hospByOrg.get(o.id) ?? [];
    return {
      id: o.id, name: o.name, kind: "organisation" as const, status: orgStatus(o),
      facilities: facs.map(h => ({
        id: h.id, name: h.name, kind: "facility" as const, active: !!h.admin_id, country: h.country,
        departments: (deptsByHosp.get(h.id) ?? []).map(d => ({
          id: d.id, name: d.name, kind: "department" as const,
          units: (unitsByDept.get(d.id) ?? []).map(u => ({ id: u.id, name: u.name, kind: "unit" as const })),
        })),
      })),
    };
  };
  const explorer = enterprises.map(e => ({
    id: e.id, name: e.name, kind: "network" as const, country: e.hq_country,
    organisations: (orgByEnt.get(e.id) ?? []).map(buildOrg),
  }));
  const standaloneOrgs = (orgByEnt.get(null) ?? []).map(buildOrg);

  // ── Onboarding pipeline (real org lifecycle → the spec's 6 stages) ──────────
  const stageOf = (s: string) => ({ draft: "Draft", onboarding: "Configuration", restricted: "Administrator Review", active: "Live", suspended: "Live", archived: "Live", closed: "Live" } as any)[s] ?? "Live";
  const pipeCounts: Record<string, number> = { Draft: 0, Configuration: 0, "Data Import": 0, "Administrator Review": 0, "Ready to Launch": 0, Live: 0 };
  for (const o of orgs) pipeCounts[stageOf(orgStatus(o))]++;
  const pipeline = [
    { stage: "Draft", n: pipeCounts["Draft"], icon: "📝" },
    { stage: "Configuration", n: pipeCounts["Configuration"], icon: "⚙️" },
    { stage: "Data Import", n: pipeCounts["Data Import"], icon: "📥" },
    { stage: "Administrator Review", n: pipeCounts["Administrator Review"], icon: "🔍" },
    { stage: "Ready to Launch", n: pipeCounts["Ready to Launch"], icon: "🚀" },
    { stage: "Live", n: pipeCounts["Live"], icon: "✅" },
  ];

  // ── Setup issues (real signals; honest null where not derivable) ────────────
  const orgAdminIds = new Set(profiles.filter(p => p.organisation_id && (rolesOf(p).includes("hospital_admin") || rolesOf(p).includes("super_admin"))).map(p => p.organisation_id));
  const orgHasHospAdmin = new Set(hospitals.filter(h => h.admin_id && h.organisation_id).map(h => h.organisation_id));
  const orgsNoAdmin = orgs.filter(o => !orgAdminIds.has(o.id) && !orgHasHospAdmin.has(o.id)).length;
  const facsNoDept = hospitals.filter(h => !(deptsByHosp.get(h.id) ?? []).length).length;
  const unitsHaveManagerCol = units.some(u => "manager_id" in u);
  const unitsNoManager = unitsHaveManagerCol ? units.filter(u => !u.manager_id).length : null;
  const invalidEmails = profiles.filter(p => p.email && !EMAIL_RE.test(p.email)).length;
  const setupIssues = [
    { key: "org_admin", label: "Organisations with no administrator", n: orgsNoAdmin, href: "/super-admin/organisations", tone: "rose" },
    { key: "fac_dept", label: "Facilities with no departments", n: facsNoDept, href: "/super-admin/hospitals", tone: "orange" },
    { key: "unit_mgr", label: "Units with no manager assigned", n: unitsNoManager, href: "/super-admin/enterprise", tone: "amber" },
    { key: "bad_email", label: "Imported users with invalid emails", n: invalidEmails, href: "/super-admin/users", tone: "red" },
    { key: "pos_fw", label: "Positions without competency framework", n: null, href: "/super-admin/enterprise", tone: "violet" },
    { key: "role_ws", label: "Roles without workspace assignment", n: null, href: "/super-admin/enterprise", tone: "indigo" },
  ];

  // ── Recent activity (audit_log, fail-soft) ──────────────────────────────────
  const ICON: Record<string, string> = { organisation: "🏛️", hospital: "🏥", framework: "📐", profile: "👤", op_patient: "🧑‍⚕️", cpu: "🧩", template: "📦" };
  const activity = audit.map(a => {
    const action = a.action ? a.action.replace(/_/g, " ") : "";
    return { icon: ICON[a.entity_type ?? ""] ?? "•", title: a.entity_name || action || "Platform event", detail: a.entity_name ? [action, a.actor_name].filter(Boolean).join(" · ") : (a.actor_name ?? ""), at: a.created_at as string };
  });

  // ── Top organisations by activity (real user + facility counts) ─────────────
  const usersByOrg = new Map<string, number>();
  for (const p of profiles) if (p.organisation_id) usersByOrg.set(p.organisation_id, (usersByOrg.get(p.organisation_id) ?? 0) + 1);
  const maxUsers = Math.max(1, ...[...usersByOrg.values()]);
  const topOrgs = orgs
    .map(o => ({ id: o.id, name: o.name, country: o.hq_country ?? o.region ?? "—", users: usersByOrg.get(o.id) ?? 0, facilities: (hospByOrg.get(o.id) ?? []).length }))
    .sort((a, b) => b.users - a.users || b.facilities - a.facilities)
    .slice(0, 6)
    .map(o => ({ ...o, score: Math.round((o.users / maxUsers) * 100) }));

  return {
    kpis, explorer, standaloneOrgs, pipeline, setupIssues, activity, activityReady: auditReady, topOrgs,
    countries: new Set([...hospitals.map(h => h.country), ...orgs.map(o => o.hq_country)].filter(Boolean)).size,
    migrationApplied: !svcRes.error && (orgs.length === 0 || orgs.some(o => "status" in o)),
    generatedAt: new Date().toISOString(),
  };
}
