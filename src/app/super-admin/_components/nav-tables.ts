// THE HQ NAVIGATION REGISTRY (COMPETEN-HQ-IA-02) -- DATA ONLY.
//
// Split out of WorkspaceSidebar.tsx (a "use client" component) by CP-HQ-NAV-001 so that the capability
// filter can be asserted against the REAL tables rather than a copy pasted into a harness. A harness that
// declares its own fixture of the nav proves nothing about the nav that ships.
//
// No "use client", no JSX, and one import: pd-nav.ts beside it, which is data only under the same rule.
// Importable from a node script and from the client component alike.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ HQ-IA-02: SEVEN WORKSPACES, AND THE REGISTRY IS THE WHOLE ESTATE. Every static /super-admin page is
// registered here exactly once as a home entry: drawn (an item, or a child shown under its item while you
// are inside it) or a deep link with the page that leads to it (`via`). scripts/hq-nav-registry-harness.ts
// fails a page that is not, which is the "doorless screen" lesson turned into a gate.
//
// ⚠ NO CAPABILITY LIVES HERE. Visibility is canSeeHqLink(href) over HQ_ROUTE_INTENT and nothing else, so
// the nav and the page guard cannot become two opinions about the same door. A hidden link is not
// authorisation either way: every page still calls requireHqCapability.
//
// ⚠ STRUCTURE CHANGES BY APPROVED IA CHANGE, NOT BY PREFERENCE. Bump HQ_NAV_REGISTRY_VERSION with any
// change to workspaces, sections, labels or order. Keys are stable and never reused.
//
// ⚠ THE PRACTICE SECTION IS DERIVED FROM PD_NAV, NOT COPIED. CPR-PD-001 freezes that table; owners reach
// the Product Director workspace through it here, and a Product Director still gets their own sidebar.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import { PD_NAV, PD_HOME, PD_EXTERNAL_HREFS } from "./pd-nav";

export const HQ_NAV_REGISTRY_VERSION = "1.2.0";

/**
 * page: drawn, its home is here. action: drawn, a create/quick action whose home is here.
 * cross: drawn, a link to a page whose home is another workspace (shared capability, one destination).
 * external: drawn, leaves /super-admin -- unmapped, so canSeeHqLink offers it to owners only.
 */
export type NavKind = "page" | "action" | "cross" | "external";

/**
 * A product launch switch, by product -- src/lib/hq/nav-switches.ts maps each to the product's OWN flag
 * constant, so the flag names stay spelled only where their products define them. A STATUS BADGE, never a
 * visibility input.
 */
export type NavSwitch = "individual" | "learning" | "learning-commerce" | "case-library" | "ckri" | "ai-fair-use";

export type NavEntry = {
  key?: string;
  label: string;
  href: string;
  icon: string;
  kind?: NavKind;
  flag?: NavSwitch;
  /** Shown under this item only while the reader is inside it. Same capability as the parent (harness R7). */
  children?: NavEntry[];
};
export type NavSection = { group: string; items: NavEntry[] };

/** A registered page the sidebar does not draw: reached from `via`, found by search. */
export type NavDeep = { key: string; label: string; href: string; via: string };

export type HqWorkspaceKey = "mission" | "products" | "knowledge" | "frameworks" | "ai" | "platform" | "governance";
export type HqSection = NavSection & { key: string; /** no heading: the workspace's landing group */ plain?: boolean };
export type HqWorkspace = { key: HqWorkspaceKey; label: string; icon: string; sections: HqSection[]; deep?: NavDeep[] };

