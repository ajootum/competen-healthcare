import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Workspace Settings ───────────────────────────────────────────────────────
// The educator workspace configuration & governance centre (Workspace Settings
// spec + developer spec + mockup). A landing hub with eight settings modules,
// each opening a module page that shows the current configuration read from real
// records plus the settings areas the module governs.
//
// Honest-UI: settings are largely write-operations with no editable backing
// store yet, so this presents REAL read-only data where it exists — the user &
// role directory (profiles), workspace identity (organisations / hospitals /
// departments), notification volume, AI status and audit-based security &
// activity — and renders every editable control area as an honest "configuration
// coming soon" listing rather than a dead toggle that implies a working write.
// KPIs with no store (integrations, notification rules, security alerts,
// inherited policies) are shown muted, never fabricated.

export type Group = { title: string; items: string[] };
export type SettingsModule = {
  slug: string; title: string; icon: string; tint: string; blurb: string; bullets: string[]; groups: Group[];
};

export const SETTINGS_MODULES: SettingsModule[] = [
  { slug: "profile", title: "Workspace Profile & Identity", icon: "🪪", tint: "text-blue-600 bg-blue-100",
    blurb: "Manage workspace identity, branding and basic information.",
    bullets: ["Workspace details", "Branding & logos", "Workspace status", "Contact information"],
    groups: [
      { title: "Identity", items: ["Workspace name", "Organization name", "Department", "Education unit", "Workspace description", "Default landing page"] },
      { title: "Branding", items: ["Workspace logo", "Institution logo", "Institutional colours", "Email footer", "Certificate branding", "Report headers"] },
      { title: "Status", items: ["Active", "Limited access", "Maintenance", "Read only", "Suspended", "Archived"] },
    ] },
  { slug: "users", title: "Users, Roles & Permissions", icon: "👥", tint: "text-emerald-600 bg-emerald-100",
    blurb: "Manage users, roles and access permissions.",
    bullets: ["User management", "Role assignments", "Permission controls", "Access reports"],
    groups: [
      { title: "Roles", items: ["Educator", "Senior Educator", "Clinical Educator", "Curriculum Lead", "Assessment Lead", "Quality Reviewer", "Education Administrator", "Program Director"] },
      { title: "Permission categories", items: ["View", "Create", "Edit", "Delete", "Review", "Validate", "Approve", "Publish", "Assign", "Export", "Configure", "Administer"] },
    ] },
  { slug: "education-defaults", title: "Education & Assessment Defaults", icon: "📋", tint: "text-violet-600 bg-violet-100",
    blurb: "Set default values for education content and assessments.",
    bullets: ["Education defaults", "Assessment defaults", "Publishing defaults", "Default workflows"],
    groups: [
      { title: "Education defaults", items: ["Default curriculum framework", "Default competency taxonomy", "Default professional group", "Default learning level", "Default language", "Default review cycle"] },
      { title: "Assessment defaults", items: ["Default assessment type", "Default scoring model", "Default pass mark", "Default grading scale", "Default assessor allocation", "Default validation workflow"] },
      { title: "Publishing defaults", items: ["Default approval pathway", "Default publication audience", "Default resource visibility", "Default version numbering", "Default expiry period", "Default archive rule"] },
    ] },
  { slug: "notifications", title: "Notifications & Communication", icon: "🔔", tint: "text-amber-600 bg-amber-100",
    blurb: "Configure notification rules and communication preferences.",
    bullets: ["Notification categories", "Delivery channels", "Escalation rules", "Quiet hours & delegation"],
    groups: [
      { title: "Categories", items: ["Content approvals", "Validation requests", "Publication events", "Assigned tasks", "Assessment schedules", "Quality alerts", "Accreditation deadlines", "Security alerts"] },
      { title: "Delivery channels", items: ["In-app notifications", "Email", "SMS", "Mobile push", "Digest summary", "Escalation alerts"] },
      { title: "Controls", items: ["Immediate", "Daily digest", "Weekly digest", "Critical only", "Mute", "Escalate after delay", "Delegate during absence"] },
    ] },
  { slug: "ai", title: "AI Preferences & Governance", icon: "✨", tint: "text-fuchsia-600 bg-fuchsia-100",
    blurb: "Control AI features, behaviour and governance policies.",
    bullets: ["AI feature controls", "AI behaviour settings", "Data & privacy rules", "AI audit & transparency"],
    groups: [
      { title: "AI controls", items: ["AI recommendations", "AI content generation", "AI assessment drafting", "AI curriculum mapping", "AI quality checks", "AI publication readiness", "AI learner-risk insights", "AI summarisation", "AI translation", "AI search assistance"] },
      { title: "Behaviour", items: ["Response detail level", "Preferred language", "Educational tone", "Clinical terminology standard", "Citation requirement", "Human review requirements", "Confidence display"] },
      { title: "Governance", items: ["Approval for AI-generated content", "Prohibited AI uses", "Sensitive-data restrictions", "AI audit logging", "Approved AI models", "External processing restrictions", "Data retention rules"] },
    ] },
  { slug: "integrations", title: "Integrations & Connected Services", icon: "🔌", tint: "text-cyan-600 bg-cyan-100",
    blurb: "Manage integrations and connected applications.",
    bullets: ["Connected services", "Sync configuration", "Connection health", "Integration logs"],
    groups: [
      { title: "Categories", items: ["Learning management systems", "HR systems", "Electronic medical records", "Identity providers", "Calendar systems", "Email platforms", "Document storage", "Video conferencing"] },
      { title: "Typical integrations", items: ["LifterLMS", "Google Workspace", "Microsoft 365", "Single Sign-On", "Hospital HR systems", "Calendar services", "Document repositories", "External certification services"] },
    ] },
  { slug: "security", title: "Security, Privacy & Data Controls", icon: "🔒", tint: "text-rose-600 bg-rose-100",
    blurb: "Manage security settings and data protection controls.",
    bullets: ["Security policies", "Privacy settings", "Data retention", "Access monitoring"],
    groups: [
      { title: "Security settings", items: ["Multi-factor authentication", "Session timeout", "Password policy", "Trusted devices", "Login restrictions", "Role elevation controls", "Data export permissions", "API access"] },
      { title: "Privacy settings", items: ["Personal data visibility", "Learner information access", "Assessment evidence visibility", "AI data processing permissions", "Data retention periods", "Consent requirements", "Cross-tenant sharing restrictions"] },
    ] },
  { slug: "localization", title: "Localization, Accessibility & Experience", icon: "🌐", tint: "text-indigo-600 bg-indigo-100",
    blurb: "Customise language, accessibility and user experience.",
    bullets: ["Language & region", "Accessibility settings", "Interface preferences", "Theme & display"],
    groups: [
      { title: "Localization", items: ["Language", "Country", "Time zone", "Date format", "Time format", "Number format", "Measurement units", "Professional terminology"] },
      { title: "Accessibility", items: ["Text size", "High contrast", "Reduced motion", "Keyboard navigation", "Screen-reader optimisation", "Colour-blind-friendly indicators", "Simplified interface"] },
      { title: "Experience", items: ["Default home page", "Sidebar state", "Dashboard density", "Table density", "Card or list view", "Saved filters", "Workspace theme"] },
    ] },
];

