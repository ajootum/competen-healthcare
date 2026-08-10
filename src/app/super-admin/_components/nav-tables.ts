// The /super-admin sidebar's nav tables — DATA ONLY.
//
// Split out of WorkspaceSidebar.tsx (a "use client" component) by CP-HQ-NAV-001 so that the capability
// filter can be asserted against the REAL tables rather than a copy pasted into a harness. A harness that
// declares its own fixture of the nav proves nothing about the nav that ships.
//
// No "use client", no imports, no JSX: importable from a node script and from the client component alike.

export type NavEntry = { label: string; href: string; icon: string };
export type NavSection = { group: string; items: NavEntry[] };

export const GENERAL_NAV: NavSection[] = [
  { group: "MISSION CONTROL", items: [
    { label: "Overview", href: "/super-admin", icon: "🎛️" },
    { label: "Command Centre", href: "/super-admin/command-centre", icon: "📡" },
    // ⚠ MISSION CONTROL, NOT ENTERPRISE ADMINISTRATION, AND THE DISTINCTION IS THE POINT.
    //
    // "People & Roles" below is the hospital ESTATE: who works in the organisations and facilities this
    // platform serves. HQ positions are the opposite direction -- who governs the PLATFORM ITSELF, through
    // the five spaces migration 264 seeded. Filing it beside estate people would conflate the two planes
    // the whole HQ programme exists to separate, on the one screen where that mistake is expensive.
    //
    // It shipped with no link at all and was reachable only by typing the URL -- the fourth screen this
    // week to be built and left doorless, which is why scripts/practice-door-sweep.ts exists.
    { label: "HQ Positions", href: "/super-admin/users/appointments", icon: "🏛️" },
  ]},
  { group: "ENTERPRISE ADMINISTRATION", items: [
    { label: "Overview", href: "/super-admin/enterprise", icon: "🏢" },
    { label: "Organisations", href: "/super-admin/enterprise/organisations", icon: "🏛️" },
    { label: "Networks", href: "/super-admin/enterprise/networks", icon: "🌐" },
    { label: "Facilities", href: "/super-admin/enterprise/facilities", icon: "🏥" },
    { label: "Structure Builder", href: "/super-admin/enterprise/structure", icon: "🗂️" },
    { label: "People & Roles", href: "/super-admin/enterprise/people", icon: "👥" },
    { label: "Enterprise Templates", href: "/super-admin/enterprise/templates", icon: "📦" },
    { label: "Bulk Import", href: "/super-admin/import", icon: "📥" },
  ]},
  { group: "PLATFORM OPERATIONS", items: [
    { label: "Overview", href: "/super-admin/platform-ops", icon: "🎛️" },
    { label: "Tenant Operations", href: "/super-admin/platform-ops/tenants", icon: "🏢" },
    { label: "Workspaces", href: "/super-admin/platform-ops/workspaces", icon: "🖥️" },
    { label: "Licensing", href: "/super-admin/platform-ops/licensing", icon: "🧾" },
    { label: "Monitoring", href: "/super-admin/platform-ops/monitoring", icon: "📡" },
    { label: "AI Gateway", href: "/super-admin/platform-ops/ai-gateway", icon: "✨" },
    { label: "Notifications", href: "/super-admin/platform-ops/notifications", icon: "📨" },
    { label: "Approvals", href: "/super-admin/platform-ops/approvals", icon: "🔀" },
    { label: "Control Plane", href: "/super-admin/platform-ops/control-plane", icon: "🧭" },
    { label: "Competen Practice", href: "/super-admin/platform-ops/practice", icon: "🩺" },
    { label: "Platform Workspace", href: "/platform-admin", icon: "🛰️" },
  ]},
  { group: "STRATEGY & PRIORITIES", items: [
    { label: "Strategy Manager", href: "/super-admin/priorities", icon: "🎯" },
    { label: "Priority Distribution", href: "/super-admin/priorities/distribution", icon: "🌊" },
    { label: "Goal → Action", href: "/super-admin/priorities/actions", icon: "⚡" },
    { label: "Personalisation", href: "/super-admin/priorities/personalisation", icon: "🧩" },
    { label: "Campaigns", href: "/super-admin/priorities/campaigns", icon: "📣" },
    { label: "Priority Analytics", href: "/super-admin/priorities/analytics", icon: "📊" },
    { label: "AI Orchestrator", href: "/super-admin/priorities/ai", icon: "🧠" },
    { label: "Governance", href: "/super-admin/priorities/governance", icon: "✅" },
  ]},
  { group: "COMPETENCY STUDIO", items: [
    { label: "Open Competency Studio →", href: "/super-admin/studio", icon: "🎨" },
    { label: "Asset Repository", href: "/super-admin/studio/assets", icon: "🗄️" },
  ]},
  { group: "COMPETENCY DELIVERY", items: [
    { label: "Open Competency Delivery →", href: "/super-admin/delivery", icon: "🎓" },
  ]},
  { group: "COMPETENCY ASSURANCE", items: [
    { label: "Open Competency Assurance →", href: "/super-admin/assurance", icon: "🛡️" },
  ]},
  { group: "COMPETENCY PERFORMANCE", items: [
    { label: "Open Competency Performance →", href: "/super-admin/performance", icon: "📈" },
  ]},
  { group: "COMPETENCY GOVERNANCE", items: [
    { label: "Open Competency Governance →", href: "/super-admin/cgr", icon: "⚖️" },
  ]},
  { group: "CLINICAL KNOWLEDGE PLATFORM", items: [
    { label: "Open CKP →", href: "/super-admin/ckp", icon: "📚" },
  ]},
  { group: "AI & INTELLIGENCE", items: [
    { label: "Open AI & Intelligence →", href: "/super-admin/ai", icon: "🧠" },
  ]},
  { group: "GOVERNANCE & COMPLIANCE", items: [
    { label: "Open Governance →", href: "/super-admin/governance", icon: "🛡️" },
  ]},
  { group: "SYSTEM & SECURITY", items: [
    { label: "Open System & Security →", href: "/super-admin/system", icon: "🔐" },
  ]},
  { group: "SYSTEM & SETTINGS", items: [
    { label: "Metadata & Tags", href: "/super-admin/metadata", icon: "🏷️" },
    { label: "Platform Settings", href: "/super-admin/settings", icon: "⚙️" },
  ]},
];

