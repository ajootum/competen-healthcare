// Competen HQ — the closed set of spaces, the route→capability intent map, and the pure access decision.
//
// PLAT-ARCH-SURVEY-001 §2. No route in this file. No URL changes anywhere in this programme: the rename to
// /hq happens later and only once every page carries its own scoped guard, so that no window ever exists in
// which /hq/* is reachable ungated. Building the guard first is the entire point of doing this now.
//
// ⚠ THE SPACE IS THE CLOSED SET. THE POSITION IS DATA. A CEO and a CFO occupy the same Executive space and
// differ only by what is granted to them, so job titles live in hq_position rows and never in this union.
// The five values below are mirrored by a CHECK constraint in migration 264 — if they disagree, the
// database wins and the harness says so.
//
// ⚠ DEFAULTING TO REACHABLE IS HOW THIS PROGRAMME FAILS QUIETLY. Every default here denies: an unmapped
// route resolves to null, a null capability denies, an empty capability set denies. The only short-circuit
// to `allow` is ownership, which is deliberate — see decideHq.
//
// Pure module: no I/O, no Next imports, no Supabase. src/lib/hq/context.ts does the reading.

export const HQ_SPACES = ["executive", "platform", "practice", "learning", "quality"] as const;
export type HqSpace = (typeof HQ_SPACES)[number];

// ⚠ RECONCILIATION WITH ogs_offices' EXISTING CONTEXT KEYS, and the conflict it produced.
// holdsOfficeAppointment() already gates CMO, QAW and HEX on the keys `competency`, `quality`, `executive`
// (plus `hr`, defined but unused by any workspace). Two of those — `executive` and `quality` — collide by
// NAME with two HQ spaces while meaning something entirely different: a tenant's hospital-scoped office,
// not a platform governance space. `competency` and `hr` have no HQ space at all, and `platform`,
// `practice` and `learning` have no OGS matcher.
//
// The collision is real and it is closed by TYPE, not by name: the HQ offices carry office_type
// 'hq_<space>' and resolveOffices() filters that prefix out of the tenant matchers. An unprefixed
// 'executive' office would have made an HQ appointment silently confer Hospital Executive access — the
// exact over-grant this programme exists to prevent, arriving through its own seed data.
export const HQ_OFFICE_TYPE_PREFIX = "hq_";
export const hqOfficeType = (space: HqSpace): string => `${HQ_OFFICE_TYPE_PREFIX}${space}`;
export const isHqOfficeType = (officeType: string | null | undefined): boolean =>
  typeof officeType === "string" && officeType.startsWith(HQ_OFFICE_TYPE_PREFIX);

// Every position gets this one, so an appointed person can always reach the HQ landing page. A position
// that can sign in and see nothing at all is a support ticket, not a control.
export const HQ_HOME_CAPABILITY = "hq.platform.home.view";