export type Kpi = { label: string; value: number | string | null; sub: string; icon: string; tint: string; muted?: boolean };
export type Activity = { actor: string; action: string; entity: string | null; when: string | null };
export type Pair = { label: string; value: string; muted?: boolean };
export type UserRow = { id: string; name: string; email: string; roles: string[]; department: string; joined: string | null };
export type SecurityEvent = { actor: string; action: string; when: string | null };

type AuditRow = { actor_name: string | null; action: string | null; entity_name: string | null; created_at: string | null };
type ProfileRow = { id: string; full_name: string | null; email: string | null; role: string | null; roles: string[] | null; department_id: string | null; created_at: string | null; hospital_id: string | null };

const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const mapActivity = (rows: AuditRow[]): Activity[] => rows.map(a => ({ actor: a.actor_name ?? "Someone", action: a.action ? titleCase(a.action) : "updated", entity: a.entity_name, when: a.created_at }));
const aiOn = () => import("@/lib/ai/config").then(m => m.aiStatus().configured).catch(() => false);

async function orgContext(admin: Admin, hospitalId: string) {
  const [{ data: hosp }, { data: depts }] = await Promise.all([
    admin.from("hospitals").select("id, name, city, country, type, organisation_id, cpd_target_hours").eq("id", hospitalId).limit(1),
    admin.from("departments").select("id, name, specialty").eq("hospital_id", hospitalId),
  ]);
  const h = (hosp ?? [])[0] as { name?: string; city?: string; country?: string; type?: string; organisation_id?: string; cpd_target_hours?: number } | undefined;
  let orgName = "—";
  if (h?.organisation_id) {
    const { data: org } = await admin.from("organisations").select("name, type, hq_country, website, email, phone").eq("id", h.organisation_id).limit(1);
    orgName = (org ?? [])[0]?.name ?? "—";
  }
  const deptRows = (depts ?? []) as { id: string; name: string; specialty: string | null }[];
  return { hospital: h, orgName, departments: deptRows };
}