export const CKP_NAV: NavSection[] = [
  { group: "CKP NAVIGATION", items: [
    { label: "CKP Overview", href: "/super-admin/ckp", icon: "📚" },
    { label: "1. Knowledge Studio", href: "/super-admin/ckp/studio", icon: "🏭" },
    { label: "2. Competency & Framework Centre", href: "/super-admin/ckp/competency", icon: "📐" },
    { label: "3. Clinical Knowledge Repository", href: "/super-admin/ckp/repository", icon: "🗄️" },
    { label: "4. Assessment & Validation Centre", href: "/super-admin/ckp/assessment", icon: "🎯" },
    { label: "5. Knowledge Publishing & Governance", href: "/super-admin/ckp/publishing", icon: "🚦" },
    { label: "6. Knowledge Intelligence", href: "/super-admin/ckp/intelligence", icon: "📡" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "Create New CPU", href: "/super-admin/studio/cpus", icon: "➕" },
    { label: "Create Competency", href: "/super-admin/content", icon: "🎯" },
    { label: "Create Assessment", href: "/super-admin/assessment-methods", icon: "📝" },
    { label: "Create Policy", href: "/super-admin/policy-manager", icon: "📋" },
    { label: "AI Authoring Assistant", href: "/super-admin/assistant", icon: "✨" },
    { label: "Knowledge Search", href: "/super-admin/assistant", icon: "🔍" },
  ]},
];

