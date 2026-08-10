import { classifyGate, type Gate, type RoleGroups, type CapabilityConsts } from "./scan";
import { HQ_CAPABILITY_CODES } from "@/lib/hq/spaces";

/**
 * The HQ idiom, taught to the permission-matrix scanner — as a LAYER over src/lib/access/scan.ts rather
 * than an edit to it, because that file and the generator have uncommitted page-granularity work in flight.
 *
 * ⚠ WHY THIS FILE HAS TO EXIST AT ALL, AND WHAT IT PREVENTS. classifyGate's last resort is an `anySignal`
 * test over a fixed list of idioms. A page whose ONLY gate is `await requireHqContext("hq.platform.ai.view")`
 * matches none of them, so the scanner would fall through and report `kind: "none"` — documented in that
 * file as "no access check of any kind — reachable without signing in" — and roleReaches() answers TRUE for
 * `none`. Every page this programme guards would have been published to a manager as open to the world.
 *
 * That is not hypothetical: scan.ts's own header records the identical failure happening once already,
 * when 98 correctly-gated practice routes classified as `none` because the scanner had no rule for
 * requirePracticeContext. This is the same blind spot, one plane over, caught before it shipped.
 *
 * ⚠ TO WIRE IT UP: scripts/gen-access-matrix.ts should call classifyHqGate instead of classifyGate. That is
 * a one-line change in a file this task was told not to touch, so it is left for its owner. Until then the
 * generated matrix is unaffected — it is at layout granularity, where /super-admin is a single
 * `single-role` entry from the layout, which this change does not alter.
 */

// Four spellings, matching how the guard is actually called: a literal capability, an explicit null, the
// bare no-argument form, and a capability read off a local constant.
//
// ⚠ requireHqCapability MUST BE IN BOTH PATTERNS, and forgetting it would have been the third instance of
// this exact bug. CP-HQ-NAV-001 step 3 converted 167 pages to that helper; a scanner that had never heard
// of it would have fallen through to classifyGate, found no idiom it recognised, and reported all 167 as
// `kind: "none"` -- "no access check of any kind - reachable without signing in". The generated matrix
// would then have published the entire HQ estate to a manager as open to the world, one commit after it
// was locked down. scan.ts records the same failure for 98 practice routes, and this file's own header
// records it for requireHqContext. Any future guard helper goes here FIRST.
// ⚠ hqApiGate WAS ADDED HERE ONLY AFTER IT HAD ALREADY SHIPPED WITHOUT IT, WHICH IS THE FOURTH INSTANCE.
// Four API routes were narrowed to capability gates and every one of them immediately classified as
// `kind: "none"` -- the note above predicts this failure, an assertion in access-scanner-harness pins it,
// and it happened anyway in the very next change. The lesson is not "remember"; it is that the guard list
// and the guard must land in the SAME commit.
const HQ_GUARDS = "requireHqContext|resolveHqContext|requireHqCapability|hqApiGate";
const HQ_ANY = new RegExp(`(?:${HQ_GUARDS})\\s*\\(`);
const HQ_CALL = new RegExp(
  `(?:${HQ_GUARDS})\\s*\\(\\s*(?:"([a-z0-9._]+)"|(null)|([A-Z][A-Za-z0-9_]*)\\s*(?:\\.\\s*([A-Za-z0-9_]+))?)?\\s*(?:,[^)]*)?\\)`,
  "g",
);

export type HqGateKind = Gate["kind"] | "hq-position";
export type HqGate = Omit<Gate, "kind"> & { kind: HqGateKind; capabilities?: string[] };

/**
 * ⚠ AN UNRESOLVED CAPABILITY IS `unknown`, NEVER AN EMPTY LIST — scan.ts's rule, applied here. A gate
 * carrying no codes reads as "gated, nothing to see here" while proving nothing about what passes.
 */
/**
 * Capability arrays declared as a local constant in the same file — `const CAPABILITIES = ["a", "b"]`.
 *
 * ⚠ WITHOUT THIS, hqApiGate(CAPABILITIES) RESOLVES TO NOTHING. The call passes an array variable rather
 * than a string literal, so HQ_CALL sees an unresolved identifier and reports `unknown`. That is honest and
 * safe -- unknown is never read as open -- but it puts a question mark over four correctly-gated routes,
 * and a matrix full of question marks is one nobody reads. Only entries that are real catalogue codes are
 * accepted, so an array of anything else resolves to nothing rather than inventing a capability.
 */
function localCapabilityArrays(source: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\[([^\]]*)\]/g)) {
    const codes = [...m[2].matchAll(/"([a-z0-9._]+)"/g)].map(x => x[1]).filter(c => HQ_CAPABILITY_CODES.includes(c));
    if (codes.length) out[m[1]] = codes;
  }
  return out;
}