// The catalogue, mirrored by migration 264 §8. The harness asserts the two agree in both directions.
export const HQ_CAPABILITIES: { code: string; space: HqSpace }[] = [
  { code: "hq.executive.command_centre.view", space: "executive" },
  { code: "hq.executive.priorities.view",     space: "executive" },
  { code: "hq.executive.reports.view",        space: "executive" },
  { code: "hq.executive.performance.view",    space: "executive" },
  { code: "hq.executive.enterprise.view",     space: "executive" },
  { code: HQ_HOME_CAPABILITY,                 space: "platform"  },
  { code: "hq.platform.ai.view",              space: "platform"  },
  // Migration 410 (AI-FAIR-USE-01): prices, FX, allowance-unit rates and product AI policies. Platform Director.
  { code: "hq.platform.ai.manage",            space: "platform"  },
  { code: "hq.platform.operations.view",      space: "platform"  },
  { code: "hq.platform.system.view",          space: "platform"  },
  { code: "hq.platform.users.view",           space: "platform"  },
  // HQ-USERS-B (migration 379): send a password-reset email to another person. Its own code, not users.view:
  // seeing who has an account is a reporting right, and acting on one is not.
  { code: "hq.platform.users.reset",          space: "platform"  },
  { code: "hq.platform.tenants.view",         space: "platform"  },
  { code: "hq.platform.settings.view",        space: "platform"  },
  { code: "hq.platform.workflows.view",       space: "platform"  },
  { code: "hq.platform.metadata.view",        space: "platform"  },
  { code: "hq.platform.audit.view",           space: "platform"  },
  // COMPETEN-IND-003 D9 (migration 370): the Competen Individual pilot-grant right. Platform space, held by
  // the Individual Product Administrator position (product line `individual`). Its one page is the pilot
  // access screen, /super-admin/individual (COMPETEN-IND-ACCESS-001 s4).
  { code: "hq.individual.pilot.grant",        space: "platform"  },
  // COMPETEN-CONFIG-002 (migration 376): set the Competen Individual policy within its fixed hard limits, on
  // /super-admin/individual/configuration. Same position. Not super-admin, not the release gate.
  { code: "hq.individual.config.manage",      space: "platform"  },
  // COMPETEN-PROFESSIONAL-PROFILE-01 part B (migration 451): record independent verification outcomes on the
  // Professional profile records a person submitted, on /super-admin/individual/verification. Held only by the
  // Professional Credential Verifier position, which nobody holds until the owner appoints someone.
  { code: "hq.individual.professional.verify", space: "platform" },
  // P1 Commercial (migration 400): create, price, activate and retire the Competen Individual plans, through
  // /api/hq/individual/plans. Granted to NO position -- the platform owners only, until a separate owner GO.
  { code: "hq.individual.commercial.manage",  space: "platform"  },
  { code: "hq.practice.operations.view",      space: "practice"  },
  // ⚠ ADDED BY MIGRATION 273, and this list had to follow it. The DB gained the capability and this
  // catalogue did not, so B1 went red -- which is the drift control working.
  //
  // ⚠⚠ AND THE SENTENCE THAT USED TO FOLLOW HERE WAS WRONG. It said "decideHq() answers from THIS list,
  // so a capability the database grants and the code has never heard of grants nothing at runtime."
  // It does not. decideHq() answers from `input.capabilities`, and resolveHqPositions() builds that by
  // reading hq_position_capability DIRECTLY -- this catalogue never filters it (context.ts:153-161).
  //
  // The nineteen codes below were granted in the database and absent here for the whole PD build, and
  // every one of them worked. So the true consequence of this drift is the reverse of what was written:
  // the runtime is FINE and the CODE IS BLIND. Anything reasoning about the capability estate from this
  // list -- the nav filter, the access scanner, the space grouping -- was reasoning over two thirds of it.
  // A stale allowlist that grants nothing is a lockout; a stale allowlist that filters nothing is a blind
  // spot, and the second is the one you do not notice.
  //
  // It is the operator licence door (PLAT-OVERSIGHT-SURVEY-001 D5): a WRITE, and the only operator-side
  // write over a practitioner identity, which is why it is its own code rather than folded into the view.
  { code: "hq.practice.licence.verify",       space: "practice"  },

  // ── CPR-PD: the Product Director workspace, one capability per PD-001 nav destination ───────────
  // Seeded by the PD migrations and granted to positions; this list is catching up with them.
  { code: "hq.practice.mission.view",         space: "practice"  },
  { code: "hq.practice.practices.view",       space: "practice"  },
  { code: "hq.practice.practitioners.view",   space: "practice"  },
  { code: "hq.practice.intelligence.view",    space: "practice"  },
  { code: "hq.practice.adoption.view",        space: "practice"  },
  { code: "hq.practice.commercial.view",      space: "practice"  },
  { code: "hq.practice.health.view",          space: "practice"  },
  { code: "hq.practice.support.view",         space: "practice"  },
  { code: "hq.practice.governance.view",      space: "practice"  },
  { code: "hq.practice.configuration.view",   space: "practice"  },
  { code: "hq.practice.releases.view",        space: "practice"  },

  // ⚠ THE WRITES, KEPT SEPARATE FROM THE VIEWS ON PURPOSE. CPR-PD-010 s19 requires exactly this split:
  // "Separate capabilities for viewing risks, editing assessments, testing controls, approving decisions,
  // accepting risk, managing exceptions, viewing restricted security/privacy evidence and exporting" --
  // and s19 continues that the Product Director "must not automatically self-approve every high-risk
  // acceptance". A single .manage code covering both would make that segregation unexpressible.
  { code: "hq.practice.provision.execute",    space: "practice"  },
  // Migration 367. Setting a practice's plan window is deliberately NOT commercial.view: seeing which
  // practices are on which plan is a reporting right, and deciding how long a clinician keeps access to
  // their own diary is not the same act. The split is the same one this block exists for.
  { code: "hq.practice.commercial.manage",    space: "practice"  },
  { code: "hq.practice.flags.manage",         space: "practice"  },
  { code: "hq.practice.release.activate",     space: "practice"  },
  { code: "hq.practice.release.rollback",     space: "practice"  },
  { code: "hq.practice.export.execute",       space: "practice"  },
  { code: "hq.practice.change.approve",       space: "practice"  },
  { code: "hq.practice.risk.accept",          space: "practice"  },
  { code: "hq.practice.configuration.manage", space: "practice"  },
  // Migration 344. Records a human attestation against a launch control. Deliberately NOT flags.manage
  // (the doer attesting their own doing) and NOT change.approve (PD-012 s21's checker half, held by
  // nobody): an attestation states what was observed and authorises nothing.
  { code: "hq.practice.launch.attest",       space: "practice"  },
  { code: "hq.learning.competencies.view",    space: "learning"  },
  { code: "hq.learning.content.view",         space: "learning"  },
  { code: "hq.learning.studio.view",          space: "learning"  },
  { code: "hq.learning.delivery.view",        space: "learning"  },
  { code: "hq.learning.knowledge.view",       space: "learning"  },
  { code: "hq.learning.assessment.view",      space: "learning"  },
  { code: "hq.learning.schedules.view",       space: "learning"  },
  { code: "hq.learning.import.view",          space: "learning"  },
  { code: "hq.quality.assurance.view",        space: "quality"   },
  { code: "hq.quality.intelligence.view",     space: "quality"   },
  { code: "hq.quality.governance.view",       space: "quality"   },
  { code: "hq.quality.regulation.view",       space: "quality"   },
  { code: "hq.quality.policy.view",           space: "quality"   },
  // Migration 395, owner decision D2: Holdings clinical-content approval. Approve is the Clinical Content
  // Reviewer position; govern (reviewer scopes, review counts) is granted to the Quality Council Member.
  { code: "hq.quality.clinical.approve",      space: "quality"   },
  { code: "hq.quality.clinical.govern",       space: "quality"   },
  // Migration 422, AI-CONSUMPTION-01 C2/C3: the governed case library. Author is the Clinical Case Educator
  // position, publish is the Quality Council Member. Case review uses hq.quality.clinical.approve and its scopes.
  { code: "hq.quality.case.author",           space: "quality"   },
  { code: "hq.quality.case.publish",          space: "quality"   },
  // Migration 440, COMPETEN-KNOWLEDGE-RESEARCH-01 K1: CKRI research governance. Govern is the Research Governance
  // Officer and the Quality Council Member, propose is the Research Lead. Both re-checked by the 440 triggers.
  { code: "hq.quality.research.govern",       space: "quality"   },
  { code: "hq.quality.research.propose",      space: "quality"   },
  // Migration 442, K3: educator knowledge improvement (Knowledge Educator) and resource publication (Quality Council
  // Member). Clinical approval of a resource is hq.quality.clinical.approve, the 395 reviewer right, unchanged.
  { code: "hq.learning.ckri.educator",        space: "learning"  },
  { code: "hq.quality.knowledge.publish",     space: "quality"   },
  // Migration 443, K4: independent scientific review of research outputs (Research Scientific Reviewer).
  { code: "hq.quality.research.review",       space: "quality"   },
];