export const STUDIO_NAV: NavSection[] = [
  { group: "COMPETENCY STUDIO", items: [
    { label: "Studio Home", href: "/super-admin/studio", icon: "🎨" },
    { label: "Asset Repository", href: "/super-admin/studio/assets", icon: "🗄️" },
    { label: "Framework & Competency", href: "/super-admin/content", icon: "🧬" },
    { label: "Dependencies", href: "/super-admin/studio/dependencies", icon: "🔗" },
    { label: "Rules Engine", href: "/super-admin/studio/rules", icon: "⚙️" },
    { label: "Mapping Studio", href: "/super-admin/studio/mapping", icon: "🗺️" },
    { label: "Assessment Studio", href: "/super-admin/studio/assessment", icon: "🩺" },
    { label: "Skills Library", href: "/super-admin/studio/skills", icon: "✋" },
    { label: "Checklists", href: "/super-admin/studio/checklists", icon: "☑️" },
    { label: "Practices & CPUs", href: "/super-admin/studio/cpus", icon: "🏥" },
    { label: "Question Banks", href: "/super-admin/studio/questions", icon: "❓" },
    { label: "Template Library", href: "/super-admin/studio/templates", icon: "🧩" },
    { label: "Package Manager", href: "/super-admin/studio/packages", icon: "📦" },
    { label: "Marketplace", href: "/super-admin/studio/marketplace", icon: "🛍️" },
    { label: "Knowledge Objects", href: "/super-admin/studio/knowledge", icon: "🫀" },
    { label: "Case Studies", href: "/super-admin/studio/cases", icon: "🧑‍⚕️" },
    { label: "Learning Paths", href: "/super-admin/studio/learning", icon: "📚" },
    { label: "Simulation Studio", href: "/super-admin/studio/simulations", icon: "🎬" },
    { label: "Ownership", href: "/super-admin/studio/responsibilities", icon: "🧾" },
    { label: "Import CPU Document", href: "/super-admin/studio/import", icon: "📥" },
  ]},
  { group: "GOVERNANCE & PUBLISHING", items: [
    { label: "Release Readiness", href: "/super-admin/studio/testing", icon: "🧪" },
    { label: "Publishing & Versioning", href: "/competency-office/publishing", icon: "🚦" },
    { label: "Review & Governance", href: "/competency-office/review-board", icon: "⚖️" },
    { label: "Lifecycle Management", href: "/competency-office/lifecycle-state", icon: "♻️" },
    { label: "Quality Assurance", href: "/super-admin/studio/qa", icon: "✅" },
    { label: "Analytics", href: "/competency-office/analytics", icon: "📊" },
    { label: "Approval Queue", href: "/admin/approvals", icon: "🗳️" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "AI Design Assistant", href: "/super-admin/assistant", icon: "✨" },
    { label: "Archive & Repository", href: "/super-admin/ckp/repository", icon: "🗄️" },
    { label: "Standards Mapping", href: "/super-admin/studio/standards", icon: "📏" },
    { label: "Clinical Knowledge Platform", href: "/super-admin/ckp", icon: "📚" },
  ]},
];

export const AI_NAV: NavSection[] = [
  { group: "AI & INTELLIGENCE", items: [
    { label: "AI Home", href: "/super-admin/ai", icon: "🧠" },
    { label: "1. AI Operations Centre", href: "/super-admin/ai/operations", icon: "⚙️" },
    { label: "2. Clinical Intelligence", href: "/super-admin/ai/clinical", icon: "🩺" },
    { label: "3. Workforce Intelligence", href: "/super-admin/ai/workforce", icon: "👥" },
    { label: "4. Enterprise Intelligence", href: "/super-admin/ai/enterprise", icon: "🏢" },
    { label: "5. AI Studio & Automation", href: "/super-admin/ai/studio", icon: "🛠️" },
    { label: "6. Intelligence Analytics", href: "/super-admin/ai/analytics", icon: "📈" },
    { label: "7. AI Services Platform", href: "/super-admin/ai/services", icon: "🛰️" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "AI Assistant Chat", href: "/super-admin/assistant", icon: "💬" },
    { label: "AI Gateway", href: "/super-admin/platform-ops/ai-gateway", icon: "✨" },
    { label: "Knowledge Graph", href: "/super-admin/knowledge-graph", icon: "🕸️" },
    { label: "AI Audit Logs", href: "/super-admin/audit", icon: "🗒️" },
    { label: "My Approvals", href: "/super-admin/platform-ops/approvals", icon: "✅" },
  ]},
];

