import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Administration ───────────────────────────────────────────────────────────
// The educator operations & governance control centre (Administration spec +
// developer spec + mockup). A landing hub with eight administration modules,
// each opening a module page.
//
// Honest-UI: the operational records that exist drive the live parts — the user
// directory (profiles), the organisation structure (organisations / hospitals /
// departments), programs (courses + course_enrollments), reference data
// (frameworks / domains) and the audit trail (audit_log). There is no store yet
// for invitations, cohorts, admin requests, calendars, workload or system
// health, so those KPIs are muted and those modules render honest scaffolds —
// never fabricated numbers.

export type AdminModule = { slug: string; title: string; icon: string; tint: string; blurb: string; bullets: string[]; live: boolean };

export const ADMIN_MODULES: AdminModule[] = [
  { slug: "users", title: "User Administration", icon: "👤", tint: "text-blue-600 bg-blue-100",
    blurb: "Manage educator and support user accounts and access.",
    bullets: ["User accounts & profiles", "Roles & permissions", "Invitations & onboarding", "User status management", "Bulk import & export"], live: true },
  { slug: "structure", title: "Organizational Structure Manager", icon: "🏢", tint: "text-emerald-600 bg-emerald-100",
    blurb: "Create and maintain departments, teams and organizational hierarchy.",
    bullets: ["Organization hierarchy", "Departments & units", "Teams & committees", "Leaders & ownership", "Structure history"], live: true },
  { slug: "programs", title: "Program, Course & Cohort Admin", icon: "🎓", tint: "text-violet-600 bg-violet-100",
    blurb: "Manage programs, courses and learner cohorts.",
    bullets: ["Programs & curricula", "Cohorts & intakes", "Enrollment & capacity", "Facilitator assignments", "Program completion"], live: true },
  { slug: "calendar", title: "Academic & Operational Calendar", icon: "🗓️", tint: "text-amber-600 bg-amber-100",
    blurb: "Manage academic periods, events, deadlines and schedules.",
    bullets: ["Academic periods", "Key dates & deadlines", "Event & session calendar", "Recurring schedules", "Calendar synchronization"], live: false },
  { slug: "workload", title: "Workload, Assignment & Resources", icon: "⚖️", tint: "text-cyan-600 bg-cyan-100",
    blurb: "Assign responsibilities and manage educator workload.",
    bullets: ["Teaching & assessment assignments", "Workload overview", "Capacity & availability", "Resource allocation", "Coverage & delegation"], live: false },
  { slug: "requests", title: "Administrative Requests & Approvals", icon: "🧾", tint: "text-rose-600 bg-rose-100",
    blurb: "Manage requests, approvals and administrative workflows.",
    bullets: ["Request submission", "Approval workflows", "Review & decisions", "Escalations", "Request history"], live: false },
  { slug: "reference-data", title: "Reference Data & System Records", icon: "🗂️", tint: "text-teal-600 bg-teal-100",
    blurb: "Manage reference data and system records used across the platform.",
    bullets: ["Reference data lists", "Codes & classifications", "Import / export data", "Data quality checks", "Change history"], live: true },
  { slug: "audit", title: "Administration Analytics & Audit", icon: "📊", tint: "text-indigo-600 bg-indigo-100",
    blurb: "Monitor operations, performance and audit activity.",
    bullets: ["Operational dashboards", "Audit logs & trails", "Compliance monitoring", "Reports & exports", "Activity analytics"], live: true },
];

export type Kpi = { label: string; value: number | string | null; sub: string; icon: string; tint: string; muted?: boolean };
export type Activity = { actor: string; action: string; entity: string | null; when: string | null };
export type Alert = { icon: string; text: string; sub: string; tone: string };
export type Deadline = { title: string; date: string | null; sub: string; tone: string };
export type Pair = { label: string; value: string; muted?: boolean };
export type Bar = { label: string; count: number };
export type UserRow = { id: string; name: string; email: string; roles: string[]; department: string; workspace: string; joined: string | null };
export type StructureNode = { name: string; type: string; sub: string; count: number };
export type ProgramRow = { id: string; title: string; category: string; level: string; status: string; enrolled: number };
export type RefList = { title: string; source: string; values: string[] };