export const HQ_CAPABILITY_CODES = HQ_CAPABILITIES.map(c => c.code);
export const spaceOfCapability = (code: string): HqSpace | null =>
  HQ_CAPABILITIES.find(c => c.code === code)?.space ?? null;

// ── The route→capability intent map ──────────────────────────────────────────
// ⚠ ORDER IS LOAD-BEARING: first match wins, so the longer prefix must come first.
// /super-admin/platform-ops/practice is the Practice product's pilot gate and belongs to the PRACTICE
// space, not to Platform — and it sits underneath /super-admin/platform-ops, so it has to be declared
// above it or it would be swallowed.
//
// A prefix matches the segment boundary only: "/super-admin/ai" must not claim "/super-admin/aircraft".
//
// ⚠ AND THE LAST ENTRY IS `exact`, WHICH IS THE WHOLE POINT OF THE MAP. It was written first as an ordinary
// prefix, and that made the "a new route must be refused" rule unfalsifiable: /super-admin matches every
// descendant, so a brand-new module would have silently resolved to the HQ home capability that every
// position holds, and the assertion proving otherwise could never have gone red. The root page matches
// itself and nothing beneath it, so a module nobody declared resolves to null -- and null denies.
export const HQ_ROUTE_INTENT: { prefix: string; capability: string; exact?: boolean }[] = [
  { prefix: "/super-admin/platform-ops/practice", capability: "hq.practice.operations.view" },
  { prefix: "/super-admin/platform-ops",          capability: "hq.platform.operations.view" },
  { prefix: "/super-admin/command-centre",        capability: "hq.executive.command_centre.view" },
  { prefix: "/super-admin/priorities",            capability: "hq.executive.priorities.view" },
  { prefix: "/super-admin/reports",               capability: "hq.executive.reports.view" },
  { prefix: "/super-admin/performance",           capability: "hq.executive.performance.view" },
  { prefix: "/super-admin/enterprise",            capability: "hq.executive.enterprise.view" },
  // AI-FAIR-USE-01 (migration 410). Before /super-admin/ai: the first matching prefix wins, and the fair-use
  // page must not be reachable on the view right.
  { prefix: "/super-admin/ai/fair-use",           capability: "hq.platform.ai.manage" },
  { prefix: "/super-admin/ai",                    capability: "hq.platform.ai.view" },
  { prefix: "/super-admin/assistant",             capability: "hq.platform.ai.view" },
  { prefix: "/super-admin/system",                capability: "hq.platform.system.view" },
  { prefix: "/super-admin/users",                 capability: "hq.platform.users.view" },
  { prefix: "/super-admin/hospitals",             capability: "hq.platform.tenants.view" },
  { prefix: "/super-admin/organisations",         capability: "hq.platform.tenants.view" },
  { prefix: "/super-admin/settings",              capability: "hq.platform.settings.view" },
  { prefix: "/super-admin/workflows",             capability: "hq.platform.workflows.view" },
  { prefix: "/super-admin/metadata",              capability: "hq.platform.metadata.view" },
  { prefix: "/super-admin/audit",                 capability: "hq.platform.audit.view" },
  { prefix: "/super-admin/competencies",          capability: "hq.learning.competencies.view" },
  { prefix: "/super-admin/content",               capability: "hq.learning.content.view" },
  { prefix: "/super-admin/studio",                capability: "hq.learning.studio.view" },
  { prefix: "/super-admin/delivery",              capability: "hq.learning.delivery.view" },
  { prefix: "/super-admin/knowledge-graph",       capability: "hq.learning.knowledge.view" },
  { prefix: "/super-admin/ckp",                   capability: "hq.learning.knowledge.view" },
  { prefix: "/super-admin/assessment-methods",    capability: "hq.learning.assessment.view" },
  { prefix: "/super-admin/scoring",               capability: "hq.learning.assessment.view" },
  { prefix: "/super-admin/schedules",             capability: "hq.learning.schedules.view" },
  { prefix: "/super-admin/import",                capability: "hq.learning.import.view" },
  { prefix: "/super-admin/assurance",             capability: "hq.quality.assurance.view" },
  { prefix: "/super-admin/quality-intelligence",  capability: "hq.quality.intelligence.view" },
  // Migration 395 (D2). Governance first: the first matching prefix wins, and it must not inherit approve.
  { prefix: "/super-admin/clinical-review/governance", capability: "hq.quality.clinical.govern" },
  { prefix: "/super-admin/clinical-review",       capability: "hq.quality.clinical.approve" },
  // Migrations 422-423 (COMPETEN-HOLDINGS-AI-CONSUMPTION-01 C2-C3, s11). Publication and intelligence first: the first
  // matching prefix wins, and they must not inherit author.
  { prefix: "/super-admin/cases/publication",     capability: "hq.quality.case.publish" },
  { prefix: "/super-admin/cases/intelligence",    capability: "hq.quality.case.publish" },
  { prefix: "/super-admin/cases",                 capability: "hq.quality.case.author" },
  // Migration 440 (COMPETEN-KNOWLEDGE-RESEARCH-01 K1). Governance first: it must not inherit the workspace's propose.
  { prefix: "/super-admin/research/governance",   capability: "hq.quality.research.govern" },
  { prefix: "/super-admin/research/intelligence", capability: "hq.quality.research.govern" },
  // Migration 442 (K3). Each its own right: educators, the 395 reviewer, the publisher.
  { prefix: "/super-admin/research/educator",     capability: "hq.learning.ckri.educator" },
  { prefix: "/super-admin/research/knowledge-review", capability: "hq.quality.clinical.approve" },
  { prefix: "/super-admin/research/knowledge-publication", capability: "hq.quality.knowledge.publish" },
  // Migration 443 (K4). Oversight and review before the workspace: the first matching prefix wins.
  { prefix: "/super-admin/research/oversight",    capability: "hq.quality.research.govern" },
  { prefix: "/super-admin/research/scientific-review", capability: "hq.quality.research.review" },
  { prefix: "/super-admin/research",              capability: "hq.quality.research.propose" },
  { prefix: "/super-admin/governance",            capability: "hq.quality.governance.view" },
  { prefix: "/super-admin/cgr",                   capability: "hq.quality.regulation.view" },
  { prefix: "/super-admin/policy-manager",        capability: "hq.quality.policy.view" },
  // The policy page only. /super-admin/individual itself is the pilot-grant page (IND-ACCESS-001, exact).
  { prefix: "/super-admin/individual/configuration", capability: "hq.individual.config.manage" },
  // COMPETEN-SCHOLAR-JOIN-01: the Scholar programmes the policy chooses from -- the same right as the policy page.
  { prefix: "/super-admin/individual/programmes", capability: "hq.individual.config.manage" },
  // P0 controlled catalogues (migration 394): the same administrator curates what a catalogue names.
  { prefix: "/super-admin/individual/catalogues", capability: "hq.individual.config.manage" },
  // COMPETEN-PROFESSIONAL-PROFILE-01 part B (migration 451): the Professional Credential Verifier's queue. Its own
  // right, held by no position but the verifier one, and by nobody until the owner appoints someone.
  { prefix: "/super-admin/individual/verification", capability: "hq.individual.professional.verify" },
  // COMPETEN-IND-ACCESS-001 s4: the Competen Individual pilot access screen. The capability already existed
  // (migration 370, D9) with no page; this declares the page it opens, so the intent map stays the whole truth.
  // EXACT: the screen has no sub-routes, and a sibling Individual HQ page (IND-007 configuration) must not
  // inherit the pilot-grant right by sitting under this prefix -- it declares its own entry.
  { prefix: "/super-admin/individual",            capability: "hq.individual.pilot.grant", exact: true },

  // ── The Product Director workspace ────────────────────────────────────────────────────────────────
  //
  // ⚠ ALL 86 OF THESE PAGES WERE ABSENT FROM THIS MAP UNTIL 2026-08-27, and hq-guard I1 had been red
  // about it. Nothing was reachable that should not have been: every one of the 86 passes its capability
  // to requireHqCapability EXPLICITLY, so `capability ?? capabilityForRoute(route)` in context.ts always
  // took the explicit value and never consulted this map. The gap was in the DECLARATION, not the gate.
  //
  // These eleven entries are a transcription, not a decision. Measured across all 291 /super-admin pages
  // before they were written: 205 already agreed with this map, 86 had no entry, and ZERO disagreed --
  // and each PD module enforces exactly one capability across every page beneath it, so each prefix has
  // one unambiguous answer. I6 now asserts that agreement for the whole estate, so a module can never
  // again be built without being declared here.
  { prefix: "/super-admin/pd/adoption",           capability: "hq.practice.adoption.view" },
  { prefix: "/super-admin/pd/commercial",         capability: "hq.practice.commercial.view" },
  { prefix: "/super-admin/pd/configuration",      capability: "hq.practice.configuration.view" },
  { prefix: "/super-admin/pd/governance",         capability: "hq.practice.governance.view" },
  { prefix: "/super-admin/pd/health",             capability: "hq.practice.health.view" },
  { prefix: "/super-admin/pd/intelligence",       capability: "hq.practice.intelligence.view" },
  { prefix: "/super-admin/pd/operations",         capability: "hq.practice.operations.view" },
  { prefix: "/super-admin/pd/practices",          capability: "hq.practice.practices.view" },
  { prefix: "/super-admin/pd/practitioners",      capability: "hq.practice.practitioners.view" },
  { prefix: "/super-admin/pd/releases",           capability: "hq.practice.releases.view" },
  { prefix: "/super-admin/pd/support",            capability: "hq.practice.support.view" },

  { prefix: "/super-admin",                       capability: HQ_HOME_CAPABILITY, exact: true },
];