const pdSlug = (href: string) => href.replace("/super-admin/pd/", "").replace(/\//g, ".");

// The Product Director workspace, for owners: the eleven PD modules (not PD_HOME, which is HQ Mission
// Control itself), each with its children. A child that repeats its parent's href, or leaves the PD
// workspace (Technical Operations, which has its own home below), is not repeated.
const PRACTICE_FROM_PD_NAV: NavEntry[] = PD_NAV.flatMap(g => g.items)
  .filter(i => i.href !== PD_HOME)
  .map(i => ({
    key: `products.practice.${pdSlug(i.href)}`,
    label: i.label,
    href: i.href,
    icon: i.icon,
    children: (i.children ?? [])
      .filter(c => c.href !== i.href && !PD_EXTERNAL_HREFS.includes(c.href))
      .map(c => ({ key: `products.practice.${pdSlug(c.href)}`, label: c.label, href: c.href, icon: "·" })),
  }));

export const HQ_WORKSPACES: HqWorkspace[] = [
  { key: "mission", label: "Mission Control", icon: "🎛️", sections: [
    { key: "mission.home", group: "Mission Control", plain: true, items: [
      { key: "mission.overview", label: "Mission Control", href: "/super-admin", icon: "🎛️" },
      { key: "mission.command-centre", label: "Command Centre", href: "/super-admin/command-centre", icon: "📡" },
      { key: "mission.reports", label: "Report Templates", href: "/super-admin/reports", icon: "📈" },
    ]},
    { key: "mission.priorities", group: "Strategy & Priorities", items: [
      { key: "mission.priorities.manager", label: "Strategy Manager", href: "/super-admin/priorities", icon: "🎯" },
      { key: "mission.priorities.distribution", label: "Priority Distribution", href: "/super-admin/priorities/distribution", icon: "🌊" },
      { key: "mission.priorities.actions", label: "Goal → Action", href: "/super-admin/priorities/actions", icon: "⚡" },
      { key: "mission.priorities.personalisation", label: "Personalisation", href: "/super-admin/priorities/personalisation", icon: "🧩" },
      { key: "mission.priorities.campaigns", label: "Priority Campaigns", href: "/super-admin/priorities/campaigns", icon: "📣" },
      { key: "mission.priorities.analytics", label: "Priority Analytics", href: "/super-admin/priorities/analytics", icon: "📊" },
      { key: "mission.priorities.ai", label: "AI Orchestrator", href: "/super-admin/priorities/ai", icon: "🧠" },
      { key: "mission.priorities.governance", label: "Priority Governance", href: "/super-admin/priorities/governance", icon: "✅" },
    ]},
  ]},

  { key: "products", label: "Products", icon: "📦", sections: [
    { key: "products.enterprise", group: "Competen Enterprise", items: [
      { key: "products.enterprise.overview", label: "Enterprise Overview", href: "/super-admin/enterprise", icon: "🏢" },
      { key: "products.enterprise.organisations", label: "Organisations", href: "/super-admin/enterprise/organisations", icon: "🏛️" },
      { key: "products.enterprise.networks", label: "Networks", href: "/super-admin/enterprise/networks", icon: "🌐" },
      { key: "products.enterprise.facilities", label: "Facilities", href: "/super-admin/enterprise/facilities", icon: "🏥" },
      { key: "products.enterprise.structure", label: "Structure Builder", href: "/super-admin/enterprise/structure", icon: "🗂️" },
      // ⚠ The hospital ESTATE's people. HQ positions -- who governs the platform -- live in Governance &
      // Administration, never beside this (CP-HQ-NAV-001: the two planes the HQ programme separates).
      { key: "products.enterprise.people", label: "People & Roles", href: "/super-admin/enterprise/people", icon: "👥" },
      { key: "products.enterprise.templates", label: "Enterprise Templates", href: "/super-admin/enterprise/templates", icon: "📦" },
      { key: "products.enterprise.import", label: "Bulk Import", href: "/super-admin/import", icon: "📥", kind: "action" },
    ]},
    // COMPETEN-IND-ACCESS-001 s4, CONFIG-002 (migration 376), P0 catalogues (394), PROFILE-01 part B (451).
    { key: "products.individual", group: "Competen Individual", items: [
      { key: "products.individual.access", label: "Individual Pilot Access", href: "/super-admin/individual", icon: "🎓", flag: "individual" },
      { key: "products.individual.policy", label: "Individual Policy", href: "/super-admin/individual/configuration", icon: "🎚️", flag: "individual", children: [
        { key: "products.individual.programmes", label: "Scholar Programmes", href: "/super-admin/individual/programmes", icon: "·" },
        { key: "products.individual.documents", label: "Document Templates", href: "/super-admin/individual/documents", icon: "·" },
      ]},
      { key: "products.individual.catalogues", label: "Controlled Catalogues", href: "/super-admin/individual/catalogues", icon: "📚", flag: "individual" },
      { key: "products.individual.verification", label: "Professional Verification", href: "/super-admin/individual/verification", icon: "✅", flag: "individual" },
      { key: "products.individual.economics", label: "Unit Economics & FX", href: "/super-admin/individual/economics", icon: "💱", flag: "individual" },
      { key: "products.individual.course-access", label: "Course Access", href: "/super-admin/learning/access", icon: "🔑", kind: "cross" },
    ]},
    { key: "products.practice", group: "Competen Practice", items: [
      ...PRACTICE_FROM_PD_NAV,
      { key: "products.practice.technical", label: "Technical Operations", href: "/super-admin/platform-ops/practice", icon: "🩺", children: [
        { key: "products.practice.identifiers", label: "Practitioner Number Format", href: "/super-admin/platform-ops/practice/identifiers", icon: "·" },
      ]},
    ]},
    // Competen Recruitment has no HQ page, so it has no entry: a placeholder would be a dead row.
  ], deep: [
    { key: "products.enterprise.legacy-hospitals", label: "All Hospitals (legacy list)", href: "/super-admin/hospitals", via: "/super-admin/enterprise" },
    { key: "products.enterprise.legacy-organisations", label: "Organisations (legacy list)", href: "/super-admin/organisations", via: "/super-admin" },
  ]},

  { key: "knowledge", label: "Learning & Knowledge", icon: "📚", sections: [
    // Migrations 460-464 (COMPETEN-LEARNING-01). Learning review is the shared clinical approval: its home
    // is Clinical Content Approval in Governance & Administration.
    { key: "knowledge.learning", group: "Competen Learning", items: [
      { key: "knowledge.learning.studio", label: "Learning Studio", href: "/super-admin/learning", icon: "📘", flag: "learning" },
      { key: "knowledge.learning.publication", label: "Learning Publication", href: "/super-admin/learning/publication", icon: "📢", flag: "learning" },
      { key: "knowledge.learning.prices", label: "Course Prices", href: "/super-admin/learning/prices", icon: "🏷️", flag: "learning-commerce" },
      { key: "knowledge.learning.certificates", label: "Certificates", href: "/super-admin/learning/certificates", icon: "🎓", flag: "learning" },
      { key: "knowledge.learning.access", label: "Course Access", href: "/super-admin/learning/access", icon: "🔑", flag: "learning" },
      { key: "knowledge.learning.review", label: "Learning Review", href: "/super-admin/learning/review", icon: "🩺", kind: "cross" },
    ]},
    { key: "knowledge.ckp", group: "Clinical Knowledge Platform", items: [
      { key: "knowledge.ckp.overview", label: "CKP Overview", href: "/super-admin/ckp", icon: "📚" },
      { key: "knowledge.ckp.studio", label: "1. Knowledge Studio", href: "/super-admin/ckp/studio", icon: "🏭" },
      { key: "knowledge.ckp.competency", label: "2. Competency & Framework Centre", href: "/super-admin/ckp/competency", icon: "📐" },
      { key: "knowledge.ckp.repository", label: "3. Clinical Knowledge Repository", href: "/super-admin/ckp/repository", icon: "🗄️" },
      { key: "knowledge.ckp.assessment", label: "4. Assessment & Validation Centre", href: "/super-admin/ckp/assessment", icon: "🎯" },
      { key: "knowledge.ckp.publishing", label: "5. Knowledge Publishing & Governance", href: "/super-admin/ckp/publishing", icon: "🚦" },
      { key: "knowledge.ckp.intelligence", label: "6. Knowledge Intelligence", href: "/super-admin/ckp/intelligence", icon: "📡" },
      { key: "knowledge.ckp.graph", label: "Knowledge Graph", href: "/super-admin/knowledge-graph", icon: "🕸️" },
      { key: "knowledge.ckp.policy", label: "Create Policy", href: "/super-admin/policy-manager", icon: "📋", kind: "action" },
      { key: "knowledge.ckp.create-cpu", label: "Create New CPU", href: "/super-admin/studio/cpus", icon: "➕", kind: "cross" },
      { key: "knowledge.ckp.create-competency", label: "Create Competency", href: "/super-admin/content", icon: "🎯", kind: "cross" },
      { key: "knowledge.ckp.create-assessment", label: "Create Assessment", href: "/super-admin/assessment-methods", icon: "📝", kind: "cross" },
      { key: "knowledge.ckp.assistant", label: "AI Authoring Assistant", href: "/super-admin/assistant", icon: "✨", kind: "cross" },
    ]},
    // Migrations 440-444 (COMPETEN-KNOWLEDGE-RESEARCH-01). It shipped with no door at all (HQ-IA-02 H1).
    { key: "knowledge.research", group: "Knowledge Research", items: [
      { key: "knowledge.research.workspace", label: "Research Workspace", href: "/super-admin/research", icon: "🔬", flag: "ckri" },
      { key: "knowledge.research.educator", label: "Educator Knowledge", href: "/super-admin/research/educator", icon: "🧑‍🏫", flag: "ckri" },
      { key: "knowledge.research.governance", label: "Research Governance", href: "/super-admin/research/governance", icon: "⚖️", flag: "ckri" },
      { key: "knowledge.research.intelligence", label: "Research Learning Intelligence", href: "/super-admin/research/intelligence", icon: "📊", flag: "ckri" },
      { key: "knowledge.research.oversight", label: "Research Oversight", href: "/super-admin/research/oversight", icon: "🛡️", flag: "ckri" },
      { key: "knowledge.research.scientific-review", label: "Scientific Review", href: "/super-admin/research/scientific-review", icon: "🧪", flag: "ckri" },
      { key: "knowledge.research.publication", label: "Knowledge Publication", href: "/super-admin/research/knowledge-publication", icon: "📢", flag: "ckri" },
      { key: "knowledge.research.review", label: "Knowledge Review", href: "/super-admin/research/knowledge-review", icon: "🩺", kind: "cross" },
    ]},
    // Migrations 422-423: the shared clinical case library, on the 395 approval process.
    { key: "knowledge.cases", group: "Clinical Cases", items: [
      { key: "knowledge.cases.studio", label: "Clinical Case Studio", href: "/super-admin/cases", icon: "🧪", flag: "case-library" },
      { key: "knowledge.cases.publication", label: "Case Publication", href: "/super-admin/cases/publication", icon: "📢", flag: "case-library" },
      { key: "knowledge.cases.intelligence", label: "Case Intelligence", href: "/super-admin/cases/intelligence", icon: "📊", flag: "case-library" },
    ]},
  ]},

  { key: "frameworks", label: "Competency Frameworks", icon: "🧬", sections: [
    // CFCA-STUDIO-P1: the Competency Studio, in the order the work is done -- author the shared catalogue, shape
    // each programme framework over it, set scales, stages and components, review clinically, publish independently.
    { key: "frameworks.home", group: "Competency Studio", plain: true, items: [
      // Migration 465: shared competency authoring (the Competency Author). Approval is Clinical Content Approval.
      { key: "frameworks.authoring", label: "Competency Authoring", href: "/super-admin/competencies/authoring", icon: "✍️" },
      // Migration 394: controlled catalogues name shared competencies, never copying them (home: Individual).
      { key: "frameworks.catalogues", label: "Controlled Catalogues", href: "/super-admin/individual/catalogues", icon: "🗂️", kind: "cross" },
      // Migration 660: per-programme requirement, target level and components, with the resolved preview.
      { key: "frameworks.programmes", label: "Programme Frameworks", href: "/super-admin/competencies/programmes", icon: "🎓" },
      { key: "frameworks.scholar-programmes", label: "Scholar Programmes", href: "/super-admin/individual/programmes", icon: "🏫", kind: "cross" },
      // Migration 660: competency stages and the versioned scale-to-stage mapping (DACUM 0-6, Benner 0-6).
      { key: "frameworks.stages", label: "Scales & Stages", href: "/super-admin/competencies/stages", icon: "📶" },
      // Migration 660: the CCHU assessment components (Clinical Skills, Knowledge, Knowledge Application).
      { key: "frameworks.components", label: "Assessment Components", href: "/super-admin/competencies/components", icon: "🧩" },
      { key: "frameworks.clinical-review", label: "Clinical Content Review", href: "/super-admin/clinical-review", icon: "🩺", kind: "cross" },
      // Migration 580: governed publication of shared frameworks and catalogues, by an independent publisher.
      { key: "frameworks.publication", label: "Framework Publication", href: "/super-admin/competencies/publication", icon: "🚦" },
      { key: "frameworks.library", label: "Global Competency Library", href: "/super-admin/competencies", icon: "📖" },
    ]},
    // Migration 510 (COMPETENCY-01 C5): Holdings competency verification. Two separate authorities, two doors --
    // the Studio administrator (verification.manage) and the assessor queue (verification.assess).
    { key: "frameworks.verification", group: "Competency Verification", items: [
      { key: "frameworks.verification.studio", label: "Verification Studio", href: "/super-admin/verification-studio", icon: "🧭" },
      { key: "frameworks.verification.assessment", label: "Competency Assessment", href: "/super-admin/competency-assessment", icon: "📝" },
      { key: "frameworks.verification.requests", label: "Assessment Requests", href: "/super-admin/competency-requests", icon: "📨" },
    ]},
    { key: "frameworks.studio", group: "Studio Toolkit", items: [
      { key: "frameworks.studio.home", label: "Competency Studio Home", href: "/super-admin/studio", icon: "🎨" },
      { key: "frameworks.studio.assets", label: "Asset Repository", href: "/super-admin/studio/assets", icon: "🗄️", children: [
        { key: "frameworks.studio.assets.browser", label: "Asset Browser", href: "/super-admin/studio/assets/browser", icon: "·" },
        { key: "frameworks.studio.assets.search", label: "Asset Search", href: "/super-admin/studio/assets/search", icon: "·" },
        { key: "frameworks.studio.translations", label: "Localisation Engine", href: "/super-admin/studio/translations", icon: "·" },
      ]},
      { key: "frameworks.studio.content", label: "Framework & Competency", href: "/super-admin/content", icon: "🧬" },
      { key: "frameworks.studio.dependencies", label: "Dependencies", href: "/super-admin/studio/dependencies", icon: "🔗" },
      { key: "frameworks.studio.rules", label: "Rules Engine", href: "/super-admin/studio/rules", icon: "⚙️" },
      { key: "frameworks.studio.mapping", label: "Mapping Studio", href: "/super-admin/studio/mapping", icon: "🗺️" },
      { key: "frameworks.studio.standards", label: "Standards Mapping", href: "/super-admin/studio/standards", icon: "📏" },
      { key: "frameworks.studio.assessment", label: "Assessment Studio", href: "/super-admin/studio/assessment", icon: "🩺", children: [
        { key: "frameworks.studio.adaptive", label: "Adaptive Exam Designer", href: "/super-admin/studio/adaptive", icon: "·" },
        { key: "frameworks.studio.behaviour", label: "Behaviour Assessment Studio", href: "/super-admin/studio/behaviour", icon: "·" },
        { key: "frameworks.studio.portfolio", label: "Portfolio Designer", href: "/super-admin/studio/portfolio", icon: "·" },
        { key: "frameworks.studio.psychometrics", label: "Psychometric Analysis", href: "/super-admin/studio/psychometrics", icon: "·" },
        { key: "frameworks.studio.standard-setting", label: "Standard-Setting Studio", href: "/super-admin/studio/standard-setting", icon: "·" },
        { key: "frameworks.studio.three-sixty", label: "360° Assessment Designer", href: "/super-admin/studio/three-sixty", icon: "·" },
      ]},
      { key: "frameworks.studio.methods", label: "Assessment Methods", href: "/super-admin/assessment-methods", icon: "📝", children: [
        { key: "frameworks.studio.scoring", label: "Scoring Rules", href: "/super-admin/scoring", icon: "·" },
      ]},
      { key: "frameworks.studio.schedules", label: "Reassessment Schedules", href: "/super-admin/schedules", icon: "🗓️" },
      { key: "frameworks.studio.skills", label: "Skills Library", href: "/super-admin/studio/skills", icon: "✋" },
      { key: "frameworks.studio.checklists", label: "Checklists", href: "/super-admin/studio/checklists", icon: "☑️" },
      { key: "frameworks.studio.cpus", label: "Practices & CPUs", href: "/super-admin/studio/cpus", icon: "🏥" },
      { key: "frameworks.studio.questions", label: "Question Banks", href: "/super-admin/studio/questions", icon: "❓" },
      { key: "frameworks.studio.templates", label: "Template Library", href: "/super-admin/studio/templates", icon: "🧩" },
      { key: "frameworks.studio.packages", label: "Package Manager", href: "/super-admin/studio/packages", icon: "📦" },
      { key: "frameworks.studio.marketplace", label: "Competency Marketplace", href: "/super-admin/studio/marketplace", icon: "🛍️" },
      { key: "frameworks.studio.knowledge", label: "Knowledge Objects", href: "/super-admin/studio/knowledge", icon: "🫀" },
      { key: "frameworks.studio.cases", label: "Competency Case Studies", href: "/super-admin/studio/cases", icon: "🧑‍⚕️" },
      { key: "frameworks.studio.learning", label: "Competency Learning Paths", href: "/super-admin/studio/learning", icon: "📚" },
      { key: "frameworks.studio.simulations", label: "Simulation Studio", href: "/super-admin/studio/simulations", icon: "🎬" },
      { key: "frameworks.studio.responsibilities", label: "Ownership", href: "/super-admin/studio/responsibilities", icon: "🧾" },
      { key: "frameworks.studio.import", label: "Import CPU Document", href: "/super-admin/studio/import", icon: "📥", kind: "action" },
      { key: "frameworks.studio.testing", label: "Release Readiness", href: "/super-admin/studio/testing", icon: "🧪" },
      { key: "frameworks.studio.qa", label: "Quality Assurance", href: "/super-admin/studio/qa", icon: "✅" },
    ]},
    { key: "frameworks.publishing", group: "Studio Publishing & Review", items: [
      { key: "frameworks.publishing.publishing", label: "Publishing & Versioning", href: "/competency-office/publishing", icon: "🚦", kind: "external" },
      { key: "frameworks.publishing.review-board", label: "Competency Review Board", href: "/competency-office/review-board", icon: "⚖️", kind: "external" },
      { key: "frameworks.publishing.lifecycle", label: "Lifecycle Management", href: "/competency-office/lifecycle-state", icon: "♻️", kind: "external" },
      { key: "frameworks.publishing.analytics", label: "Competency Office Analytics", href: "/competency-office/analytics", icon: "📊", kind: "external" },
      { key: "frameworks.publishing.approvals", label: "Estate Approval Queue", href: "/admin/approvals", icon: "🗳️", kind: "external" },
      { key: "frameworks.publishing.assistant", label: "AI Design Assistant", href: "/super-admin/assistant", icon: "✨", kind: "cross" },
      { key: "frameworks.publishing.archive", label: "Archive & Repository", href: "/super-admin/ckp/repository", icon: "🗄️", kind: "cross" },
    ]},
    { key: "frameworks.lifecycle", group: "Delivery, Assurance & Performance", items: [
      { key: "frameworks.delivery", label: "Competency Delivery", href: "/super-admin/delivery", icon: "🎓", children: [
        { key: "frameworks.delivery.orchestrator", label: "Delivery Orchestrator", href: "/super-admin/delivery/orchestrator", icon: "·" },
        { key: "frameworks.delivery.campaigns", label: "Learning Campaigns", href: "/super-admin/delivery/campaigns", icon: "·" },
        { key: "frameworks.delivery.reminders", label: "Scheduled Reminders", href: "/super-admin/delivery/reminders", icon: "·" },
        { key: "frameworks.delivery.reinforcement", label: "Reinforcement", href: "/super-admin/delivery/reinforcement", icon: "·" },
        { key: "frameworks.delivery.simulation", label: "Simulation Delivery", href: "/super-admin/delivery/simulation", icon: "·" },
        { key: "frameworks.delivery.events", label: "Event Consumer", href: "/super-admin/delivery/events", icon: "·" },
        { key: "frameworks.delivery.config", label: "Delivery Policy", href: "/super-admin/delivery/config", icon: "·" },
      ]},
      { key: "frameworks.assurance", label: "Competency Assurance", href: "/super-admin/assurance", icon: "🛡️", children: [
        { key: "frameworks.assurance.dashboard", label: "Organisational Assurance", href: "/super-admin/assurance/dashboard", icon: "·" },
        { key: "frameworks.assurance.evidence", label: "Evidence Integrity", href: "/super-admin/assurance/evidence", icon: "·" },
        { key: "frameworks.assurance.assessor-reliability", label: "Assessor Reliability", href: "/super-admin/assurance/assessor-reliability", icon: "·" },
        { key: "frameworks.assurance.assessment-quality", label: "Assessment Quality", href: "/super-admin/assurance/assessment-quality", icon: "·" },
        { key: "frameworks.assurance.drift", label: "Competency Drift", href: "/super-admin/assurance/drift", icon: "·" },
        { key: "frameworks.assurance.ai", label: "AI Assurance Intelligence", href: "/super-admin/assurance/ai", icon: "·" },
      ]},
      { key: "frameworks.performance", label: "Competency Performance", href: "/super-admin/performance", icon: "📈", children: [
        { key: "frameworks.performance.correlation", label: "Competency ↔ Observation Compliance", href: "/super-admin/performance/correlation", icon: "·" },
        { key: "frameworks.performance.benchmarking", label: "Benchmarking & Maturity", href: "/super-admin/performance/benchmarking", icon: "·" },
        { key: "frameworks.performance.ai", label: "AI Performance Intelligence", href: "/super-admin/performance/ai", icon: "·" },
      ]},
    ]},
    { key: "frameworks.cgr", group: "Competency Governance & Regulation", items: [
      { key: "frameworks.cgr.home", label: "Governance & Regulation Home", href: "/super-admin/cgr", icon: "⚖️", children: [
        { key: "frameworks.cgr.registry", label: "Governance Registry", href: "/super-admin/cgr/registry", icon: "·" },
        { key: "frameworks.cgr.dashboard", label: "Governance Dashboard", href: "/super-admin/cgr/dashboard", icon: "·" },
        { key: "frameworks.cgr.council", label: "Governance Council", href: "/super-admin/cgr/council", icon: "·" },
        { key: "frameworks.cgr.approvals", label: "Approval Workflow", href: "/super-admin/cgr/approvals", icon: "·" },
        { key: "frameworks.cgr.change-control", label: "Change Control & Lifecycle", href: "/super-admin/cgr/change-control", icon: "·" },
        { key: "frameworks.cgr.policy-rules", label: "Policy & Rules Engine", href: "/super-admin/cgr/policy-rules", icon: "·" },
        { key: "frameworks.cgr.standards", label: "Regulatory Standards Mapping", href: "/super-admin/cgr/standards", icon: "·" },
        { key: "frameworks.cgr.compliance", label: "Compliance Reporting", href: "/super-admin/cgr/compliance", icon: "·" },
        { key: "frameworks.cgr.audit", label: "Audit & Evidence Assurance", href: "/super-admin/cgr/audit", icon: "·" },
        { key: "frameworks.cgr.risk", label: "Exception, Escalation & Risk", href: "/super-admin/cgr/risk", icon: "·" },
        { key: "frameworks.cgr.access", label: "Security, Privacy & Access", href: "/super-admin/cgr/access", icon: "·" },
        { key: "frameworks.cgr.knowledge", label: "Knowledge & Evidence Intelligence", href: "/super-admin/cgr/knowledge", icon: "·" },
        { key: "frameworks.cgr.clinical", label: "Clinical Outcome Correlation", href: "/super-admin/cgr/clinical", icon: "·" },
        { key: "frameworks.cgr.learning", label: "Organisational Learning", href: "/super-admin/cgr/learning", icon: "·" },
        { key: "frameworks.cgr.workforce", label: "Governance Workforce Capability", href: "/super-admin/cgr/workforce", icon: "·" },
        { key: "frameworks.cgr.benchmarking", label: "Benchmarking & Comparative Intelligence", href: "/super-admin/cgr/benchmarking", icon: "·" },
        { key: "frameworks.cgr.analytics", label: "Governance Analytics", href: "/super-admin/cgr/analytics", icon: "·" },
        { key: "frameworks.cgr.executive", label: "Executive Assurance", href: "/super-admin/cgr/executive", icon: "·" },
        { key: "frameworks.cgr.ai", label: "Governance Intelligence & Predictive Risk", href: "/super-admin/cgr/ai", icon: "·" },
        { key: "frameworks.cgr.ai-agents", label: "AI Agent & Autonomous Assurance", href: "/super-admin/cgr/ai-agents", icon: "·" },
        { key: "frameworks.cgr.twin", label: "Digital Competency Twin", href: "/super-admin/cgr/twin", icon: "·" },
        { key: "frameworks.cgr.testing", label: "Simulation, Testing & Validation", href: "/super-admin/cgr/testing", icon: "·" },
        { key: "frameworks.cgr.releases", label: "Deployment, Release & Migration", href: "/super-admin/cgr/releases", icon: "·" },
        { key: "frameworks.cgr.activation", label: "Service Activation Readiness", href: "/super-admin/cgr/activation", icon: "·" },
        { key: "frameworks.cgr.integration", label: "Interoperability & Integration", href: "/super-admin/cgr/integration", icon: "·" },
        { key: "frameworks.cgr.marketplace", label: "External Standards Exchange", href: "/super-admin/cgr/marketplace", icon: "·" },
        { key: "frameworks.cgr.administration", label: "CGR Administration & Configuration", href: "/super-admin/cgr/administration", icon: "·" },
      ]},
    ]},
  ]},

  { key: "ai", label: "AI & Intelligence", icon: "🧠", sections: [
    { key: "ai.home", group: "AI & Intelligence", plain: true, items: [
      { key: "ai.overview", label: "AI Home", href: "/super-admin/ai", icon: "🧠" },
      // AI-FAIR-USE-01 (migration 410): prices, allowance units and product AI policies (hq.platform.ai.manage).
      { key: "ai.fair-use", label: "AI Fair Use", href: "/super-admin/ai/fair-use", icon: "⚖️", flag: "ai-fair-use" },
      // COMPETEN-RESEARCH-01 ADDENDUM V2: the Research Sources & Evidence Studio (hq.platform.ai.view, edits need 630).
      { key: "ai.research-sources", label: "Research Sources", href: "/super-admin/ai/research-sources", icon: "📚" },
      { key: "ai.operations", label: "1. AI Operations Centre", href: "/super-admin/ai/operations", icon: "⚙️" },
      { key: "ai.clinical", label: "2. Clinical Intelligence", href: "/super-admin/ai/clinical", icon: "🩺" },
      { key: "ai.workforce", label: "3. Workforce Intelligence", href: "/super-admin/ai/workforce", icon: "👥" },
      { key: "ai.enterprise", label: "4. Enterprise Intelligence", href: "/super-admin/ai/enterprise", icon: "🏢" },
      { key: "ai.studio", label: "5. AI Studio & Automation", href: "/super-admin/ai/studio", icon: "🛠️" },
      { key: "ai.analytics", label: "6. Intelligence Analytics", href: "/super-admin/ai/analytics", icon: "📈" },
      { key: "ai.services", label: "7. AI Services Platform", href: "/super-admin/ai/services", icon: "🛰️", children: [
        { key: "ai.services.models", label: "Model Management", href: "/super-admin/ai/services/models", icon: "·" },
        { key: "ai.services.prompts", label: "Prompt & Conversation Framework", href: "/super-admin/ai/services/prompts", icon: "·" },
        { key: "ai.services.context", label: "Context Resolution Engine", href: "/super-admin/ai/services/context", icon: "·" },
        { key: "ai.services.knowledge", label: "Knowledge & Semantic Search", href: "/super-admin/ai/services/knowledge", icon: "·" },
        { key: "ai.services.agents", label: "Agent Framework", href: "/super-admin/ai/services/agents", icon: "·" },
        { key: "ai.services.skills", label: "Skills & Plugin Framework", href: "/super-admin/ai/services/skills", icon: "·" },
        { key: "ai.services.actions", label: "Action & Workflow Orchestrator", href: "/super-admin/ai/services/actions", icon: "·" },
        { key: "ai.services.recommendations", label: "Recommendation & Prediction Engine", href: "/super-admin/ai/services/recommendations", icon: "·" },
        { key: "ai.services.observability", label: "AI Observability & Evaluation", href: "/super-admin/ai/services/observability", icon: "·" },
        { key: "ai.services.governance", label: "AI Governance & Explainability", href: "/super-admin/ai/services/governance", icon: "·" },
        { key: "ai.services.config", label: "AI Configuration", href: "/super-admin/ai/services/config", icon: "·" },
      ]},
    ]},
    { key: "ai.tools", group: "AI Tools & Quality Intelligence", items: [
      { key: "ai.assistant", label: "AI Assistant Chat", href: "/super-admin/assistant", icon: "💬" },
      { key: "ai.gateway", label: "AI Gateway", href: "/super-admin/platform-ops/ai-gateway", icon: "✨" },
      // HQ-IA-02 H2: the hub was linked only from its own two children.
      { key: "ai.quality", label: "Quality Intelligence", href: "/super-admin/quality-intelligence", icon: "📐", children: [
        { key: "ai.quality.indicators", label: "Metrics & Indicator Registry", href: "/super-admin/quality-intelligence/indicators", icon: "·" },
        { key: "ai.quality.root-cause", label: "Root Cause & Causal Intelligence", href: "/super-admin/quality-intelligence/root-cause", icon: "·" },
      ]},
      { key: "ai.graph", label: "Knowledge Graph", href: "/super-admin/knowledge-graph", icon: "🕸️", kind: "cross" },
      { key: "ai.audit", label: "AI Audit Log", href: "/super-admin/audit", icon: "🗒️", kind: "cross" },
      { key: "ai.approvals", label: "My Approvals", href: "/super-admin/platform-ops/approvals", icon: "✅", kind: "cross" },
    ]},
  ]},

  { key: "platform", label: "Platform Operations", icon: "🛰️", sections: [
    { key: "platform.operations", group: "Operations", items: [
      { key: "platform.overview", label: "Operations Overview", href: "/super-admin/platform-ops", icon: "🎛️" },
      { key: "platform.tenants", label: "Tenant Operations", href: "/super-admin/platform-ops/tenants", icon: "🏢" },
      { key: "platform.workspaces", label: "Workspaces", href: "/super-admin/platform-ops/workspaces", icon: "🖥️" },
      { key: "platform.licensing", label: "Licensing", href: "/super-admin/platform-ops/licensing", icon: "🧾" },
      { key: "platform.monitoring", label: "Monitoring", href: "/super-admin/platform-ops/monitoring", icon: "📡" },
      { key: "platform.notifications", label: "Notifications", href: "/super-admin/platform-ops/notifications", icon: "📨" },
      { key: "platform.control-plane", label: "Control Plane", href: "/super-admin/platform-ops/control-plane", icon: "🧭" },
      { key: "platform.platform-admin", label: "Platform Workspace", href: "/platform-admin", icon: "🛰️", kind: "external" },
    ]},
    { key: "platform.no-code", group: "No-Code Configuration", items: [
      { key: "platform.no-code.home", label: "No-Code Configuration Platform", href: "/super-admin/platform-ops/no-code-platform", icon: "🧱", children: [
        { key: "platform.no-code.studio", label: "Configuration Studio", href: "/super-admin/platform-ops/studio", icon: "·" },
        { key: "platform.no-code.registry", label: "Configuration Registry", href: "/super-admin/platform-ops/registry", icon: "·" },
        { key: "platform.no-code.schema", label: "Schema & Object Model", href: "/super-admin/platform-ops/schema", icon: "·" },
        { key: "platform.no-code.catalogue", label: "Module & Widget Catalogue", href: "/super-admin/platform-ops/catalogue", icon: "·" },
        { key: "platform.no-code.configuration", label: "Workspace Configuration Engine", href: "/super-admin/platform-ops/configuration", icon: "·" },
        { key: "platform.no-code.composer", label: "Tenant Experience Composer", href: "/super-admin/platform-ops/composer", icon: "·" },
        { key: "platform.no-code.portfolio", label: "Product Portfolio & Suites", href: "/super-admin/platform-ops/portfolio", icon: "·" },
        { key: "platform.no-code.pages", label: "Page & Layout Composer", href: "/super-admin/platform-ops/pages", icon: "·" },
        { key: "platform.no-code.navigation", label: "Navigation & Experience Designer", href: "/super-admin/platform-ops/navigation", icon: "·" },
        { key: "platform.no-code.forms", label: "Form & Data-Capture Builder", href: "/super-admin/platform-ops/forms", icon: "·" },
        { key: "platform.no-code.workflows", label: "Workflow & Automation Builder", href: "/super-admin/platform-ops/workflows", icon: "·" },
        { key: "platform.no-code.rules", label: "Rules & Decision Engine", href: "/super-admin/platform-ops/rules", icon: "·" },
        { key: "platform.no-code.permissions", label: "Role, Permission & Visibility Designer", href: "/super-admin/platform-ops/permissions", icon: "·" },
        { key: "platform.no-code.metrics", label: "Metrics & Indicator Builder", href: "/super-admin/platform-ops/metrics", icon: "·" },
        { key: "platform.no-code.reports", label: "Report & Dashboard Builder", href: "/super-admin/platform-ops/reports", icon: "·" },
        { key: "platform.no-code.documents", label: "Document Service", href: "/super-admin/platform-ops/documents", icon: "·" },
        { key: "platform.no-code.localization", label: "Localization Service", href: "/super-admin/platform-ops/localization", icon: "·" },
        { key: "platform.no-code.search", label: "Platform Search", href: "/super-admin/platform-ops/search", icon: "·" },
        { key: "platform.no-code.integration-mapper", label: "Data Source & Integration Mapper", href: "/super-admin/platform-ops/integration-mapper", icon: "·" },
        { key: "platform.no-code.dependencies", label: "Dependency Manager", href: "/super-admin/platform-ops/dependencies", icon: "·" },
        { key: "platform.no-code.packages", label: "Template & Package Manager", href: "/super-admin/platform-ops/packages", icon: "·" },
        { key: "platform.no-code.collaboration", label: "Collaboration", href: "/super-admin/platform-ops/collaboration", icon: "·" },
        { key: "platform.no-code.copilot", label: "AI Configuration Copilot", href: "/super-admin/platform-ops/copilot", icon: "·" },
        { key: "platform.no-code.testing", label: "Configuration Testing & Simulation", href: "/super-admin/platform-ops/testing", icon: "·" },
        { key: "platform.no-code.governance", label: "Configuration Governance & Release", href: "/super-admin/platform-ops/governance", icon: "·" },
        { key: "platform.no-code.releases", label: "Publishing Service", href: "/super-admin/platform-ops/releases", icon: "·" },
        { key: "platform.no-code.versions", label: "Versioning & Audit", href: "/super-admin/platform-ops/versions", icon: "·" },
        { key: "platform.no-code.migration", label: "Migration Toolkit", href: "/super-admin/platform-ops/migration", icon: "·" },
        { key: "platform.no-code.runtime", label: "Runtime & Resolution Engine", href: "/super-admin/platform-ops/runtime", icon: "·" },
        { key: "platform.no-code.analytics", label: "Configuration Analytics", href: "/super-admin/platform-ops/analytics", icon: "·" },
      ]},
    ]},
    { key: "platform.system", group: "System & Security", items: [
      { key: "platform.system.health", label: "1. System Health Dashboard", href: "/super-admin/system", icon: "💚" },
      { key: "platform.system.identity", label: "2. Identity & Access Management", href: "/super-admin/system/identity", icon: "👤" },
      { key: "platform.system.security", label: "3. Security Operations Center", href: "/super-admin/system/security", icon: "🛡️" },
      { key: "platform.system.infrastructure", label: "4. Infrastructure & Services", href: "/super-admin/system/infrastructure", icon: "🖥️" },
      { key: "platform.system.data", label: "5. Data Protection & Recovery", href: "/super-admin/system/data", icon: "💾" },
      { key: "platform.system.audit", label: "6. Security Intelligence & Audit", href: "/super-admin/system/audit", icon: "🔍" },
    ]},
    { key: "platform.settings", group: "Platform Settings", items: [
      { key: "platform.settings.settings", label: "Platform Settings", href: "/super-admin/settings", icon: "⚙️" },
      { key: "platform.settings.metadata", label: "Metadata & Tags", href: "/super-admin/metadata", icon: "🏷️" },
      { key: "platform.settings.workflows", label: "Workflow Definitions", href: "/super-admin/workflows", icon: "⚡" },
    ]},
  ]},

  { key: "governance", label: "Governance & Administration", icon: "🏛️", sections: [
    // ⚠ HQ positions: who governs the PLATFORM ITSELF. Appointing stays owner-only (the page's own rule).
    { key: "governance.people", group: "HQ People & Positions", items: [
      { key: "governance.users", label: "Users", href: "/super-admin/users", icon: "👥" },
      { key: "governance.appointments", label: "HQ Positions", href: "/super-admin/users/appointments", icon: "🏛️" },
      { key: "governance.positions", label: "Position Definitions", href: "/super-admin/users/positions", icon: "🧩" },
      // COMPETEN-SCHOLAR-GOV-IMPLEMENT-01 (migration 610): the Scholar Governance Model V1 registry. Grants nothing.
      { key: "governance.scholar", label: "Scholar Governance", href: "/super-admin/users/governance", icon: "🎓" },
      // Addendum V1.2 (migration 620): the Organisation & Governance Studio and the published structure history.
      { key: "governance.studio", label: "Organisation Studio", href: "/super-admin/users/governance/studio", icon: "🗂️" },
      { key: "governance.history", label: "Structure History", href: "/super-admin/users/governance/history", icon: "🕰️" },
    ]},
    // Migration 395 (owner decision D2): the one shared Holdings clinical-content approval, for every product.
    // Its authoritative home is here; Learning and Research carry cross-links to their queues.
    { key: "governance.clinical", group: "Clinical Content Approval", items: [
      { key: "governance.clinical.review", label: "Clinical Review", href: "/super-admin/clinical-review", icon: "🩺" },
      { key: "governance.clinical.learning", label: "Learning Review", href: "/super-admin/learning/review", icon: "📘" },
      { key: "governance.clinical.knowledge", label: "Knowledge Review", href: "/super-admin/research/knowledge-review", icon: "🔬" },
      { key: "governance.clinical.governance", label: "Clinical Review Governance", href: "/super-admin/clinical-review/governance", icon: "⚖️" },
    ]},
    { key: "governance.compliance", group: "Governance & Compliance", items: [
      { key: "governance.dashboard", label: "1. Governance Dashboard", href: "/super-admin/governance", icon: "🛡️" },
      { key: "governance.policies", label: "2. Policy & Standards Center", href: "/super-admin/governance/policies", icon: "📄" },
      { key: "governance.compliance.management", label: "3. Compliance Management", href: "/super-admin/governance/compliance", icon: "✅" },
      { key: "governance.risk", label: "4. Risk & Internal Controls", href: "/super-admin/governance/risk", icon: "⚠️" },
      { key: "governance.audit", label: "5. Audit & Assurance", href: "/super-admin/governance/audit", icon: "📋" },
      { key: "governance.accreditation", label: "6. Regulatory & Accreditation", href: "/super-admin/governance/accreditation", icon: "🏛️" },
      { key: "governance.committees", label: "Committees", href: "/super-admin/governance/committees", icon: "⚖️" },
    ]},
    { key: "governance.control", group: "Approvals & Audit", items: [
      { key: "governance.approvals", label: "Approvals", href: "/super-admin/platform-ops/approvals", icon: "🔀" },
      { key: "governance.audit-log", label: "Audit Log", href: "/super-admin/audit", icon: "🗒️" },
    ]},
  ]},
];

// ── Derived views ────────────────────────────────────────────────────────────────────────────────────

/** Items with their children flattened in, in order. What a harness or a search reasons about. */
export function flatNavItems<T extends { children?: T[] }>(items: T[]): T[] {
  return items.flatMap(i => [i, ...(i.children ?? [])]);
}

const qualified = (w: HqWorkspace, s: HqSection) => (s.plain ? w.label : `${w.label} · ${s.group}`);

/** One table per workspace, sections named in full. The sidebar, the harnesses and search read these. */
export const ALL_NAV_TABLES: { name: string; sections: NavSection[] }[] = HQ_WORKSPACES.map(w => ({
  name: w.key,
  sections: w.sections.map(s => ({ group: qualified(w, s), items: s.items })),
}));

/**
 * Transition view: every drawn section of every workspace, in order. It replaces the old single list of
 * seventeen groups for the consumers that asked "is this destination in the HQ sidebar at all".
 */
export const GENERAL_NAV: NavSection[] = ALL_NAV_TABLES.flatMap(t => t.sections);

/** Every registered destination, drawn and deep, for the search launcher. */
export const HQ_SEARCH_TABLES: { name: string; sections: NavSection[] }[] = [
  ...ALL_NAV_TABLES,
  ...HQ_WORKSPACES.filter(w => w.deep?.length).map(w => ({
    name: `${w.key}.deep`,
    sections: [{ group: w.label, items: (w.deep ?? []).map(d => ({ key: d.key, label: d.label, href: d.href, icon: "↪" })) }],
  })),
];

/**
 * The workspace that is HOME to a pathname: longest matching registered href, on a segment boundary.
 * Cross and external entries never claim a page (their home is elsewhere). /super-admin claims only
 * itself, or every unregistered route would silently resolve to Mission Control.
 */
export function hqWorkspaceForPath(pathname: string): HqWorkspaceKey {
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  let best: { len: number; key: HqWorkspaceKey } | null = null;
  for (const w of HQ_WORKSPACES) {
    const homes = [
      ...w.sections.flatMap(s => flatNavItems(s.items)).filter(i => i.kind !== "cross" && i.kind !== "external").map(i => i.href),
      ...(w.deep ?? []).map(d => d.href),
    ];
    for (const href of homes) {
      const owns = clean === href || (href !== "/super-admin" && clean.startsWith(href + "/"));
      if (owns && (!best || href.length > best.len)) best = { len: href.length, key: w.key };
    }
  }
  return best?.key ?? "mission";
}

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
