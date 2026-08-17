// CPR-PD-001 — THE PRACTICE PRODUCT DIRECTOR SIDEBAR, AS DATA.
//
// Same rules as nav-tables.ts beside it: no "use client", no imports, no JSX, so a harness can assert
// against the table that actually ships rather than a fixture copied into a script.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS IS A FROZEN INFORMATION ARCHITECTURE (PD-001 s2, s11). The twelve destinations, their four
// groups, their order and their labels are prescribed. PD-001 s9: "Use stable item order; do not
// reorder navigation dynamically based on alerts or usage" and "use concise labels exactly as
// prescribed unless a later approved information-architecture change replaces them". So this file is
// edited by an approved IA change, not by preference — scripts/pd-nav-harness.ts holds it to that.
//
// ⚠ AND IT IS NOT THE HQ SIDEBAR. Competen HQ governs all four product lines (see
// src/lib/governance/product-lines.ts); this governs ONE. The two are separate tables rendered by
// separate components on purpose: PD-001 s7 requires that "product switching occurs through the
// HQ/product context architecture rather than by mixing unrelated product sidebars", and the fastest
// way to break that rule is to grow one table until it serves both.
//
// ⚠ CHILDREN ARE DESTINATIONS, NOT AN ACCORDION. PD-001 s8: "Top-level sidebar items should route
// directly to their overview page. Items with children may expose a disclosure control, but clicking
// the label must still have a predictable destination. Avoid accordion behavior that forces repeated
// expansion for common navigation." Every parent below therefore has its own href, and its children
// are additional destinations rather than the only way in.

export type PdNavChild = { label: string; href: string };
export type PdNavItem = { label: string; href: string; icon: string; children?: PdNavChild[] };
export type PdNavGroup = { group: string; items: PdNavItem[] };

/** The four groups, in PD-001 s2's order. Exported so a harness cannot drift from the table. */
export const PD_GROUPS = ["OPERATE", "UNDERSTAND", "CONTROL", "MANAGE"] as const;

/** Where a Product Director lands. PD-001 s8: "Mission Control is the default Product Director landing
 *  route. It must not route to the existing technical Practice Operations page." */
export const PD_HOME = "/super-admin";

