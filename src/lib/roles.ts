export type AppRole = "super_admin" | "hospital_admin" | "educator" | "assessor" | "nurse";

// 13-level tenant org hierarchy — who the user IS within their organisation
export type OrgRole =
  | "chief_officer"
  | "org_admin"
  | "director_of_nursing"
  | "governance_committee"
  | "manager"
  | "competency_coordinator"
  | "quality_manager"
  | "hr_manager"
  | "it_admin"
  | "educator"
  | "charge_nurse"
  | "shift_supervisor"
  | "leader"
  | "healthcare_worker";

// Competen LANDLORD axis — the platform-operator identities (PLA-001). Distinct
// from the tenant-plane AppRole/OrgRole: a PlatformRole means the user operates
// the platform ACROSS tenants. `platform_super_admin` and `developer` are kept as
// back-compat aliases of the canonical `platform_operations` / `engineer`.
export type PlatformRole =
  | "platform_owner"        // POW-001
  | "platform_operations"   // PSA-001 (canonical)
  | "platform_super_admin"  // PSA-001 (alias, existing data)
  | "customer_success"      // PCS-001
  | "support"               // SUP-001
  | "product_manager"       // PRD-001
  | "engineer"              // ENG-001 (canonical)
  | "developer"             // ENG-001 (alias, existing data)
  | "ai_operator"           // AIS-001
  | "finance"               // FIN-001
  | "content_manager"       // CNT-001
  | "quality_officer"       // QLT-001
  | "security_operator";    // SEC-001

export const PLATFORM_ROLE_CONFIG: Record<PlatformRole, { label: string; icon: string; description: string; tier: number; workspace: string }> = {
  platform_owner:       { label: "Platform Owner",         icon: "👑", description: "Strategic ownership — commercial, global policy, delegation", tier: 1, workspace: "POW-001" },
  platform_operations:  { label: "Platform Operations",    icon: "🛠️", description: "Tenant administration, incidents, controlled emergency actions", tier: 2, workspace: "PSA-001" },
  platform_super_admin: { label: "Platform Operations",    icon: "🛠️", description: "Tenant administration, incidents, controlled emergency actions", tier: 2, workspace: "PSA-001" },
  customer_success:     { label: "Customer Success",       icon: "🤝", description: "Onboarding, adoption, health scores, renewals", tier: 3, workspace: "PCS-001" },
  support:              { label: "Support",                icon: "🎧", description: "Tickets, user recovery, tenant support", tier: 3, workspace: "SUP-001" },
  product_manager:      { label: "Product Management",     icon: "🧭", description: "Product/module governance across tenants", tier: 3, workspace: "PRD-001" },
  engineer:             { label: "Engineering",            icon: "💻", description: "Code, APIs, database, deployments", tier: 3, workspace: "ENG-001" },
  developer:            { label: "Engineering",            icon: "💻", description: "Code, APIs, database, deployments", tier: 3, workspace: "ENG-001" },
  ai_operator:          { label: "AI Operations",          icon: "✨", description: "Providers, prompts, token budgets, AI governance", tier: 3, workspace: "AIS-001" },
  finance:              { label: "Finance",                icon: "💷", description: "Billing, subscriptions, revenue", tier: 3, workspace: "FIN-001" },
  content_manager:      { label: "Content Operations",     icon: "📚", description: "Master competency library, standards, marketplace", tier: 3, workspace: "CNT-001" },
  quality_officer:      { label: "Quality & Compliance",   icon: "🔬", description: "Platform quality, compliance, standards governance", tier: 3, workspace: "QLT-001" },
  security_operator:    { label: "Security Operations",    icon: "🛡️", description: "Auth monitoring, security events, threat response", tier: 3, workspace: "SEC-001" },
};

// The set of valid landlord role codes, for membership tests.
export const PLATFORM_ROLES = Object.keys(PLATFORM_ROLE_CONFIG) as PlatformRole[];

// Resolve a profile's landlord roles (platform_roles[] preferred, platform_role scalar fallback).
export function platformRolesOf(p: { platform_role?: string | null; platform_roles?: string[] | null } | null | undefined): PlatformRole[] {
  if (!p) return [];
  const raw = ((p.platform_roles?.length ? p.platform_roles : [p.platform_role]) as (string | null | undefined)[]).filter(Boolean) as string[];
  return raw.filter(r => (PLATFORM_ROLES as string[]).includes(r)) as PlatformRole[];
}