type AuditRow = { actor_name: string | null; action: string | null; entity_name: string | null; entity_type: string | null; created_at: string | null; actor_id?: string | null };
type ProfileRow = { id: string; full_name: string | null; email: string | null; role: string | null; roles: string[] | null; department_id: string | null; hospital_id: string | null; created_at: string | null };

const DAY = 864e5;
const EDUCATOR_ROLES = new Set(["educator", "senior_educator", "clinical_educator", "curriculum_lead", "assessment_lead", "simulation_lead", "education_administrator", "program_director"]);
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const daysUntil = (iso: string | null) => iso ? Math.round((new Date(iso).getTime() - Date.now()) / DAY) : null;
const rolesOf = (p: { role: string | null; roles: string[] | null }) => (p.roles?.length ? p.roles : [p.role]).filter(Boolean) as string[];
const mapActivity = (rows: AuditRow[]): Activity[] => rows.map(a => ({ actor: a.actor_name ?? "Someone", action: a.action ? titleCase(a.action) : "updated", entity: a.entity_name, when: a.created_at }));
const aiOn = () => import("@/lib/ai/config").then(m => m.aiStatus().configured).catch(() => false);

// Organisation → hospitals → departments, plus the org's profile directory.
async function orgContext(admin: Admin, hospitalId: string) {
  const { data: hosp } = await admin.from("hospitals").select("id, name, city, country, organisation_id").eq("id", hospitalId).limit(1);
  const h = (hosp ?? [])[0] as { id: string; name?: string; city?: string; country?: string; organisation_id?: string } | undefined;
  const orgId = h?.organisation_id ?? null;

  let orgName = "—";
  let hospitals: { id: string; name: string; city: string | null; country: string | null }[] = [];
  if (orgId) {
    const [{ data: org }, { data: hs }] = await Promise.all([
      admin.from("organisations").select("name").eq("id", orgId).limit(1),
      admin.from("hospitals").select("id, name, city, country").eq("organisation_id", orgId),
    ]);
    orgName = ((org ?? [])[0] as { name?: string } | undefined)?.name ?? "—";
    hospitals = (hs ?? []) as typeof hospitals;
  }
  // Scope users & departments by the org's HOSPITALS — profiles.organisation_id
  // is unpopulated for many users (hospital_id always is), so hospital scoping
  // is both accurate and prevents cross-tenant leakage.
  const hospIds = hospitals.map(x => x.id);
  let profiles: ProfileRow[] = [];
  let departments: { id: string; name: string; hospital_id: string; specialty: string | null }[] = [];
  if (hospIds.length) {
    const [{ data: profs }, { data: depts }] = await Promise.all([
      admin.from("profiles").select("id, full_name, email, role, roles, department_id, hospital_id, created_at").in("hospital_id", hospIds).order("created_at", { ascending: false }).limit(1000),
      admin.from("departments").select("id, name, hospital_id, specialty").in("hospital_id", hospIds),
    ]);
    profiles = (profs ?? []) as ProfileRow[];
    departments = (depts ?? []) as typeof departments;
  }
  return { orgId, orgName, workspaceName: h?.name ?? "Workspace", hospIds, hospitals, departments, profiles };
}

// ── Hub landing ──────────────────────────────────────────────────────────────
export type AdminHub = {
  kpis: Kpi[]; alerts: Alert[]; deadlines: Deadline[]; activity: Activity[]; roleBars: Bar[];
  orgName: string; workspaceName: string; modules: AdminModule[]; aiConfigured: boolean;
};

