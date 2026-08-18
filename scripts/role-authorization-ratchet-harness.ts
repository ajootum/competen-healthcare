/**
 * PLAT-GOV-001 §14 — the role-authorization ratchet.
 *
 * THE RULING (owner, 2026-08-19, recorded in docs/adr/ADR-008-role-authorization-migration.md):
 * §14 is interpreted ARCHITECTURALLY — role names are not authoritative authorization primitives.
 * Not a big-bang rewrite of all 667 call sites, and not indefinite grandfathering. Effective
 * immediately: no NEW raw role authorization, and this ratchet stops the legacy surface growing while
 * the estate-plane capability model is designed and built.
 *
 * ⚠ WHAT THIS HARNESS IS AND IS NOT. It is a RATCHET, not a proof of correctness. It cannot tell an
 * authorization decision from a data read, so it counts SHAPES that are characteristic of role-based
 * authorization and refuses to let those counts rise. A falling number is progress; a rising number is
 * a new dependency on a primitive the ruling has retired.
 *
 * ⚠ COUNTED IN NODE, NOT SHELL. An earlier version of this measurement used `grep`, and grep's
 * behaviour is not identical across the Windows dev machine and the ubuntu CI runner — which this
 * repository learned the hard way the same day, when a Playwright job passed locally and failed in CI
 * for a platform reason. Counting in-process means the number CI sees is the number you see.
 *
 * ⚠ WHY NOT COUNT EVERY `.role` ACCESS. There are 558 `.role`/`.roles` property reads in src, and the
 * overwhelming majority are `s.role` / `r.role` style reads inside map callbacks that RENDER somebody's
 * role in a table. Ratcheting those would put pressure on code that displays a fact rather than code
 * that decides on one, and would make the number meaningless. The literal-comparison shape below is
 * narrow on purpose: `x.role === "super_admin"` is an authorization decision in a way that
 * `<td>{member.role}</td>` is not.
 *
 * TARGET IS ZERO for the two legacy metrics. The burn-down is governed (ADR-008), not opportunistic:
 * define the estate capability/grant model, repoint the centralised helpers at capabilities where it is
 * safe to do so, then migrate call sites. Lower the baselines here as each phase lands.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

// The file that DEFINES the compatibility adapters is not a call site. Excluded so the burn-down
// measures dependence on them, not their existence -- deleting the definitions is the LAST step, not
// something this number should push anyone toward while 667 callers still exist.
const HELPER_DEFINITION_FILE = join("src", "lib", "api-auth.ts");

const LEGACY_HELPERS = /\b(hasRole|requireRole|isSuper|isStaff|isEducator|isSupervisor|isAdmin)\s*\(/g;
/** `x.role === "admin"`, `x.role !== "y"`, `x.roles.includes("z")` -- authorization-shaped, not display. */
const ROLE_LITERAL = /\.(role|roles)\b[^=!]{0,20}(===|!==|\.includes\s*\()\s*["'][a-z_]+["']/g;
const CAPABILITY = /\b(requireHqCapability|hasCapability|requireCapability|assertCapability)\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (p: string) => p.slice(ROOT.length + 1).split(sep).join("/");
const isRoute = (p: string) => rel(p).startsWith("src/app/api/") && p.endsWith(`${sep}route.ts`);

let helperCallSites = 0, roleLiterals = 0;
const helperFiles = new Set<string>();
const roleGatedRoutes = new Set<string>();
const capabilityRoutes = new Set<string>();
const offenders: { file: string; helpers: number; literals: number }[] = [];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const r = rel(f);

  const h = r === HELPER_DEFINITION_FILE.split(sep).join("/") ? 0 : (src.match(LEGACY_HELPERS) ?? []).length;
  const l = (src.match(ROLE_LITERAL) ?? []).length;

  helperCallSites += h;
  roleLiterals += l;
  if (h > 0) helperFiles.add(r);
  if (h > 0 || l > 0) offenders.push({ file: r, helpers: h, literals: l });
  if (isRoute(f)) {
    if (h > 0 || l > 0) roleGatedRoutes.add(r);
    if (CAPABILITY.test(src)) capabilityRoutes.add(r);
  }
}

// ── Baselines, measured 2026-08-19 by THIS script ────────────────────────────────────────────────
// Ceilings, not targets. Lower them as the burn-down lands; never raise one to make a build pass --
// that is the single thing this file exists to prevent.
const BASELINE = {
  /** 653 call sites across 203 files, excluding src/lib/api-auth.ts where they are defined. */
  helperCallSites: 653,
  /** `x.role === "literal"` and `x.roles.includes("literal")` across all of src. */
  roleLiterals: 114,
  /** API route.ts files carrying either shape. */
  roleGatedRoutes: 220,
  /**
   * ⚠ TWO. NOT SEVEN. A first pass reported seven by grepping route files for the helper NAMES, but
   * five of those matches are the names appearing inside explanatory COMMENTS ("requireHqCapability:
   * this is a fetch"). Only register-and-book and security actually call one, and both use Practice's
   * own hasCapability rather than an estate-plane grant. The estate plane has no capability
   * enforcement at all today, which makes ADR-008's first phase greenfield rather than an extension.
   * A floor, not a ceiling: this number must never fall.
   */
  capabilityRoutesFloor: 2,
};

// Allow a one-shot self-baselining run: `--baseline` prints the constants to paste back in.
if (process.argv.includes("--baseline")) {
  console.log(JSON.stringify({
    helperCallSites, roleLiterals,
    roleGatedRoutes: roleGatedRoutes.size,
    capabilityRoutesFloor: capabilityRoutes.size,
    helperFiles: helperFiles.size,
  }, null, 2));
  process.exit(0);
}

console.log("\n=== PLAT-GOV-001 s14: role-authorization ratchet ===\n");

let failed = 0;
const check = (name: string, current: number, ceiling: number) => {
  const ok = current <= ceiling;
  if (!ok) failed++;
  const delta = current - ceiling;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: ${current} (ceiling ${ceiling}${delta > 0 ? `, +${delta} OVER` : delta < 0 ? `, ${-delta} retired` : ""})`);
};
const floor = (name: string, current: number, min: number) => {
  const ok = current >= min;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: ${current} (floor ${min})`);
};