export const PD_NAV: PdNavGroup[] = [
  { group: "OPERATE", items: [
    { label: "Mission Control", href: PD_HOME, icon: "🎛️" },

    { label: "Practices", href: "/super-admin/pd/practices", icon: "🏥" },
    { label: "Practitioners", href: "/super-admin/pd/practitioners", icon: "👥" },

    // ⚠ PD-001 s3 — THE EXISTING PAGE IS RE-PARENTED HERE, NOT REPLACED. "The current Competen Practice
    // module shown in the existing build must be retained and reorganised under Product Operations."
    // Technical Operations / Diagnostics points AT the page that already exists
    // (super-admin/platform-ops/practice) rather than at a rewrite of it: that page is the only caller
    // of the provisioning API, and it carries the IAM-001 s14 gate ledger whose auto-vs-manual split is
    // its whole honesty. s3 also says why the diagnostics child exists at all — "raw implementation
    // details (UUIDs, database row counts, migration identifiers, saga step names…) must not dominate
    // Product Director Mission Control. They belong in Technical Operations / Diagnostics."
    { label: "Product Operations", href: "/super-admin/pd/operations", icon: "⚙️", children: [
      { label: "Operations Overview", href: "/super-admin/pd/operations" },
      { label: "Provisioning & Onboarding", href: "/super-admin/pd/operations/provisioning" },
      { label: "Practice Workspaces", href: "/super-admin/pd/operations/workspaces" },
      { label: "Launch Readiness", href: "/super-admin/pd/operations/launch-readiness" },
      { label: "Technical Operations", href: "/super-admin/platform-ops/practice" },
    ]},
  ]},

  { group: "UNDERSTAND", items: [
    { label: "Product Intelligence", href: "/super-admin/pd/intelligence", icon: "📈", children: [
      { label: "Overview", href: "/super-admin/pd/intelligence" },
      { label: "Adoption", href: "/super-admin/pd/intelligence/adoption" },
      { label: "Engagement", href: "/super-admin/pd/intelligence/engagement" },
      { label: "Retention", href: "/super-admin/pd/intelligence/retention" },
      { label: "Feature Intelligence", href: "/super-admin/pd/intelligence/features" },
      { label: "Cohorts", href: "/super-admin/pd/intelligence/cohorts" },
      { label: "Markets", href: "/super-admin/pd/intelligence/markets" },
      { label: "Practice Segments", href: "/super-admin/pd/intelligence/practice-segments" },
      { label: "Practitioner Segments", href: "/super-admin/pd/intelligence/practitioner-segments" },
      { label: "Funnel Analysis", href: "/super-admin/pd/intelligence/funnel" },
      { label: "Trends & Comparisons", href: "/super-admin/pd/intelligence/trends" },
    ]},
    { label: "Adoption & Growth", href: "/super-admin/pd/adoption", icon: "📊" },
    { label: "Commercial", href: "/super-admin/pd/commercial", icon: "💳", children: [
      { label: "Commercial Overview", href: "/super-admin/pd/commercial" },
      { label: "Plans & Pricing", href: "/super-admin/pd/commercial/plans" },
      { label: "Trials", href: "/super-admin/pd/commercial/trials" },
      { label: "Subscriptions", href: "/super-admin/pd/commercial/subscriptions" },
      { label: "Conversion", href: "/super-admin/pd/commercial/conversion" },
      { label: "Revenue Intelligence", href: "/super-admin/pd/commercial/revenue" },
      { label: "Payments & Collections", href: "/super-admin/pd/commercial/payments" },
      { label: "Churn & Retention", href: "/super-admin/pd/commercial/churn" },
      { label: "Discounts & Promotions", href: "/super-admin/pd/commercial/promotions" },
      { label: "Commercial Cohorts", href: "/super-admin/pd/commercial/cohorts" },
      { label: "Forecasting", href: "/super-admin/pd/commercial/forecasting" },
    ]},
  ]},

  { group: "CONTROL", items: [
    { label: "Product Health", href: "/super-admin/pd/health", icon: "💚", children: [
      { label: "Health Overview", href: "/super-admin/pd/health" },
      { label: "Services & Components", href: "/super-admin/pd/health/services" },
      { label: "Availability & Performance", href: "/super-admin/pd/health/availability" },
      { label: "Errors & Failures", href: "/super-admin/pd/health/errors" },
      { label: "Workflow Health", href: "/super-admin/pd/health/workflows" },
      { label: "Data & Sync Health", href: "/super-admin/pd/health/data-sync" },
      { label: "Integrations", href: "/super-admin/pd/health/integrations" },
      { label: "Communications Health", href: "/super-admin/pd/health/communications" },
      { label: "AI Health", href: "/super-admin/pd/health/ai" },
      { label: "Security Signals", href: "/super-admin/pd/health/security-signals" },
      { label: "Health History", href: "/super-admin/pd/health/history" },
    ]},
    { label: "Support & Incidents", href: "/super-admin/pd/support", icon: "🛟", children: [
      { label: "Overview", href: "/super-admin/pd/support" },
      { label: "Support Cases", href: "/super-admin/pd/support/cases" },
      { label: "Incident Management", href: "/super-admin/pd/support/incidents" },
      { label: "Incident 360", href: "/super-admin/pd/support/incident-360" },
      { label: "Escalations", href: "/super-admin/pd/support/escalations" },
      { label: "Affected Practices & Practitioners", href: "/super-admin/pd/support/affected" },
      { label: "Communications", href: "/super-admin/pd/support/communications" },
      { label: "Problem Management", href: "/super-admin/pd/support/problems" },
      { label: "Root Cause & Postmortems", href: "/super-admin/pd/support/postmortems" },
      { label: "Corrective Actions", href: "/super-admin/pd/support/corrective-actions" },
      { label: "Support Intelligence", href: "/super-admin/pd/support/intelligence" },
    ]},
    // PD-010 s2's eleven submodules. s1 draws the boundary the labels alone do not: Health DETECTS,
    // Support COORDINATES, Operations REMEDIATES, and this ASSESSES — "it does not operate day-to-day
    // product workflows".
    { label: "Governance & Risk", href: "/super-admin/pd/governance", icon: "🛡️", children: [
      { label: "Governance Overview", href: "/super-admin/pd/governance" },
      { label: "Product Risk Register", href: "/super-admin/pd/governance/risks" },
      { label: "Controls & Assurance", href: "/super-admin/pd/governance/controls" },
      { label: "Privacy & Data Governance", href: "/super-admin/pd/governance/privacy" },
      { label: "Security Governance", href: "/super-admin/pd/governance/security" },
      { label: "Clinical Safety Governance", href: "/super-admin/pd/governance/clinical-safety" },
      { label: "Compliance & Obligations", href: "/super-admin/pd/governance/compliance" },
      { label: "Decisions & Approvals", href: "/super-admin/pd/governance/decisions" },
      { label: "Exceptions & Risk Acceptance", href: "/super-admin/pd/governance/exceptions" },
      { label: "Audit & Evidence", href: "/super-admin/pd/governance/evidence" },
      { label: "Governance Reviews", href: "/super-admin/pd/governance/reviews" },
    ]},
  ]},

  { group: "MANAGE", items: [
    { label: "Product Configuration", href: "/super-admin/pd/configuration", icon: "🎚️", children: [
      { label: "Configuration Overview", href: "/super-admin/pd/configuration" },
      { label: "Practice Defaults", href: "/super-admin/pd/configuration/defaults" },
      { label: "Clinical Configuration", href: "/super-admin/pd/configuration/clinical" },
      { label: "Scheduling & Booking", href: "/super-admin/pd/configuration/scheduling" },
      { label: "Encounter Configuration", href: "/super-admin/pd/configuration/encounters" },
      { label: "Documents & Templates", href: "/super-admin/pd/configuration/documents" },
      { label: "Communications", href: "/super-admin/pd/configuration/communications" },
      { label: "Commercial Configuration", href: "/super-admin/pd/configuration/commercial" },
      { label: "Market & Localization", href: "/super-admin/pd/configuration/markets" },
      { label: "AI Configuration", href: "/super-admin/pd/configuration/ai" },
      { label: "Configuration History", href: "/super-admin/pd/configuration/history" },
    ]},
    { label: "Releases & Capabilities", href: "/super-admin/pd/releases", icon: "🚀", children: [
      { label: "Overview", href: "/super-admin/pd/releases" },
      { label: "Capability Registry", href: "/super-admin/pd/releases/capabilities" },
      { label: "Release Management", href: "/super-admin/pd/releases/management" },
      { label: "Feature Flags", href: "/super-admin/pd/releases/flags" },
      { label: "Rollout Management", href: "/super-admin/pd/releases/rollout" },
      { label: "Entitlements & Availability", href: "/super-admin/pd/releases/entitlements" },
      { label: "Market Availability", href: "/super-admin/pd/releases/markets" },
      { label: "Plan Availability", href: "/super-admin/pd/releases/plans" },
      { label: "Pilot & Early Access", href: "/super-admin/pd/releases/pilot" },
      { label: "Dependencies & Readiness", href: "/super-admin/pd/releases/dependencies" },
      { label: "Rollback & Recovery", href: "/super-admin/pd/releases/rollback" },
      { label: "Release History", href: "/super-admin/pd/releases/history" },
    ]},
  ]},
];

/** Every destination in the table, parents and children, deduplicated. */
export const PD_ALL_HREFS: string[] = [...new Set(
  PD_NAV.flatMap(g => g.items.flatMap(i => [i.href, ...(i.children ?? []).map(c => c.href)])),
)];

/**
 * ⚠ THE ONE DESTINATION THAT IS NOT OURS. Technical Operations points at the pre-existing
 * platform-ops page, which keeps its own guard and its own capability. It is listed here so the
 * re-parenting in PD-001 s3 is visible in the table rather than being a fact somebody has to know —
 * and excluded from the routes this workspace is responsible for creating.
 */
export const PD_EXTERNAL_HREFS: string[] = ["/super-admin/platform-ops/practice"];