export async function loadAdminHub(admin: Admin, hospitalId: string): Promise<AdminHub> {
  const [ctx, { data: courses }, { data: audit }, configured] = await Promise.all([
    orgContext(admin, hospitalId),
    admin.from("courses").select("id, is_published").limit(500),
    admin.from("audit_log").select("actor_name, action, entity_name, entity_type, created_at").order("created_at", { ascending: false }).limit(10),
    aiOn(),
  ]);
  // Credentials scoped to the org's hospitals (professional_credentials.hospital_id).
  const { data: creds } = ctx.hospIds.length
    ? await admin.from("professional_credentials").select("title, expiry_date").in("hospital_id", ctx.hospIds).order("expiry_date", { ascending: true }).limit(200)
    : { data: [] as { title: string; expiry_date: string | null }[] };

  const educators = ctx.profiles.filter(p => rolesOf(p).some(r => EDUCATOR_ROLES.has(r)));
  const activePrograms = ((courses ?? []) as { is_published: boolean }[]).filter(c => c.is_published).length;
  const credRows = (creds ?? []) as { title: string; expiry_date: string | null }[];
  const expiringSoon = credRows.filter(c => { const d = daysUntil(c.expiry_date); return d !== null && d >= 0 && d <= 90; });

  const kpis: Kpi[] = [
    { label: "Active Educators", value: educators.length, sub: `of ${ctx.profiles.length} users`, icon: "👥", tint: "text-blue-600 bg-blue-100" },
    { label: "Pending Invitations", value: null, sub: "invitation store not built yet", icon: "✉️", tint: "text-violet-600 bg-violet-100", muted: true },
    { label: "Departments", value: ctx.departments.length, sub: `across ${ctx.hospitals.length} site${ctx.hospitals.length === 1 ? "" : "s"}`, icon: "🏢", tint: "text-emerald-600 bg-emerald-100" },
    { label: "Active Programs", value: activePrograms, sub: "published courses · shared catalogue", icon: "🎓", tint: "text-amber-600 bg-amber-100" },
    { label: "Current Cohorts", value: null, sub: "cohort store not built yet", icon: "👨‍👩‍👧", tint: "text-cyan-600 bg-cyan-100", muted: true },
    { label: "Admin Requests", value: null, sub: "request store not built yet", icon: "🧾", tint: "text-rose-600 bg-rose-100", muted: true },
    { label: "Compliance Actions", value: null, sub: "compliance store not built yet", icon: "🛡️", tint: "text-orange-600 bg-orange-100", muted: true },
    { label: "System Issues", value: null, sub: "health monitoring not enabled", icon: "🖥️", tint: "text-gray-600 bg-gray-100", muted: true },
  ];

  const alerts: Alert[] = [];
  if (expiringSoon.length) alerts.push({ icon: "⚠️", text: `${expiringSoon.length} credential${expiringSoon.length === 1 ? "" : "s"} expiring soon`, sub: expiringSoon[0].title ? `Next: ${expiringSoon[0].title}` : "", tone: "text-amber-600" });
  alerts.push({ icon: "🧾", text: "Request review queue", sub: "activates once the request store is connected", tone: "text-gray-400" });
  alerts.push({ icon: "🖥️", text: "System health", sub: "monitoring not enabled yet", tone: "text-gray-400" });

  const deadlines: Deadline[] = expiringSoon.slice(0, 4).map(c => { const dl = daysUntil(c.expiry_date)!; return { title: `${c.title} renewal`, date: c.expiry_date, sub: `${dl} days remaining`, tone: dl <= 30 ? "text-amber-600" : "text-gray-500" }; });

  // Role distribution across the organisation (real).
  const roleMap = new Map<string, number>();
  for (const p of ctx.profiles) for (const r of rolesOf(p)) roleMap.set(r, (roleMap.get(r) ?? 0) + 1);
  const roleBars: Bar[] = [...roleMap.entries()].map(([r, c]) => ({ label: titleCase(r), count: c })).sort((a, b) => b.count - a.count).slice(0, 8);

  return { kpis, alerts, deadlines, activity: mapActivity((audit ?? []) as AuditRow[]), roleBars, orgName: ctx.orgName, workspaceName: ctx.workspaceName, modules: ADMIN_MODULES, aiConfigured: configured };
}

