// ── THE ACCESS DOOR REGISTRY ── COMP-ACCESS-ARCH-001 s5-s10 / COMP-ACCESS-IMP-001 s5 ────────────────
//
// ⚠ THIS MODULE IMPORTS NOTHING -- the constants-file rule (see src/lib/enterprise-constants.ts for
// the day the trap nearly recurred). The door pages, the staff gateway and the harness all read it,
// and an import here would drag whichever graph it names into all of them.
//
// ⚠ PATH-BASED DOORS, BY RECORDED CONSTRAINT. The spec sketches subdomain-per-door
// (practice.<domain>, staff.<domain>) and per-door token audiences ("aud: competen-practice").
// Neither is buildable from this repository: one GoTrue project mints one audience, and no DNS
// access exists yet. The spec itself allows this -- ARCH s13: "Exact domains remain configurable;
// the architecture requires separation, not these literal hostnames." So each door is a PATH, and
// the subdomain mapping is deployment configuration for the day the domain estate exists. This
// registry is written so that day is a transcription, not a redesign.
//
// ⚠ A DOOR MAY EXIST WHILE THE ROOM IS BEING BUILT -- it must say so, never pretend. `status` is the
// honesty axis: a `being_built` door renders the coming-soon pattern with NO password field, and the
// harness (scripts/access-doors-harness.ts) fails any drift. `truth` is the sentence that must stay
// true of the door today; it exists so the harness and a human reviewer test the same claim.
//
// The keys deliberately mirror COMP-ACCESS-IMP-001 s5's configuration model (door_code,
// display_name, entry route, security plane) -- implemented as a TYPED IN-REPO REGISTRY, not a
// database table. Recorded choice: docs/COMP-ACCESS-SURVEY-001.md s5. The spec asks for
// configuration-driven doors, not runtime-reconfigurable ones, and every consumer ships with this
// repo; a table would add a read, an outage mode and a drift surface for zero runtime callers.

/** ARCH s4's three trust planes. */
export type AccessPlane = "customer" | "staff" | "landlord";

export type DoorStatus =
  | "live"          // the door authenticates people today
  | "flag_gated"    // the real form exists behind a platform flag; off renders an honest closed state
  | "being_built"   // the product does not exist; the door says so and carries NO credential field
  | "restricted";   // not advertised anywhere public; reached by those who administer the platform

export type AccessDoor = {
  /** Stable identifier -- IMP s5 `door_code`. */
  code: "PRACTICE" | "ENTERPRISE" | "INDIVIDUAL" | "RECRUITMENT" | "STAFF" | "LANDLORD";
  /** Branded login title -- IMP s5 `display_name`. */
  name: string;
  /** The path-based entry (subdomain mapping deferred to deployment config -- header comment). */
  path: string;
  /** Where the door's page source lives, repo-relative -- the harness's existence scan reads it. */
  sourceFile: string;
  plane: AccessPlane;
  status: DoorStatus;
  /** The sentence that must stay true of this door today. */
  truth: string;
};

export const ACCESS_DOORS: readonly AccessDoor[] = [
  {
    code: "PRACTICE",
    name: "Competen Practice",
    path: "/practice/sign-in",
    sourceFile: "src/app/practice/sign-in/page.tsx",
    plane: "customer",
    status: "flag_gated",
    truth:
      "Signs into central Competen identity; the practice_sign_in flag decides whether the form "
      + "renders, and the closed state says sign-in is not open rather than showing a dead form.",
  },
  {
    code: "ENTERPRISE",
    name: "Competen Enterprise",
    path: "/enterprise/sign-in",
    sourceFile: "src/app/enterprise/sign-in/page.tsx",
    plane: "customer",
    status: "live",
    truth:
      "A thin branded wrapper that funnels to /login?next=/enterprise -- the one identity. It holds "
      + "no credential field of its own and claims no entitlement; the shell resolves membership.",
  },
  {
    code: "INDIVIDUAL",
    name: "Competen Individual",
    path: "/individual/sign-in",
    sourceFile: "src/app/individual/sign-in/page.tsx",
    plane: "customer",
    status: "being_built",
    truth: "The product is being built; the door says so before anything else and has no password field.",
  },
  {
    code: "RECRUITMENT",
    name: "Competen Recruitment",
    path: "/recruitment/sign-in",
    sourceFile: "src/app/recruitment/sign-in/page.tsx",
    plane: "customer",
    status: "being_built",
    truth: "The product is being built; the door says so before anything else and has no password field.",
  },
  {
    code: "STAFF",
    name: "Competen Staff Access",
    path: "/staff",
    sourceFile: "src/app/staff/page.tsx",
    plane: "staff",
    status: "live",
    truth:
      "Authenticates through the one identity, then routes ONLY to workspaces the account actually "
      + "holds -- appointments and roles decide, and every destination re-checks on arrival.",
  },
  {
    code: "LANDLORD",
    name: "Landlord Control Plane",
    path: "/platform/control-plane",
    sourceFile: "src/app/platform/control-plane/layout.tsx",
    plane: "landlord",
    status: "restricted",
    truth:
      "Gated on the landlord axis (getLandlordCaller) and linked from no public page. It has no "
      + "separate sign-in surface, no privileged session and no strong MFA -- deferred, not faked.",
  },
];

/**
 * The shared identity funnel every customer-plane door resolves to. Not one of the six doors: it is
 * the estate sign-in that PW-014 governs (universal landing on /dashboard), and the staff gateway
 * deliberately does NOT change it -- docs/COMP-ACCESS-SURVEY-001.md s1.4.
 */
export const SHARED_IDENTITY_DOOR = "/login";