export const GOV_NAV: NavSection[] = [
  { group: "GOVERNANCE & COMPLIANCE", items: [
    { label: "1. Governance Dashboard", href: "/super-admin/governance", icon: "🛡️" },
    { label: "2. Policy & Standards Center", href: "/super-admin/governance/policies", icon: "📄" },
    { label: "3. Compliance Management", href: "/super-admin/governance/compliance", icon: "✅" },
    { label: "4. Risk & Internal Controls", href: "/super-admin/governance/risk", icon: "⚠️" },
    { label: "5. Audit & Assurance", href: "/super-admin/governance/audit", icon: "📋" },
    { label: "6. Regulatory & Accreditation", href: "/super-admin/governance/accreditation", icon: "🏛️" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "Committees", href: "/super-admin/governance/committees", icon: "⚖️" },
    { label: "Approvals", href: "/super-admin/platform-ops/approvals", icon: "🔀" },
    { label: "Workflows", href: "/super-admin/workflows", icon: "⚡" },
    { label: "Report Templates", href: "/super-admin/reports", icon: "📈" },
    { label: "Audit Log", href: "/super-admin/audit", icon: "🗒️" },
  ]},
];

export const SYS_NAV: NavSection[] = [
  { group: "SYSTEM & SECURITY PLATFORM", items: [
    { label: "1. System Health Dashboard", href: "/super-admin/system", icon: "💚" },
    { label: "2. Identity & Access Management", href: "/super-admin/system/identity", icon: "👤" },
    { label: "3. Security Operations Center", href: "/super-admin/system/security", icon: "🛡️" },
    { label: "4. Infrastructure & Services", href: "/super-admin/system/infrastructure", icon: "🖥️" },
    { label: "5. Data Protection & Recovery", href: "/super-admin/system/data", icon: "💾" },
    { label: "6. Security Intelligence & Audit", href: "/super-admin/system/audit", icon: "🔍" },
  ]},
  { group: "QUICK ACCESS", items: [
    { label: "Users", href: "/super-admin/users", icon: "👥" },
    { label: "Monitoring", href: "/super-admin/platform-ops/monitoring", icon: "📡" },
    { label: "Control Plane", href: "/super-admin/platform-ops/control-plane", icon: "🧭" },
    { label: "Audit Log", href: "/super-admin/audit", icon: "🗒️" },
    { label: "Platform Settings", href: "/super-admin/settings", icon: "⚙️" },
  ]},
];

// ⚠ HAND-MAINTAINED, AND IT HAD ALREADY DRIFTED TWICE. NavLink prefix-matches by default, so a group's
// "Overview" stays lit while you are on any of its children -- two rows highlighted, and no way to tell
// where you are. This set marked the parents that must match EXACTLY, and adding a group meant remembering
// to add its parent here. /super-admin/platform-ops and /super-admin/enterprise were both missed, which is
// why "Overview" and "Tenant Operations" were highlighted together.
//
// It is kept only as a floor. exactHrefs in WorkspaceSidebar DERIVES the same answer from the nav itself,
// and the two are unioned: the list can no longer be the single point of failure, and removing an entry
// from it cannot widen matching for any parent that has children in the tree.
export const OVERVIEW_HREFS = new Set(["/super-admin", "/super-admin/ckp", "/super-admin/ai", "/super-admin/governance", "/super-admin/system", "/super-admin/studio", "/super-admin/content"]);

/** Every table, for harnesses and for anything that needs to reason about the whole sidebar at once. */
export const ALL_NAV_TABLES: { name: string; sections: NavSection[] }[] = [
  { name: "GENERAL_NAV", sections: GENERAL_NAV },
  { name: "CKP_NAV", sections: CKP_NAV },
  { name: "STUDIO_NAV", sections: STUDIO_NAV },
  { name: "AI_NAV", sections: AI_NAV },
  { name: "GOV_NAV", sections: GOV_NAV },
  { name: "SYS_NAV", sections: SYS_NAV },
];