export function classifyHqGate(source: string, groups: RoleGroups = {}, caps: CapabilityConsts = {}): HqGate {
  if (!HQ_ANY.test(source)) return classifyGate(source, groups, caps);
  const localArrays = localCapabilityArrays(source);

  const codes: string[] = [];
  let parsed = 0;
  let unresolved: string | null = null;

  HQ_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HQ_CALL.exec(source))) {
    parsed++;
    if (m[1]) {
      // A literal that is not in the catalogue is a typo, and a typo must not read as a gate.
      if (!HQ_CAPABILITY_CODES.includes(m[1])) unresolved = m[1];
      else codes.push(m[1]);
      continue;
    }
    // requireHqContext(null) and requireHqContext() both defer to the route intent map, which DENIES an
    // unmapped route. That is a real gate whose codes this scanner cannot see from the file alone.
    if (m[2] || (!m[1] && !m[3])) continue;
    // ⚠ AN ANY-OF ARRAY CONTRIBUTES EVERY CODE, NOT ITS FIRST. hqApiGate(CAPABILITIES) admits a caller
    // holding ANY entry, so reporting one would understate the audience -- and this scanner's contract is
    // to report the UNION, the widest way in. Only when the call reads a PROPERTY off the constant
    // (FOO.bar) does the single-value path below apply.
    const localArray = !m[4] ? localArrays[m[3]!] : undefined;
    if (localArray) { codes.push(...localArray); continue; }
    const resolved = caps[m[3]!]?.[m[4] ?? ""];
    if (resolved) codes.push(resolved);
    else unresolved = `${m[3]}${m[4] ? "." + m[4] : ""}`;
  }

  // ⚠ CALLING THE GATE IS NOT THE SAME AS OBEYING IT, and this scanner could not tell the difference.
  // hqApiGate RETURNS a refusal rather than throwing -- unlike requireHqCapability, which redirects -- so a
  // route that calls it and ignores the result is completely ungated while still containing the call. A
  // deliberate break proved it: replacing `if (isHqRefusal(ctx)) return ctx` with `if (false)` left the
  // route classified as hq-position. scan.ts already refuses to count an ALLOWED list that is never tested
  // (line ~239); this is the same rule for the same reason, one plane over.
  // ⚠ PER EXPORTED VERB, NOT PER FILE, and the file-level version of this check was itself caught by a
  // deliberate break. /api/knowledge-objects exports POST and PATCH; disabling PATCH's `if (isHqRefusal…)`
  // left the file still containing the phrase -- from POST -- so the route read as fully gated with one of
  // its two write verbs wide open. A route is only as gated as its weakest entry point.
  //
  // A verb that does not mention hqApiGate itself is not flagged: it may delegate to a local gate() helper,
  // which is how /api/hq/appointments is written.
  if (/hqApiGate\s*\(/.test(source)) {
    const ungatedVerbs = source.split(/export\s+async\s+function\s+/).slice(1)
      .filter(v => /hqApiGate\s*\(/.test(v) && !/isHqRefusal\s*\(/.test(v))
      .map(v => v.slice(0, v.indexOf("(")).trim());
    if (ungatedVerbs.length)
      return { kind: "unknown", roles: [], appointment: true, capabilities: codes,
        evidence: `hqApiGate called but its refusal is never returned in: ${ungatedVerbs.join(", ")}` };
  }

  const calls = (source.match(new RegExp(`(?:${HQ_GUARDS})\\s*\\(`, "g")) ?? []).length;
  if (unresolved)
    return { kind: "unknown", roles: [], appointment: true, capabilities: codes,
      evidence: `requireHqContext(${unresolved}) — capability not in the HQ catalogue` };
  if (calls !== parsed)
    return { kind: "unknown", roles: [], appointment: true, capabilities: codes,
      evidence: `${calls} requireHqContext call(s), ${parsed} parsed` };

  return {
    kind: "hq-position",
    roles: [],
    // The HQ plane IS an appointment plane: what passes is an ogs_office_appointments row, the same
    // mechanism the existing `appointment` flag already describes for CMO / QAW / HEX.
    appointment: true,
    capabilities: [...new Set(codes)].sort(),
    evidence: `requireHqContext: ${[...new Set(codes)].sort().join(", ") || "route intent map"}`,
  };
}

/**
 * Can a tenant estate role reach an HQ entry? No — and unlike `unknown` that is a real answer, not an
 * absence of one. The HQ plane is entered by ownership or by appointment, never by a tenant role.
 */
export const hqRoleReaches = (gate: HqGate): boolean | null =>
  gate.kind === "hq-position" ? false : null;