// True when the profile holds at least one landlord role (any, or one of `roles`).
export function hasPlatformRole(p: { platform_role?: string | null; platform_roles?: string[] | null } | null | undefined, ...roles: PlatformRole[]): boolean {
  const held = platformRolesOf(p);
  if (!held.length) return false;
  return roles.length === 0 ? true : held.some(r => roles.includes(r));
}

export const ROLE_CONFIG: Record<AppRole, { label: string; icon: string; portal: string; color: string }> = {
  super_admin:    { label: "Super Admin",       icon: "🛡️", portal: "/super-admin",     color: "bg-violet-600" },
  hospital_admin: { label: "Admin",             icon: "🏛️", portal: "/admin/dashboard", color: "bg-blue-600"   },
  educator:       { label: "Educator",          icon: "📚", portal: "/educator",         color: "bg-purple-600" },
  assessor:       { label: "Assessor",          icon: "📋", portal: "/assessor",         color: "bg-teal-600"   },
  nurse:          { label: "Healthcare Worker", icon: "🩺", portal: "/dashboard",        color: "bg-green-600"  },
};

export const ORG_ROLE_CONFIG: Record<OrgRole, {
  label: string;
  icon: string;
  description: string;
  portalRole: AppRole;
  tier: number; // 1 = highest seniority
}> = {
  // Organisation leadership
  chief_officer:          { label: "Chief Officer",                    icon: "👑", description: "Strategic org-wide oversight and executive reporting",        portalRole: "hospital_admin", tier: 1  },
  org_admin:              { label: "Administrator",                    icon: "🗂️", description: "Manages users, facilities and org settings",                  portalRole: "hospital_admin", tier: 2  },
  director_of_nursing:    { label: "Director of Nursing",              icon: "🩺", description: "Owns ward configuration — bed capacity, staffing standards and round schedules", portalRole: "hospital_admin", tier: 3  },
  governance_committee:   { label: "Competency Governance Committee",  icon: "⚖️", description: "Reviews and approves clinical competency content before publication", portalRole: "hospital_admin", tier: 3  },
  manager:                { label: "Manager",                          icon: "👔", description: "Manages a facility or department",                            portalRole: "hospital_admin", tier: 4  },
  competency_coordinator: { label: "Competency Coordinator",           icon: "📅", description: "Runs competency programme, schedules assessments, reports",   portalRole: "hospital_admin", tier: 5  },
  // Functional departments
  quality_manager:        { label: "Quality Manager",                  icon: "🔬", description: "Quality assurance and improvement — monitors competency standards", portalRole: "hospital_admin", tier: 6  },
  hr_manager:             { label: "HR Manager",                       icon: "👥", description: "Human resources — staff records, onboarding and workforce admin",   portalRole: "hospital_admin", tier: 7  },
  it_admin:               { label: "IT Administrator",                 icon: "🖥️", description: "System accounts, integrations and platform access control",   portalRole: "hospital_admin", tier: 8  },
  // Clinical roles
  educator:               { label: "Educator / Clinical Specialist",   icon: "🎓", description: "Delivers training and competency content",                    portalRole: "educator",       tier: 9  },
  charge_nurse:           { label: "Charge Nurse / In-Charge",         icon: "🏷️", description: "Unit management and clinical assessments",                   portalRole: "assessor",       tier: 10 },
  shift_supervisor:       { label: "Shift Supervisor / Leader",        icon: "⏰", description: "Shift oversight and team assessments",                        portalRole: "assessor",       tier: 11 },
  leader:                 { label: "Team Leader",                      icon: "⭐", description: "Front-line team lead and peer oversight",                     portalRole: "assessor",       tier: 12 },
  healthcare_worker:      { label: "Healthcare Worker",                icon: "🩺", description: "Tracked, assessed and upskilled on the platform",             portalRole: "nurse",          tier: 13 },
};

export const ORG_ROLES = Object.keys(ORG_ROLE_CONFIG) as OrgRole[];

// A user's effective org roles for access gating: the full org_roles[] array
// (preferred) or the org_role scalar (fallback). Returns [null] when the user has
// no org role — so catch-all nav items (which list null) still show for them, and
// gating on `orgRolesOf(p).some(r => item.orgRoles.includes(r))` matches EVERY
// role the user holds, not just their primary/highest one.
export function orgRolesOf(p: { org_role?: string | null; org_roles?: string[] | null } | null | undefined): (OrgRole | null)[] {
  if (!p) return [null];
  const raw = ((p.org_roles?.length ? p.org_roles : [p.org_role]) as (string | null | undefined)[]).filter(Boolean) as string[];
  const valid = raw.filter(r => (ORG_ROLES as string[]).includes(r)) as OrgRole[];
  return valid.length ? valid : [null];
}