check("legacy helper call sites", helperCallSites, BASELINE.helperCallSites);
check("role-name literal comparisons", roleLiterals, BASELINE.roleLiterals);
check("API route files gated on a role", roleGatedRoutes.size, BASELINE.roleGatedRoutes);
floor("API route files gated on a capability", capabilityRoutes.size, BASELINE.capabilityRoutesFloor);

// ── ⚠ CONTROL: the detectors must match the shape they forbid ────────────────────────────────────
// A ratchet whose regex silently stopped matching would report zero and pass forever, which is the
// most dangerous way for this file to fail. Prove both patterns still bite, and prove the display
// shape does NOT -- the narrowness is the design, so it is worth asserting.
const probeAuth = `if (caller.role === "super_admin") allow();`;
const probeIncl = `if (c.roles.includes("hospital_admin")) allow();`;
const probeDisplay = `<td>{member.role}</td>`;
const probeHelper = `if (isSuper(c)) return null;`;
const controls: [string, boolean][] = [
  ["a role literal comparison is detected", new RegExp(ROLE_LITERAL.source).test(probeAuth)],
  ["a roles.includes literal is detected", new RegExp(ROLE_LITERAL.source).test(probeIncl)],
  ["a DISPLAY read is NOT counted", !new RegExp(ROLE_LITERAL.source).test(probeDisplay)],
  ["a legacy helper call is detected", new RegExp(LEGACY_HELPERS.source).test(probeHelper)],
];
console.log("");
for (const [name, ok] of controls) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  CONTROL: ${name}`);
}

if (failed > 0) {
  console.log("\nThe worst offenders, if you are looking for somewhere to start:");
  offenders.sort((a, b) => (b.helpers + b.literals) - (a.helpers + a.literals)).slice(0, 10)
    .forEach(o => console.log(`   ${o.file}  (${o.helpers} helper, ${o.literals} literal)`));
  console.log("\n⚠ If this went red because you ADDED a role check: the ruling (ADR-008) is that new");
  console.log("  authorization must use capabilities. Raising a ceiling here is not the fix.");
}

console.log(`\n${failed === 0 ? "ALL GREEN" : "RED"}  ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