// ── Hub landing ──────────────────────────────────────────────────────────────
export type SettingsHub = {
  kpis: Kpi[]; overview: Pair[]; activity: Activity[];
  orgName: string; workspaceName: string; deptCount: number; aiConfigured: boolean;
};

export async function loadSettingsHub(admin: Admin, hospitalId: string): Promise<SettingsHub> {
  const [{ data: profiles }, { data: audit }, ctx, configured] = await Promise.all([
    admin.from("profiles").select("id, role, roles").eq("hospital_id", hospitalId),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").order("created_at", { ascending: false }).limit(8),
    orgContext(admin, hospitalId),
    aiOn(),
  ]);
  const profs = (profiles ?? []) as { role: string | null; roles: string[] | null }[];
  const roleSet = new Set<string>();
  for (const p of profs) (p.roles?.length ? p.roles : [p.role]).filter(Boolean).forEach(r => roleSet.add(r as string));
  const auditRows = (audit ?? []) as AuditRow[];
  const latest = auditRows[0];

  const kpis: Kpi[] = [
    { label: "Active Users", value: profs.length, sub: "in this workspace", icon: "👤", tint: "text-blue-600 bg-blue-100" },
    { label: "Assigned Roles", value: roleSet.size, sub: `${roleSet.size} role type${roleSet.size === 1 ? "" : "s"} in use`, icon: "🛡️", tint: "text-emerald-600 bg-emerald-100" },
    { label: "Integrations", value: null, sub: "no integration store yet", icon: "🧩", tint: "text-violet-600 bg-violet-100", muted: true },
    { label: "Notification Rules", value: null, sub: "no rules store yet", icon: "🔔", tint: "text-amber-600 bg-amber-100", muted: true },
    { label: "Security Alerts", value: null, sub: "monitoring not enabled yet", icon: "🔒", tint: "text-rose-600 bg-rose-100", muted: true },
    { label: "AI Features", value: configured ? "On" : "Off", sub: configured ? "grounded assistant live" : "not configured", icon: "✨", tint: "text-fuchsia-600 bg-fuchsia-100", muted: !configured },
    { label: "Inherited Policies", value: null, sub: "policy model not built yet", icon: "🗂️", tint: "text-cyan-600 bg-cyan-100", muted: true },
  ];

  const overview: Pair[] = [
    { label: "Scope", value: "Organization" },
    { label: "Organization", value: ctx.orgName },
    { label: "Workspace", value: ctx.hospital?.name ?? "—" },
    { label: "Departments", value: String(ctx.departments.length) },
    { label: "Last change", value: latest ? `${fmtDate(latest.created_at)}` : "—" },
    { label: "Changed by", value: latest?.actor_name ?? "—" },
    { label: "Editing", value: "Read-only preview", muted: true },
    { label: "Policy inheritance", value: "not modelled yet", muted: true },
  ];

  return {
    kpis, overview, activity: mapActivity(auditRows),
    orgName: ctx.orgName, workspaceName: ctx.hospital?.name ?? "Educator Workspace", deptCount: ctx.departments.length, aiConfigured: configured,
  };
}

// ── Module page ──────────────────────────────────────────────────────────────
export type SettingsModuleData = {
  module: SettingsModule; current: Pair[]; users?: UserRow[]; security?: SecurityEvent[];
  activity: Activity[]; scope: Pair[]; aiConfigured: boolean;
};