/**
 * The declared capability for a route, or null when nobody has mapped it.
 *
 * ⚠ NULL IS NOT "OPEN". A route this map does not know is a route whose intended audience nobody has
 * written down, and decideHq refuses it for every non-owner. That is the second of the two defaults the
 * survey identified as set the wrong way round — the other is landlordCan's empty-`required` branch.
 */
export function capabilityForRoute(route: string): string | null {
  const clean = route.split("?")[0].replace(/\/+$/, "") || "/";
  for (const { prefix, capability, exact } of HQ_ROUTE_INTENT) {
    if (clean === prefix) return capability;
    if (!exact && clean.startsWith(prefix + "/")) return capability;
  }
  return null;
}

// ── The decision ─────────────────────────────────────────────────────────────

export type HqMode = "observe" | "enforce";
export type HqDecision = "allow" | "allow_owner" | "would_deny" | "deny";

export type HqDecisionInput = {
  /** super_admin (the break-glass anchor) or platform_owner. Short-circuits everything below. */
  isOwner: boolean;
  /** hq_position codes held through a live ogs_office_appointments row. */
  positions: string[];
  /** union of the capabilities those positions currently grant, time bounds already applied. */
  capabilities: string[];
  /** the capability the route declares — null when the route is unmapped, which denies. */
  capability: string | null;
  mode: HqMode;
};