export function portalRoleFromOrgRole(orgRole: OrgRole): AppRole {
  return ORG_ROLE_CONFIG[orgRole].portalRole;
}

// ── Dedicated org-role workspaces ────────────────────────────────────────────
// The full, standalone workspaces (each its own layout + sub-pages) that a user
// "switches" into the same way they switch portals. Surfaced in the portal
// switcher so an activated org role becomes a real, switchable destination —
// not just a link buried in the Admin sidebar. Two independent gates:
//   orgRoles — which activated organisation roles SURFACE the workspace (its
//              audience), so a user sees the workspaces their roles unlock.
//   appRoles — which portal roles the workspace ROUTE itself admits (mirrors the
//              `const ALLOWED` gate in each workspace layout), so we never offer
//              a switch target that would land on an "Access restricted" screen.
export type WorkspaceLink = { label: string; icon: string; href: string };

export const WORKSPACE_CATALOGUE: (WorkspaceLink & { orgRoles: OrgRole[]; appRoles: AppRole[] })[] = [
  { label: "Shift Supervisor",        icon: "🖥️", href: "/supervisor",            orgRoles: ["chief_officer","org_admin","manager","shift_supervisor","charge_nurse","leader"], appRoles: ["assessor","hospital_admin","super_admin"] },
  { label: "Unit Manager",            icon: "📊", href: "/unit-manager",          orgRoles: ["chief_officer","org_admin","manager"],                                             appRoles: ["hospital_admin","super_admin"] },
  { label: "Competency Office",       icon: "🏛️", href: "/competency-office",     orgRoles: ["chief_officer","org_admin","governance_committee","competency_coordinator"],       appRoles: ["hospital_admin","educator","super_admin"] },
  { label: "Quality & Accreditation", icon: "🎯", href: "/quality-accreditation", orgRoles: ["chief_officer","org_admin","quality_manager","governance_committee"],               appRoles: ["hospital_admin","super_admin","assessor"] },
  { label: "Human Resources",         icon: "👥", href: "/human-resources",       orgRoles: ["chief_officer","org_admin","hr_manager"],                                          appRoles: ["hospital_admin","super_admin"] },
  { label: "Hospital Executive",      icon: "🛰️", href: "/hospital-executive",    orgRoles: ["chief_officer","org_admin"],                                                       appRoles: ["hospital_admin","super_admin"] },
  { label: "Organisation Admin",      icon: "🗂️", href: "/organisation-admin",    orgRoles: ["chief_officer","org_admin","it_admin"],                                            appRoles: ["hospital_admin","super_admin"] },
  { label: "Enterprise Governance",   icon: "🏛️", href: "/enterprise-governance", orgRoles: ["chief_officer","org_admin","governance_committee"],                                 appRoles: ["hospital_admin","super_admin"] },
];

// The dedicated workspaces a user can switch into: unlocked by one of their
// activated org roles AND admitted by one of their portal roles. Order follows
// WORKSPACE_CATALOGUE. Returns [] when the user's roles unlock none.
export function workspacesFor(
  orgRoles: (OrgRole | null)[],
  userRoles: AppRole[],
): WorkspaceLink[] {
  return WORKSPACE_CATALOGUE
    .filter(w => w.orgRoles.some(r => orgRoles.includes(r)) && w.appRoles.some(r => userRoles.includes(r)))
    .map(({ label, icon, href }) => ({ label, icon, href }));
}

export const ROLE_PRIORITY: AppRole[] = ["super_admin", "hospital_admin", "educator", "assessor", "nurse"];

export function highestRole(roles: string[]): AppRole {
  return ROLE_PRIORITY.find(r => roles.includes(r)) ?? "nurse";
}

// Keep SubRole as an alias so any lingering imports don't break immediately
export type SubRole = OrgRole;
/** @deprecated Use ORG_ROLE_CONFIG instead */
export const SUB_ROLE_CONFIG = ORG_ROLE_CONFIG as unknown as Record<SubRole, { label: string; icon: string; portalRole: AppRole }>;