export async function loadSettingsModule(admin: Admin, hospitalId: string, userId: string, slug: string): Promise<SettingsModuleData | null> {
  const mod = SETTINGS_MODULES.find(m => m.slug === slug);
  if (!mod) return null;

  const [ctx, { data: audit }, configured] = await Promise.all([
    orgContext(admin, hospitalId),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").order("created_at", { ascending: false }).limit(10),
    aiOn(),
  ]);
  const auditRows = (audit ?? []) as AuditRow[];

  const current: Pair[] = [];
  let users: UserRow[] | undefined;
  let security: SecurityEvent[] | undefined;

  if (slug === "profile") {
    current.push(
      { label: "Workspace name", value: ctx.hospital?.name ?? "—" },
      { label: "Organization", value: ctx.orgName },
      { label: "Location", value: [ctx.hospital?.city, ctx.hospital?.country].filter(Boolean).join(", ") || "—" },
      { label: "Type", value: ctx.hospital?.type ? titleCase(ctx.hospital.type) : "—" },
      { label: "Departments", value: String(ctx.departments.length) },
      // No status column on hospitals — muted so it isn't read as a live setting.
      { label: "Workspace status", value: "Active", muted: true },
    );
  } else if (slug === "users") {
    const [{ data: profiles }, deptMap] = await Promise.all([
      admin.from("profiles").select("id, full_name, email, role, roles, department_id, created_at, hospital_id").eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(500),
      Promise.resolve(new Map(ctx.departments.map(d => [d.id, d.name]))),
    ]);
    const profs = (profiles ?? []) as ProfileRow[];
    users = profs.map(p => ({
      id: p.id, name: p.full_name ?? "—", email: p.email ?? "—",
      roles: (p.roles?.length ? p.roles : [p.role]).filter(Boolean).map(r => titleCase(r as string)),
      department: p.department_id ? (deptMap.get(p.department_id) ?? "—") : "—",
      joined: p.created_at,
    }));
    const roleSet = new Set<string>(); users.forEach(u => u.roles.forEach(r => roleSet.add(r)));
    current.push(
      { label: "Active users", value: String(users.length) },
      { label: "Role types in use", value: String(roleSet.size) },
      { label: "Departments", value: String(ctx.departments.length) },
      { label: "Custom roles", value: "0", muted: true },
    );
  } else if (slug === "security") {
    // Only genuinely privileged actions — no fallback to generic activity, so
    // the count and the "privileged actions" label stay truthful (0 → empty).
    const priv = auditRows.filter(a => /grant|role|senior|approve|decision|escalat|delete|suspend|permission/i.test(a.action ?? ""));
    security = priv.slice(0, 8).map(a => ({ actor: a.actor_name ?? "Someone", action: a.action ? titleCase(a.action) : "updated", when: a.created_at }));
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId);
    current.push(
      { label: "Accounts with access", value: String(count ?? 0) },
      { label: "Privileged events (recent)", value: String(security.length) },
      { label: "MFA policy", value: "not configurable yet", muted: true },
      { label: "Session policy", value: "platform default", muted: true },
    );
  } else if (slug === "ai") {
    current.push(
      { label: "AI assistant", value: configured ? "Configured & live" : "Not configured", muted: !configured },
      { label: "Grounding", value: "Educator-scoped, cited, audit-logged" },
      { label: "Governance controls", value: "read-only preview", muted: true },
    );
  } else if (slug === "notifications") {
    // Scoped to this user — notifications carry only user_id, so a workspace-wide
    // count would leak other users' rows.
    const { count } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId);
    current.push(
      { label: "Notification categories", value: String(mod.groups[0].items.length) },
      { label: "Your recent notifications", value: String(count ?? 0) },
      { label: "Delivery channels", value: "in-app (live) · others soon", muted: true },
    );
  } else if (slug === "integrations") {
    current.push(
      { label: "Connected services", value: "0" },
      { label: "Integration store", value: "not provisioned yet", muted: true },
    );
  } else if (slug === "localization") {
    current.push(
      { label: "Language", value: "English" },
      { label: "Theme", value: "System (light / dark aware)" },
      { label: "Sidebar", value: "Collapsible (per-user)" },
      { label: "Saved preferences store", value: "not built yet", muted: true },
    );
  } else if (slug === "education-defaults") {
    current.push(
      { label: "Defaults store", value: "not provisioned yet", muted: true },
      { label: "Applied on new content", value: "platform defaults", muted: true },
    );
  }

  const scope: Pair[] = [
    { label: "Scope", value: "Organization" },
    { label: "Organization", value: ctx.orgName },
    { label: "Source", value: "Organization default", muted: true },
    { label: "State", value: "Read-only", muted: true },
  ];

  return { module: mod, current, users, security, activity: mapActivity(auditRows.slice(0, 6)), scope, aiConfigured: configured };
}
