// COMP-ACCESS-URL-001 s13 step 2 -- THE CANONICAL HOSTNAME REGISTRY.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// One shared configuration source for the Competen domain family, as the spec requires. Before this
// file the hostnames lived in three executable places and about thirty comments, and nothing connected
// them: `STAFF_HOSTS` in staff-host.ts, `SITE_URL` in marketing/site.ts, `identityHost()` in
// practice/identity-service.ts. Two of those three are still the owners of their own value -- see the
// carve-outs below -- but they are now named here, so the set is enumerable in one read.
//
// ⚠ THIS REGISTRY NAMES HOSTS. IT DOES NOT PROVISION THEM, AND IT MUST NOT BE READ AS A CLAIM THAT
// THEY RESOLVE. Measured 2026-08-24: of the seven names below, `www` and the bare apex answer over
// TLS and the other six do not resolve at all. DNS and TLS are s9, an owner action on the registrar
// and on Vercel, and no amount of TypeScript performs it. See
// docs/COMP-ACCESS-URL-001-inventory.md for the measurement and the outstanding steps.
//
// That is deliberately NOT modelled as a `provisioned: boolean` field here. A flag like that is a
// second copy of DNS state that drifts the moment somebody adds a record, and this codebase has a
// recorded history of absences that quietly stopped being true. Code never needs to ask "is this host
// live" -- it asks "which gateway is this request on", and a host that does not resolve simply never
// arrives. `gatewayForHost` therefore returns null for six of seven names today and changes behaviour
// on the day the records exist, with no code change.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The host header, normalised: lower-cased and stripped of its port. Null when absent or unusable.
 *
 * ⚠ THIS MOVED HERE FROM staff-host.ts, which now re-exports it so its own harness and proxy.ts keep
 * importing it from where they always did. It lives at this layer because normalising a host is a
 * property of hostnames rather than of the staff door, and because the registry needs it: if the two
 * modules each normalised in their own way, `gatewayForHost` and `isStaffHost` could disagree about
 * the same request, which is the sort of difference that only shows up on the day somebody sends a
 * Host header with a port in it.
 */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().split(",")[0].trim();
  if (!host) return null;
  // IPv6 literals arrive bracketed ("[::1]:3000"); everything else splits on the last colon.
  const withoutPort = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return withoutPort || null;
}

/** The one domain family. s1: do not create unrelated standalone domains per product. */
export const COMPETEN_DOMAIN = "competenhealthcare.com";

export type GatewayKey =
  | "public"
  | "practice"
  | "enterprise"
  | "individual"
  | "recruitment"
  | "staff"
  | "platform";

export type Gateway = {
  /** The canonical production hostname. s1. */
  readonly host: string;
  /** The main-domain route equivalent. s2. */
  readonly route: string;
  /** Product name as a person would say it. s10: redirect messages use product names. */
  readonly label: string;
  /** What the gateway is for, from s1's table. */
  readonly purpose: string;
  /** Development-only aliases. Cannot exist in production, where the platform terminates TLS. */
  readonly devHosts: readonly string[];
};

/**
 * s1's table, verbatim in structure, plus the route each product answers on the main domain (s2).
 *
 * ⚠ ONE ROUTE HERE DISAGREES WITH THE SPEC ON PURPOSE. s2 names `/hq` as the staff route equivalent.
 * This application has no `/hq` route and never has; the HQ estate answers on `/staff`, which
 * COMP-HQ-ACCESS-001 s5 froze as `STAFF_DOOR_PATH` and which staff-host.ts already treats as the one
 * door the subdomain aliases. Inventing `/hq` to match the newer document would create a second
 * entrance to a privileged plane, which is exactly the kind of change that is a decision rather than a
 * tidy-up. The conflict is recorded in the inventory doc for the person who owns both specs. Until it
 * is ruled on, the built route is the one written down, because a registry that names a route nobody
 * serves is worse than one that admits the disagreement.
 */
export const GATEWAYS: Readonly<Record<GatewayKey, Gateway>> = {
  public: {
    host: `www.${COMPETEN_DOMAIN}`,
    route: "/",
    label: "Competen",
    purpose: "Marketing, product discovery and public navigation.",
    devHosts: ["localhost", "127.0.0.1"],
  },
  practice: {
    host: `practice.${COMPETEN_DOMAIN}`,
    route: "/practice",
    label: "Competen Practice",
    purpose: "Practitioner Practice product gateway.",
    devHosts: ["practice.localhost"],
  },
  enterprise: {
    host: `enterprise.${COMPETEN_DOMAIN}`,
    route: "/enterprise",
    label: "Competen Enterprise",
    purpose: "Organisation/tenant Enterprise gateway.",
    devHosts: ["enterprise.localhost"],
  },
  individual: {
    host: `individual.${COMPETEN_DOMAIN}`,
    route: "/individual",
    label: "Competen Individual",
    purpose: "Individual-user product gateway.",
    devHosts: ["individual.localhost"],
  },
  recruitment: {
    host: `recruitment.${COMPETEN_DOMAIN}`,
    route: "/recruitment",
    label: "Competen Recruitment",
    purpose: "Recruitment product gateway.",
    devHosts: ["recruitment.localhost"],
  },
  staff: {
    // s2 says `/hq`. See the warning above: `/staff` is what exists and what COMP-HQ-ACCESS-001 froze.
    host: `staff.${COMPETEN_DOMAIN}`,
    route: "/staff",
    label: "Competen Staff",
    purpose: "Competen staff/HQ access gateway.",
    devHosts: ["staff.localhost"],
  },
  platform: {
    host: `platform.${COMPETEN_DOMAIN}`,
    route: "/platform",
    label: "Competen Platform",
    purpose: "Landlord/platform governance and product oversight gateway.",
    devHosts: ["platform.localhost"],
  },
};

