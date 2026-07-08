export type AppRole = "super_admin" | "hospital_admin" | "educator" | "assessor" | "nurse";

// 13-level tenant org hierarchy — who the user IS within their organisation
export type OrgRole =
  | "chief_officer"
  | "org_admin"
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

// Competen internal staff roles — differentiate who a super_admin user actually is
export type PlatformRole =
  | "platform_owner"
  | "platform_super_admin"
  | "content_manager"
  | "customer_success"
  | "developer";

export const PLATFORM_ROLE_CONFIG: Record<PlatformRole, { label: string; icon: string; description: string }> = {
  platform_owner:       { label: "Platform Owner",       icon: "👑", description: "CEO + CPO — full platform authority, billing, legal" },
  platform_super_admin: { label: "Platform Super Admin", icon: "🛡️", description: "Technical admin — security, backups, infrastructure" },
  content_manager:      { label: "Content Manager",      icon: "📚", description: "Manages master competency library and frameworks" },
  customer_success:     { label: "Customer Success",     icon: "🤝", description: "Onboarding, training and tenant support" },
  developer:            { label: "Developer",            icon: "💻", description: "Code, APIs, database — no clinical data restriction" },
};

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

export function portalRoleFromOrgRole(orgRole: OrgRole): AppRole {
  return ORG_ROLE_CONFIG[orgRole].portalRole;
}

export const ROLE_PRIORITY: AppRole[] = ["super_admin", "hospital_admin", "educator", "assessor", "nurse"];

export function highestRole(roles: string[]): AppRole {
  return ROLE_PRIORITY.find(r => roles.includes(r)) ?? "nurse";
}

// Keep SubRole as an alias so any lingering imports don't break immediately
export type SubRole = OrgRole;
/** @deprecated Use ORG_ROLE_CONFIG instead */
export const SUB_ROLE_CONFIG = ORG_ROLE_CONFIG as unknown as Record<SubRole, { label: string; icon: string; portalRole: AppRole }>;