// ── Module page ──────────────────────────────────────────────────────────────
export type AdminModuleData = {
  module: AdminModule; summary: Pair[]; users?: UserRow[]; structure?: StructureNode[]; programs?: ProgramRow[];
  reference?: RefList[]; audit?: Activity[]; roleBars?: Bar[]; groups: { title: string; items: string[] }[]; aiConfigured: boolean;
};

const MODULE_GROUPS: Record<string, { title: string; items: string[] }[]> = {
  calendar: [
    { title: "Calendar items", items: ["Academic periods", "Assessment windows", "Review periods", "Credential renewal periods", "Orientation dates", "Committee meetings", "Institutional holidays"] },
    { title: "Capabilities", items: ["Create event", "Recurring events", "Define academic periods", "Set deadlines", "Detect conflicts", "Publish calendar", "Sync external calendars"] },
  ],
  workload: [
    { title: "Assignment categories", items: ["Teaching", "Assessment", "Review", "Validation", "Curriculum development", "Simulation facilitation", "Mentorship", "Committee roles"] },
    { title: "Workload statuses", items: ["Available", "Balanced", "Near capacity", "Overallocated", "Unavailable", "On leave"] },
  ],
  requests: [
    { title: "Request types", items: ["New user access", "Role change", "Department transfer", "Program creation", "Temporary elevated access", "Integration request", "Data correction", "Archive request"] },
    { title: "Request statuses", items: ["Draft", "Submitted", "Under review", "More information required", "Approved", "Approved with conditions", "Rejected", "Implemented"] },
  ],
};

