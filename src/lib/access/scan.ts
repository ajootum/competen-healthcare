// Permission matrix scanner (UMW-TLS-002) — derives what each role can actually reach.
//
// THE DESIGN DECISION THAT MATTERS. A permission matrix can be built two ways: from a table someone
// maintains by hand, or from the access rules the application actually enforces. A hand-maintained table
// drifts from the code silently, and a matrix that disagrees with the real gate is worse than no matrix —
// it tells a manager that a route is locked when it is open. So this reads the gates themselves.
//
// AND WHEN IT CANNOT TELL, IT SAYS SO. Every classification below is conservative: an unrecognised gate is
// reported as "unknown", never as "open". A scanner that quietly downgraded a gate it failed to parse into
// "no restriction" would be producing exactly the false reassurance this module exists to prevent.
//
// Pure functions, no filesystem — so the classification rules can be tested directly, and the generator
// (scripts/gen-access-matrix.ts) is the only part that touches disk.

export type GateKind =
  | "role-list"      // const ALLOWED = [...] + a membership test
  | "single-role"    // if (!roles.includes("x")) deny
  | "auth-only"      // signed in, no role restriction
  | "service"        // machine authentication (a shared secret) — not a person at all
  | "platform-role"  // the LANDLORD axis (platform operator), a different plane from tenant roles
  | "capability"     // the TENANT axis (Competen Practice): a capability code held via a membership
  | "member-only"    // a practice context is required, but no capability — the tenant "auth-only"
  | "hq-position"    // the GOVERNANCE axis (HQ): a capability held through a position appointment
  | "none"           // no access check of any kind — reachable without signing in
  | "unknown";       // a gate exists but this scanner does not understand it

export type Gate = {
  kind: GateKind;
  roles: string[];          // roles that pass; empty for auth-only
  appointment: boolean;     // additionally reachable by an OGS office appointment
  evidence: string | null;  // the source fragment the classification came from
  capabilities?: string[];  // tenant-plane capability codes, for "capability" gates only
};

export type MatrixEntry = {
  path: string;
  kind: "workspace" | "api" | "page";
  gate: Gate;
  /**
   * ⚠ WHERE THE GATE ACTUALLY IS, AND THE DISTINCTION IS NOT COSMETIC. `own` means the page or route
   * checks for itself. `inherited` means the only thing standing in front of it is an ancestor layout --
   * and Next's own documentation says that is not enough: a layout "will not prevent nested route
   * segments and Server Actions from being accessed". Collapsing the two would report 920 pages as
   * uniformly protected when 38 of them are the ones that actually check.
   */
  guard?: "own" | "inherited";
  /** The layout the gate came from, when inherited. Null when the page checks for itself. */
  inheritedFrom?: string | null;
};