export type HqDecisionResult = {
  /** whether the request PROCEEDS. In observe mode a would_deny still proceeds — that is what observe is. */
  allowed: boolean;
  /** what the position model actually concluded, which is what gets written to hq_access_observation. */
  decision: HqDecision;
  reason: string;
};

/**
 * ⚠ OBSERVE MODE MUST NEVER BE WIDER THAN THE GATE IT REPLACES. There are two gates here, not one:
 *
 *   THE HARD GATE — owner, or at least one live HQ appointment — is enforced in BOTH modes. Today the only
 *   way into /super-admin is the AppRole super_admin, and with ogs_office_appointments empty this evaluates
 *   identically for all 49 live profiles. Observe mode therefore opens nothing.
 *
 *   THE SOFT GATE — does this position actually hold the route's capability — is recorded in observe mode
 *   and enforced in enforce mode. That is the whole migration path: run it, read hq_access_observation,
 *   correct the map, and only then flip hq_config.mode.
 *
 * ⚠ AND THE FAILURE THAT OUTRANKS EVERY OTHER IS LOCKING THE OWNER OUT. There are two real super_admin
 * accounts and neither holds an MFA factor. `isOwner` is tested FIRST, before any HQ table is consulted, so
 * no seed row, no missing grant and no unreachable database can refuse an owner. A guard that denies too
 * much is worse than the status quo, because the people who could fix it are the people locked out.
 */