export const GATEWAY_KEYS = Object.keys(GATEWAYS) as GatewayKey[];

/**
 * s8: retired names. A new reference to one of these is a regression, and
 * scripts/domain-registry-harness.ts scans the tree for exactly that.
 *
 * ⚠ MEASURED 2026-08-24: `recruit.competenhealthcare.com` does not resolve and never appeared in this
 * repository. s8's "if already exposed, implement a permanent redirect" therefore has no work in it --
 * there is nothing published to redirect, and adding a redirect for a host that does not exist would
 * be ceremony. What s8 genuinely asks for that was missing is the regression check, which now exists.
 * If the name is ever provisioned by mistake, the redirect becomes real work again.
 */
export const DEPRECATED_HOSTS: Readonly<Record<string, GatewayKey>> = {
  [`recruit.${COMPETEN_DOMAIN}`]: "recruitment",
};

/**
 * s3: the Enterprise shell rule, expressed as names that must never become authentication estates.
 *
 * Workforce, Assessment, Learning and Quality are capabilities inside Enterprise, reached after one
 * authentication at the Enterprise gateway. Giving any of them its own login host would split the
 * session and force repeated login, which s3 forbids in as many words.
 */
export const FORBIDDEN_MODULE_HOSTS: readonly string[] = [
  `workforce.${COMPETEN_DOMAIN}`,
  `assessment.${COMPETEN_DOMAIN}`,
  `learning.${COMPETEN_DOMAIN}`,
  `quality.${COMPETEN_DOMAIN}`,
];

/**
 * ⚠ HOSTS THAT ARE DELIBERATELY NOT GATEWAYS, AND WHY -- the part of this registry most likely to be
 * "tidied up" by somebody who has read s1 and not s4.
 *
 * s4, last bullet: "Public patient/self-booking URLs remain governed by the Practice handle/booking-
 * address architecture and must not be conflated with practitioner authentication." The booking
 * address is the bare apex, `https://competenhealthcare.com/practice/book/@handle`, decided after
 * three candidates were in play, and identity-service.ts owns it.
 *
 * THAT STRING IS PRINTED ON CARDS AND POSTERS. Repointing it at `practice.competenhealthcare.com`
 * because this registry lists that name would break every card already in a patient's hand, and a
 * patient holding a dead link has no other way to reach their practitioner. The apex is listed here so
 * that a future reader finds the reason next to the name instead of discovering it by changing it.
 */
export const NON_GATEWAY_HOSTS: Readonly<Record<string, string>> = {
  [COMPETEN_DOMAIN]:
    "Patient booking address (s4). Owned by identityHost() in practice/identity-service.ts. Printed on physical cards -- not repointable by deploy.",
};

const HOST_INDEX: ReadonlyMap<string, GatewayKey> = new Map(
  GATEWAY_KEYS.flatMap(key => [
    [GATEWAYS[key].host, key] as const,
    ...GATEWAYS[key].devHosts.map(h => [h, key] as const),
  ]),
);

/**
 * Which gateway a request arrived on, or null.
 *
 * ⚠ EXACT MATCH ONLY, deliberately, for the reason staff-host.ts already records: a suffix test
 * (`endsWith("practice.competenhealthcare.com")`) accepts `notpractice.competenhealthcare.com` and
 * anything an attacker can put in a Host header that happens to end the same way. s12's "Isolation"
 * and "Privileged boundaries" rows both turn on host manipulation not being able to buy anything, and
 * a sloppy match here is how it would.
 *
 * Returns null for every host this application serves today except localhost, because six of the seven
 * names do not resolve. That is the same shape as staffEntryRewrite: adding this changes nothing until
 * the DNS records exist.
 */
export function gatewayForHost(rawHost: string | null | undefined): GatewayKey | null {
  const host = normaliseHost(rawHost);
  if (host === null) return null;
  return HOST_INDEX.get(host) ?? null;
}

/** Whether a host is a retired name that should redirect to its successor gateway. s8. */
export function deprecatedHostTarget(rawHost: string | null | undefined): GatewayKey | null {
  const host = normaliseHost(rawHost);
  if (host === null) return null;
  return DEPRECATED_HOSTS[host] ?? null;
}

/** The canonical absolute origin for a gateway. No trailing slash. */
export function gatewayOrigin(key: GatewayKey): string {
  return `https://${GATEWAYS[key].host}`;
}