const ROLE_LIST = /const\s+ALLOWED\s*(?::[^=]+)?=\s*\[([^\]]*)\]/;
const SINGLE = /if\s*\(\s*!\s*(?:user)?[Rr]oles\??\.includes\(\s*"([a-z_]+)"\s*\)\s*\)/;
// The older inline spelling of a single-role gate: deny unless the stored role matches.
const SINGLE_NEQ = /\brole\s*!==\s*"([a-z_]+)"/;
// A shared secret in an Authorization header (cron). No human role reaches the route by role at all,
// which is a materially different answer from "everyone can" and from "nobody knows".
const SERVICE = /CRON_SECRET|headers\.get\(\s*["']authorization["']\s*\)/i;
// The landlord plane (PLA-001): getLandlordCaller + landlordCan("platform_operations", ...). A tenant
// role never reaches these, and saying "unknown" about them would put a false question mark over the
// platform's own admin routes.
const LANDLORD = /landlordCan\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*((?:"[a-z_]+"\s*,?\s*)+)\)/;
const LANDLORD_ANY = /getLandlordCaller\s*\(/;
// The TENANT plane (Competen Practice): requirePracticeContext(capability). A third idiom, and the
// scanner was blind to it until it was taught — see the note on classifyPractice below for what that
// blindness actually produced.
// ⚠ THE PRACTICE SHELL, WHICH IS A THIRD IDIOM AND WAS FOUND THE SAME WAY AS THE SECOND.
// `src/app/practice/(shell)/layout.tsx` gates the entire practitioner workspace by resolving a shell
// state and redirecting every non-READY one -- `AUTH_REQUIRED` goes to sign-in. It matches no pattern
// above, so before this rule existed it classified as `none`, and the moment the matrix moved to page
// granularity that answer propagated to SIXTY pages reported as reachable without signing in. The
// practice API routes taught this lesson once at 98 routes; this is the same lesson arriving through
// layouts instead of routes, which is why the rule is written to the STATE MACHINE rather than to the
// one file that currently uses it.
const SHELL_GATE = /resolvePracticeShell\s*\(|["']AUTH_REQUIRED["']/;
// ⚠ A FOURTH PLANE, TAUGHT IN THE SAME COMMIT AS ITS GUARD -- ENT-DEC-001 D12. requireEnterpriseContext
// (Competen Enterprise, gate 3) has exactly requirePracticeContext's call shape -- a capability literal,
// null, a resolved constant, or a ternary -- so ONE classifier serves both tenant planes rather than a
// clone that drifts. Four prior guard helpers shipped without a scanner entry and each classified as
// `none`, "reachable without signing in"; enterprise-membership-harness feeds classifyGate a synthetic
// enterprise route and fails if this pattern ever stops matching it.
const PRACTICE_ANY = /require(?:Practice|Enterprise)Context\s*\(/;
// Four spellings, all of them real in this codebase: a literal, null, a resolved constant, and a ternary
// whose branches are literals -- `requirePracticeContext(to === "SIGNED" ? "document.sign" : "document.author")`,
// where the capability depends on the transition being attempted. BOTH branches are taken for the ternary:
// either one reaches the route, and the union is what "who can reach this at all" means.
const PRACTICE_CALL = /require(?:Practice|Enterprise)Context\s*\(\s*(?:"([a-z0-9._]+)"|(null)|([A-Z][A-Za-z0-9_]*)\s*\.\s*([A-Za-z0-9_]+)|[^()]*?\?\s*"([a-z0-9._]+)"\s*:\s*"([a-z0-9._]+)")\s*\)/g;
// Two spellings of the same gate: pages redirect to /login, API routes return 401. Both mean
// "signed in, no role restriction". `!user?.email` is the same check on a route that needs the address.
const AUTH = /if\s*\(\s*!\s*user(?:\?\.\w+)?\s*\)\s*(?:redirect\(|return\s)/;
// A caller-supplied role check the scanner has no rule for. Present so "there is clearly a gate here but I
// do not understand it" is distinguishable from "there is no gate".
const OTHER_GATE = /allowedRoles|isPlatformRole|PLATFORM_ROLE|hasPermission|assertRole|\.role\s*!==/;

export const APPOINTMENT = /holdsOfficeAppointment/;

const parseList = (raw: string): string[] =>
  [...raw.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);

// ── The api-auth idiom ────────────────────────────────────────────────────────
// Nearly every API route gates with getCaller() + a predicate from @/lib/api-auth. The role GROUPS those
// predicates test are passed in rather than hardcoded here, read from api-auth.ts itself by the generator —
// so adding a role to ADMIN_ROLES changes the matrix, and this file cannot quietly disagree with the
// constant it is describing.
export type RoleGroups = Record<string, string[]>;

const PREDICATES: { re: RegExp; group: string | null; roles?: string[] }[] = [
  { re: /!\s*isAdmin\s*\(/,       group: "ADMIN_ROLES" },
  { re: /!\s*isStaff\s*\(/,       group: "STAFF_ROLES" },
  { re: /!\s*isEducator\s*\(/,    group: "EDUCATOR_ROLES" },
  { re: /!\s*isSupervisor\s*\(/,  group: "SUPERVISOR_ROLES" },
  { re: /!\s*isSuper\s*\(/,       group: null, roles: ["super_admin"] },
];

// ── The INLINE role-array idiom ───────────────────────────────────────────────
//
// ⚠ THIS WAS A BLIND SPOT AND IT REPORTED SIX WORKING ROUTES AS OPEN. `/api/ai/assistant`,
// `/api/ai/governance`, `/api/knowledge-objects`, `/api/osce/exams`, `/api/quality/capa` and `/api/studio`
// all gate on a role array written INLINE rather than through requireRole or a named *_ROLES group:
//
//     if (!roles.some(r => ["super_admin", "hospital_admin", "educator"].includes(r))) return 403
//     if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) return 403
//     if (!c.roles.some(r => AUTHOR_ROLES.includes(r))) return forbidden()   // a LOCAL const
//
// The scanner recognised none of them, so all six classified as `auth-only` — "signed in, no role
// restriction" — and were reported as reachable by any signed-in user. They are not: no nurse passes any
// of them. That is the OPPOSITE direction from this file's famous failure (98 practice routes reported as
// `none`), and it is milder, but it is not harmless: a matrix that cries wolf gets acted on, and acting on
// this one would have meant "fixing" six routes that were never broken.
//
// ⚠ A LIST IS ONLY TREATED AS ROLES IF IT CONTAINS A CANONICAL AppRole. Without that test this would
// classify `["draft","published"]` or a set of CPU kinds as a role gate, which would invent protection
// where there is none — the failure this whole file exists to prevent.
const CANONICAL_ROLES = ["super_admin", "hospital_admin", "educator", "assessor", "nurse"];
const looksLikeRoles = (roles: string[]) => roles.length > 0 && roles.some(r => CANONICAL_ROLES.includes(r));

/** Role arrays declared as local constants in the same file (AUTHOR_ROLES, ALLOWED_ROLES, …). */
function localRoleArrays(source: string): RoleGroups {
  const out: RoleGroups = {};
  for (const m of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\[([^\]]*)\]/g)) {
    const roles = parseList(m[2]);
    if (looksLikeRoles(roles)) out[m[1]] = roles;
  }
  return out;
}

// Two spellings, both NEGATED — the `if (!…)` is what makes it a refusal rather than a filter.
//
// ⚠ THE ARROW PARAMETER MAY CARRY A TYPE ANNOTATION, and the first version of this regex required a bare
// identifier. `.some(r => …)` matched and `.some((r: string) => …)` did not, which is the same blind spot
// one layer down — a gate that resolves or not depending on whether somebody annotated a lambda.
const INLINE_SOME = /!\s*[\w$.?]*\.some\s*\(\s*\(?\s*\w+(?:\s*:\s*[\w<>[\]|\s]+)?\s*\)?\s*=>\s*(?:\[([^\]]*)\]|([A-Z][A-Z0-9_]*))\s*\.includes\s*\(/g;
const INLINE_INCLUDES = /!\s*(?:\[([^\]]*)\]|([A-Z][A-Z0-9_]*))\s*\.includes\s*\(\s*[^)]*\brole\b/g;

/** The union of roles admitted by any inline role-array gate in the file, or [] when there is none. */
function inlineRoleGate(source: string, groups: RoleGroups): string[] {
  const locals = { ...groups, ...localRoleArrays(source) };
  const found: string[] = [];
  for (const re of [INLINE_SOME, INLINE_INCLUDES]) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) {
      const roles = m[1] ? parseList(m[1]) : (locals[m[2]] ?? []);
      if (looksLikeRoles(roles)) found.push(...roles);
    }
  }
  return [...new Set(found)];
}

function classifyApiAuth(source: string, groups: RoleGroups): Gate | null {
  if (!/getCaller\s*\(/.test(source)) return null;
  const appointment = APPOINTMENT.test(source);

  // requireRole(c, [...]) carries its own list.
  const req = source.match(/requireRole\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*\[([^\]]*)\]/);
  if (req) return { kind: "role-list", roles: parseList(req[1]), appointment, evidence: req[0].replace(/\s+/g, " ").slice(0, 120) };
  const reqGroup = source.match(/requireRole\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*([A-Z_]+ROLES)\s*\)/);
  if (reqGroup && groups[reqGroup[1]]) return { kind: "role-list", roles: groups[reqGroup[1]], appointment, evidence: reqGroup[0] };

  // A route may apply more than one predicate across its verbs. The gate reported is the UNION — the widest
  // way in — because "who can reach this route at all" is the question a permission matrix answers, and
  // reporting the narrowest check would understate the exposure.
  const hit = PREDICATES.filter(p => p.re.test(source));
  const explicit = [...source.matchAll(/hasRole\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*((?:"[a-z_]+"\s*,?\s*)+)\)/g)]
    .flatMap(m => parseList(m[1]));

  if (hit.length || explicit.length) {
    const roles = [...new Set([
      ...hit.flatMap(p => p.roles ?? groups[p.group!] ?? []),
      ...explicit,
    ])];
    // A predicate whose group could not be resolved would silently narrow the matrix — flag instead.
    const unresolved = hit.some(p => p.group && !groups[p.group]);
    if (unresolved || roles.length === 0) return { kind: "unknown", roles, appointment, evidence: "api-auth predicate with unresolved role group" };
    return { kind: "role-list", roles, appointment, evidence: hit.map(p => p.group ?? "isSuper").join(" | ") || "hasRole" };
  }

  // ⚠ ASKED BEFORE CONCLUDING auth-only, NOT AFTER. /api/studio calls getCaller and then gates on a LOCAL
  // AUTHOR_ROLES array; every branch above misses that, so the route was reported as having no role
  // restriction at all while refusing four of the five roles.
  const inline = inlineRoleGate(source, groups);
  if (inline.length)
    return { kind: "role-list", roles: inline, appointment, evidence: `inline role array: ${inline.join(", ")}`.slice(0, 120) };

  // getCaller() with no role predicate: authenticated, no role restriction. That IS the gate, and saying so
  // is the point — an authenticated-only write route is a finding a manager should be able to see.
  return { kind: "auth-only", roles: [], appointment, evidence: "getCaller() with no role predicate" };
}

// ── The tenant idiom ──────────────────────────────────────────────────────────
// Capability constants (CHECKLIST_CAPABILITIES.manage and friends) are passed in resolved rather than
// restated here, for the same reason RoleGroups are: a copy of a constant drifts from the constant.
export type CapabilityConsts = Record<string, Record<string, string>>;

/**
 * `requirePracticeContext(capability)` — Competen Practice's gate, and a plane of its own.
 *
 * ⚠ WHAT THIS FUNCTION'S ABSENCE USED TO PRODUCE, RECORDED SO NOBODY REMOVES IT AS REDUNDANT. Before it
 * existed the scanner had no rule for this idiom, so a practice route matched no gate pattern at all and
 * fell through to the final `anySignal` test — which reported `none`, meaning "no access check of any
 * kind, reachable without signing in", and which roleReaches answers `true` for. Ninety-eight correctly
 * gated routes would have been published to a manager as open to the world. That is the exact false
 * reassurance this module was written to prevent, arriving through the module's own blind spot.
 *
 * ⚠ AN UNRESOLVED CONSTANT IS `unknown`, NEVER an empty capability list. A `capability` gate carrying no
 * codes reads as "gated, nothing to see here" while proving nothing about what actually passes.
 */
function classifyPractice(source: string, caps: CapabilityConsts): Gate | null {
  if (!PRACTICE_ANY.test(source)) return null;
  const appointment = APPOINTMENT.test(source);

  // Evidence names the guard that actually matched, so a reader of the matrix can tell which tenant
  // plane a route sits on without opening the file. The call form (with paren) is tested, not the bare
  // name, because the import line would otherwise count.
  const guardName = /requireEnterpriseContext\s*\(/.test(source)
    ? (/requirePracticeContext\s*\(/.test(source)
      ? "requirePracticeContext+requireEnterpriseContext" : "requireEnterpriseContext")
    : "requirePracticeContext";

  const codes: string[] = [];
  let nullCalls = 0;
  let parsedCalls = 0;
  let unresolved: string | null = null;

  PRACTICE_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRACTICE_CALL.exec(source))) {
    parsedCalls++;
    if (m[1]) { codes.push(m[1]); continue; }
    // requirePracticeContext(null): a practice context is required and no capability is. That is a real
    // gate and a materially weaker one, so it gets its own kind rather than being folded in with the rest.
    if (m[2]) { nullCalls++; continue; }
    // ⚠ A TERNARY IS ONE CALL AND TWO CODES, which is why calls are counted separately from codes below.
    if (m[5] && m[6]) { codes.push(m[5], m[6]); continue; }
    const resolved = caps[m[3]]?.[m[4]];
    if (resolved) codes.push(resolved);
    else unresolved = `${m[3]}.${m[4]}`;
  }

  if (unresolved)
    return { kind: "unknown", roles: [], appointment, capabilities: codes,
      evidence: `${guardName}(${unresolved}) — capability constant could not be resolved` };

  // ⚠ EVERY CALL MUST HAVE BEEN ACCOUNTED FOR. A call spelled in a way PRACTICE_CALL does not match --
  // a variable, a ternary, a template string -- sits next to calls that did parse, and reporting
  // `capability` would claim the unparsed one is covered by the parsed ones. Counted rather than assumed.
  // The import spells it `requirePracticeContext,` so it does not match this and must not be subtracted.
  const calls = (source.match(/require(?:Practice|Enterprise)Context\s*\(/g) ?? []).length;
  if (calls !== parsedCalls)
    return { kind: "unknown", roles: [], appointment, capabilities: codes,
      evidence: `${calls} ${guardName} call(s), ${parsedCalls} parsed` };

  if (codes.length === 0 && nullCalls > 0)
    return { kind: "member-only", roles: [], appointment, evidence: `${guardName}(null)` };

  return {
    kind: "capability", roles: [], appointment,
    capabilities: [...new Set(codes)].sort(),
    evidence: `${guardName}: ${[...new Set(codes)].sort().join(", ")}${nullCalls ? ` (and ${nullCalls} call(s) with no capability)` : ""}`,
  };
}

export function classifyGate(source: string, groups: RoleGroups = {}, caps: CapabilityConsts = {}): Gate {
  const appointment = APPOINTMENT.test(source);

  // ⚠ THE TENANT IDIOM IS TESTED FIRST, AND THE ORDER IS LOAD-BEARING. Two routes gate per-verb on both
  // planes (practice/lifecycle, practice/team/join): a capability on one verb, an estate role on another.
  // classifyApiAuth would match the getCaller() in those files and report `auth-only`, silently dropping
  // the capability. So the capability is established first, and any estate roles found alongside are
  // carried in `roles` — the module's existing union rule, "the widest way in", applied across planes
  // rather than within one.
  const practice = classifyPractice(source, caps);
  if (practice) {
    if (practice.kind !== "capability" && practice.kind !== "member-only") return practice;
    const alsoApi = classifyApiAuth(source, groups);
    const estateRoles = alsoApi && alsoApi.kind !== "auth-only" ? alsoApi.roles : [];
    if (estateRoles.length === 0) return practice;
    return {
      ...practice, roles: estateRoles,
      evidence: `${practice.evidence}; also reachable by role: ${estateRoles.join(", ")}`,
    };
  }

  // The shell state machine is a membership gate: it admits a signed-in practitioner with a usable
  // workspace and redirects everybody else. That is exactly what `member-only` means on this plane, so it
  // reuses the kind rather than inventing a fourth one for the same answer.
  if (SHELL_GATE.test(source))
    return { kind: "member-only", roles: [], appointment, evidence: "resolvePracticeShell() with AUTH_REQUIRED redirect" };

  const api = classifyApiAuth(source, groups);
  if (api) return api;

  const list = source.match(ROLE_LIST);
  if (list) {
    const roles = parseList(list[1]);
    // A declared list that is never actually tested is not a gate. Catching this matters: an ALLOWED array
    // left behind after a refactor looks like protection in review and enforces nothing at runtime.
    const enforced = /ALLOWED\.includes|includes\(\s*r\s*\)|some\(\s*r\s*=>|ALLOWED\.some/.test(source);
    if (!enforced) return { kind: "unknown", roles, appointment, evidence: list[0].slice(0, 120) };
    return { kind: "role-list", roles, appointment, evidence: list[0].slice(0, 120) };
  }

  // The same idiom on a route that never calls getCaller — five of the six false positives were here,
  // authenticating with a raw supabase.auth.getUser() and then testing an inline role array.
  const inlineStandalone = inlineRoleGate(source, groups);
  if (inlineStandalone.length)
    return { kind: "role-list", roles: inlineStandalone, appointment, evidence: `inline role array: ${inlineStandalone.join(", ")}`.slice(0, 120) };

  if (LANDLORD_ANY.test(source)) {
    const m = source.match(LANDLORD);
    return { kind: "platform-role", roles: m ? parseList(m[1]) : [], appointment, evidence: m ? m[0].replace(/\s+/g, " ").slice(0, 120) : "getLandlordCaller()" };
  }

  if (SERVICE.test(source)) {
    const m = source.match(SERVICE);
    return { kind: "service", roles: [], appointment, evidence: m ? m[0].slice(0, 60) : "shared secret" };
  }

  const single = source.match(SINGLE) ?? source.match(SINGLE_NEQ);
  if (single) return { kind: "single-role", roles: [single[1]], appointment, evidence: single[0].slice(0, 120) };

  if (OTHER_GATE.test(source)) {
    const m = source.match(OTHER_GATE);
    return { kind: "unknown", roles: [], appointment, evidence: m ? m[0].slice(0, 120) : null };
  }

  if (AUTH.test(source)) return { kind: "auth-only", roles: [], appointment, evidence: "if (!user) redirect(...)" };

  // Nothing that looks like an access check appears anywhere in the file. That is a DIFFERENT finding from
  // "a gate this scanner could not parse", and conflating the two would bury a genuinely open route among
  // the scanner's own blind spots. Some of these are correct — the sign-in endpoints have to be reachable
  // before anyone is signed in — so the surface lists them for a human to confirm rather than judging.
  // ⚠ requirePracticeContext IS IN THIS LIST AS A SECOND LINE OF DEFENCE, not because it is reachable.
  // classifyPractice above already claims every file containing it. If that ever stops being true, the
  // failure this catches is a practice route reported as `none` -- open to the world -- which is the one
  // wrong answer this module must never give.
  const anySignal = /auth\.getUser|getCaller|getLandlordCaller|requirePracticeContext|requireEnterpriseContext|createClient\(\)|ALLOWED|roles/.test(source);
  if (!anySignal) return { kind: "none", roles: [], appointment, evidence: "no access check found in this file" };

  return { kind: "unknown", roles: [], appointment, evidence: null };
}

// Can this role reach this entry? "unknown" always answers null — not true, not false. Rendering an
// unknown as a tick would be a false assurance and as a cross would be a false alarm.
export function roleReaches(gate: Gate, role: string): boolean | null {
  switch (gate.kind) {
    case "auth-only": return true;
    case "service": return false;   // machine-authenticated: no human role reaches it by role
    // ⚠ THE OWNER SHORT-CIRCUIT IS REAL ON BOTH NON-TENANT PLANES, AND THIS USED TO SAY PLAIN `false`.
    // `getLandlordCaller` sets `isOwner: isSuperAdmin || hasPlatformRole(me, "platform_owner")`, and
    // `requireHqContext` tests ownership BEFORE it reads any HQ table. `super_admin` is in TENANT_ROLES,
    // so answering `false` for it told a manager that the two accounts which reach every governance page
    // cannot reach any of them. That is a false alarm rather than false reassurance -- the safer of the
    // two ways to be wrong, and still a matrix that lies about the most privileged accounts on the
    // platform. Every OTHER estate role genuinely cannot reach these planes.
    case "platform-role":
    case "hq-position":
      return role === "super_admin";
    // ⚠ THE TENANT PLANE IS NOT DECIDED BY AN ESTATE ROLE, so neither tick nor cross is the truth. What
    // passes here is a capability held through a practice membership, and a nurse may hold it in one
    // practice and not another -- a single answer for "nurse" cannot exist. `false` would tell a manager
    // the route is locked to staff who reach it daily; `true` would claim a grant nobody checked.
    // The exception is a route that ALSO carries an estate gate on another verb, where the roles are real.
    case "capability": return gate.roles.length ? gate.roles.includes(role) : null;
    case "member-only": return null;    // practice membership, which no estate role implies
    case "none": return true;       // no check at all - reachable by anyone, signed in or not
    case "role-list": return gate.roles.includes(role);
    case "single-role": return gate.roles.includes(role);
    case "unknown": return null;
  }
}

export type MatrixFile = { generatedAt?: string; entries: MatrixEntry[] };

export function summarise(entries: MatrixEntry[], roles: string[]) {
  const byRole = roles.map(role => {
    const reach = entries.map(e => roleReaches(e.gate, role));
    return {
      role,
      allowed: reach.filter(v => v === true).length,
      denied: reach.filter(v => v === false).length,
      unknown: reach.filter(v => v === null).length,
    };
  });
  return {
    total: entries.length,
    workspaces: entries.filter(e => e.kind === "workspace").length,
    apis: entries.filter(e => e.kind === "api").length,
    unknown: entries.filter(e => e.gate.kind === "unknown").length,
    authOnly: entries.filter(e => e.gate.kind === "auth-only").length,
    service: entries.filter(e => e.gate.kind === "service").length,
    platform: entries.filter(e => e.gate.kind === "platform-role").length,
    ungated: entries.filter(e => e.gate.kind === "none").length,
    appointment: entries.filter(e => e.gate.appointment).length,
    byRole,
  };
}

// ── Segregation of duties, computed live ──────────────────────────────────────
// Never stored. A stored violation goes stale the moment someone's roles change, and would then accuse a
// person who is already clean.
export type SodRule = { id: string; code: string; label: string; role_a: string; role_b: string; severity: string; rationale: string | null; active: boolean };
export type SodBreach = { rule: SodRule; subjectId: string; subjectName: string | null; excepted: boolean; exceptionReason?: string | null; exceptionExpired?: boolean };

export function findSodBreaches(
  rules: SodRule[],
  people: { id: string; full_name: string | null; roles: string[] }[],
  exceptions: { rule_id: string; subject_id: string; reason: string | null; expires_at: string | null }[] = [],
  now = Date.now(),
): SodBreach[] {
  const out: SodBreach[] = [];
  for (const rule of rules.filter(r => r.active !== false)) {
    for (const p of people) {
      if (!p.roles.includes(rule.role_a) || !p.roles.includes(rule.role_b)) continue;
      const ex = exceptions.find(e => e.rule_id === rule.id && e.subject_id === p.id);
      // An EXPIRED exception is not an exception. Treating it as one would let a breach be waved through
      // indefinitely by a decision someone took once and never revisited.
      const expired = !!ex?.expires_at && new Date(ex.expires_at).getTime() < now;
      out.push({
        rule, subjectId: p.id, subjectName: p.full_name,
        excepted: !!ex && !expired,
        exceptionReason: ex?.reason ?? null,
        exceptionExpired: expired,
      });
    }
  }
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((a, b) =>
    Number(a.excepted) - Number(b.excepted) ||
    (rank[a.rule.severity] ?? 9) - (rank[b.rule.severity] ?? 9) ||
    (a.subjectName ?? "").localeCompare(b.subjectName ?? ""));
}