export function decideHq(input: HqDecisionInput): HqDecisionResult {
  if (input.isOwner) return { allowed: true, decision: "allow_owner", reason: "platform owner (break-glass)" };

  // Hard gate. Not observable, not deferrable: no appointment means not an HQ user at all.
  if (input.positions.length === 0)
    return { allowed: false, decision: "deny", reason: "no HQ position held" };

  const soft = (reason: string): HqDecisionResult =>
    input.mode === "enforce"
      ? { allowed: false, decision: "deny", reason }
      : { allowed: true, decision: "would_deny", reason };

  // ⚠ An unmapped route denies. See capabilityForRoute.
  if (!input.capability) return soft("route declares no capability");

  if (!input.capabilities.includes(input.capability))
    return soft(`position(s) ${input.positions.join(", ")} do not hold ${input.capability}`);

  return { allowed: true, decision: "allow", reason: `capability ${input.capability} held` };
}

/** Capability grants whose time window is open at `now`. Mirrors practice_role_assignment's semantics. */
export function activeGrants<T extends { effective_from?: string | null; effective_to?: string | null }>(
  rows: T[],
  now: number = Date.now(),
): T[] {
  return rows.filter(r => {
    const from = r.effective_from ? new Date(r.effective_from).getTime() : Number.NEGATIVE_INFINITY;
    const to = r.effective_to ? new Date(r.effective_to).getTime() : Number.POSITIVE_INFINITY;
    return from <= now && now < to;
  });
}