export async function loadAdminModule(admin: Admin, hospitalId: string, slug: string): Promise<AdminModuleData | null> {
  const mod = ADMIN_MODULES.find(m => m.slug === slug);
  if (!mod) return null;
  const [ctx, configured] = await Promise.all([orgContext(admin, hospitalId), aiOn()]);

  const summary: Pair[] = [];
  let users: UserRow[] | undefined;
  let structure: StructureNode[] | undefined;
  let programs: ProgramRow[] | undefined;
  let reference: RefList[] | undefined;
  let audit: Activity[] | undefined;
  let roleBars: Bar[] | undefined;

  const deptMap = new Map(ctx.departments.map(d => [d.id, d.name]));
  const hospMap = new Map(ctx.hospitals.map(h => [h.id, h.name]));

  if (slug === "users") {
    const educators = ctx.profiles.filter(p => rolesOf(p).some(r => EDUCATOR_ROLES.has(r)));
    const roleMap = new Map<string, number>();
    for (const p of ctx.profiles) for (const r of rolesOf(p)) roleMap.set(r, (roleMap.get(r) ?? 0) + 1);
    roleBars = [...roleMap.entries()].map(([r, c]) => ({ label: titleCase(r), count: c })).sort((a, b) => b.count - a.count).slice(0, 10);
    summary.push(
      { label: "Total users", value: String(ctx.profiles.length) },
      { label: "Educators", value: String(educators.length) },
      { label: "Role types", value: String(roleMap.size) },
      { label: "Invitations", value: "store not built yet", muted: true },
    );
    users = ctx.profiles.map(p => ({
      id: p.id, name: p.full_name ?? "—", email: p.email ?? "—",
      roles: rolesOf(p).map(r => titleCase(r)),
      department: p.department_id ? (deptMap.get(p.department_id) ?? "—") : "—",
      workspace: p.hospital_id ? (hospMap.get(p.hospital_id) ?? "—") : "—",
      joined: p.created_at,
    }));
  } else if (slug === "structure") {
    summary.push(
      { label: "Organization", value: ctx.orgName },
      { label: "Sites / hospitals", value: String(ctx.hospitals.length) },
      { label: "Departments", value: String(ctx.departments.length) },
      { label: "Users", value: String(ctx.profiles.length) },
    );
    structure = [
      { name: ctx.orgName, type: "Organization", sub: `${ctx.hospitals.length} sites`, count: ctx.profiles.length },
      ...ctx.hospitals.map(h => ({ name: h.name, type: "Hospital / site", sub: [h.city, h.country].filter(Boolean).join(", ") || "—", count: ctx.departments.filter(d => d.hospital_id === h.id).length })),
    ];
  } else if (slug === "programs") {
    const { data: courses } = await admin.from("courses").select("id, title, category, level, is_published").limit(500);
    const rows = (courses ?? []) as { id: string; title: string; category: string | null; level: string | null; is_published: boolean }[];
    const { data: enrolls } = await admin.from("course_enrollments").select("course_id").limit(5000);
    const enrollCount = new Map<string, number>();
    for (const e of (enrolls ?? []) as { course_id: string }[]) enrollCount.set(e.course_id, (enrollCount.get(e.course_id) ?? 0) + 1);
    summary.push(
      { label: "Programs / courses", value: String(rows.length) },
      { label: "Published", value: String(rows.filter(c => c.is_published).length) },
      { label: "Total enrolments", value: String((enrolls ?? []).length) },
      { label: "Cohorts store", value: "not built yet", muted: true },
    );
    programs = rows.map(c => ({ id: c.id, title: c.title, category: c.category ? titleCase(c.category) : "—", level: c.level ? titleCase(c.level) : "—", status: c.is_published ? "Published" : "Draft", enrolled: enrollCount.get(c.id) ?? 0 }));
  } else if (slug === "reference-data") {
    const [{ data: frameworks }, { data: domains }] = await Promise.all([
      admin.from("frameworks").select("name").limit(100),
      admin.from("framework_domains").select("name").limit(100),
    ]);
    const roleMap = new Map<string, number>();
    for (const p of ctx.profiles) for (const r of rolesOf(p)) roleMap.set(r, (roleMap.get(r) ?? 0) + 1);
    summary.push(
      { label: "Frameworks", value: String((frameworks ?? []).length) },
      { label: "Domains", value: String((domains ?? []).length) },
      { label: "Role types in use", value: String(roleMap.size) },
      { label: "Departments", value: String(ctx.departments.length) },
    );
    reference = [
      { title: "Educator roles (in use)", source: "profiles", values: [...roleMap.keys()].map(r => titleCase(r)) },
      { title: "Competency frameworks", source: "frameworks", values: ((frameworks ?? []) as { name: string }[]).map(f => f.name).slice(0, 20) },
      { title: "Framework domains", source: "framework_domains", values: ((domains ?? []) as { name: string }[]).map(d => d.name).slice(0, 20) },
      { title: "Departments", source: "departments", values: ctx.departments.map(d => d.name) },
    ];
  } else if (slug === "audit") {
    const { data: auditRows } = await admin.from("audit_log").select("actor_name, action, entity_name, entity_type, created_at").order("created_at", { ascending: false }).limit(60);
    const rows = (auditRows ?? []) as AuditRow[];
    const actionMap = new Map<string, number>();
    for (const a of rows) if (a.action) actionMap.set(a.action, (actionMap.get(a.action) ?? 0) + 1);
    roleBars = [...actionMap.entries()].map(([a, c]) => ({ label: titleCase(a), count: c })).sort((a, b) => b.count - a.count).slice(0, 8);
    summary.push(
      { label: "Audit events (recent)", value: String(rows.length) },
      { label: "Distinct actions", value: String(actionMap.size) },
      { label: "Users in org", value: String(ctx.profiles.length) },
      { label: "Departments", value: String(ctx.departments.length) },
    );
    audit = mapActivity(rows);
  } else {
    summary.push({ label: "Backing store", value: "not provisioned yet", muted: true });
  }

  return { module: mod, summary, users, structure, programs, reference, audit, roleBars, groups: MODULE_GROUPS[slug] ?? [], aiConfigured: configured };
}
