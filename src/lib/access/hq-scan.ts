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
const HQ_ANY = /requireHqContext\s*\(|resolveHqContext\s*\(/;
const HQ_CALL = /(?:requireHqContext|resolveHqContext)\s*\(\s*(?:"([a-z0-9._]+)"|(null)|([A-Z][A-Za-z0-9_]*)\s*(?:\.\s*([A-Za-z0-9_]+))?)?\s*\)/g;

export type HqGateKind = Gate["kind"] | "hq-position";
export type HqGate = Omit<Gate, "kind"> & { kind: HqGateKind; capabilities?: string[] };

/**
 * ⚠ AN UNRESOLVED CAPABILITY IS `unknown`, NEVER AN EMPTY LIST — scan.ts's rule, applied here. A gate
 * carrying no codes reads as "gated, nothing to see here" while proving nothing about what passes.
 */
export function classifyHqGate(source: string, groups: RoleGroups = {}, caps: CapabilityConsts = {}): HqGate {
  if (!HQ_ANY.test(source)) return classifyGate(source, groups, caps);

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
    const resolved = caps[m[3]!]?.[m[4] ?? ""];
    if (resolved) codes.push(resolved);
    else unresolved = `${m[3]}${m[4] ? "." + m[4] : ""}`;
  }

  const calls = (source.match(/(?:requireHqContext|resolveHqContext)\s*\(/g) ?? []).length;
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
