/**
 * COMP-ACCESS-ARCH-001 / COMP-STAFF-ACCESS-001 -- the access doors and the staff gateway.
 *
 * WHAT IT PROVES:
 *   - the door registry and the filesystem agree: every registered door page exists and renders;
 *   - ⚠ the BUILDING honesty: a door onto a product being built carries NO password field and says
 *     so; the estate door still announces those rooms before the password is typed;
 *   - the staff door reuses the shared machinery: it posts to /api/auth/login, respells no
 *     credential logic and no identity fold;
 *   - ⚠ the pure gateway decision, with fixture identities: gate 1 outranks every offer (the
 *     break-tested pin), the selector lists ONLY held contexts, and the three no-access states are
 *     each reachable and distinct;
 *   - no fakery on the new surfaces: none of the comp's refused controls, none of its invented
 *     figures, no disabled-teaser cards;
 *   - ⚠ PW-014 stands: /login still lands on /dashboard, and the staff selector exists only behind
 *     the staff door.
 *
 *   npx --yes tsx scripts/access-doors-harness.ts
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACCESS_DOORS, SHARED_IDENTITY_DOOR } from "../src/lib/access-doors";
import { decideStaffGateway, HQ_DOOR, type StaffSnapshot } from "../src/lib/staff/selector";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

/** Fixture builder -- the snapshot of an identity, defaulting to "holds nothing, member of nothing". */
const identity = (over: Partial<StaffSnapshot>): StaffSnapshot => ({
  isOwner: false, platformMember: true, workspaces: [], governanceContexts: [], appointmentStatuses: [],
  ...over,
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const posix = (p: string) => p.replace(/\\/g, "/");

async function main() {
  console.log("\n=== Access doors: the registry, the honesty, the staff gateway, PW-014 ===\n");

  // ── 1. THE REGISTRY AND THE FILESYSTEM AGREE ───────────────────────────────────────────────────
  ok("1a. every registered door page exists and exports a component",
    ACCESS_DOORS.every(d => existsSync(d.sourceFile) && readFileSync(d.sourceFile, "utf8").includes("export default")),
    ACCESS_DOORS.filter(d => !existsSync(d.sourceFile)).map(d => d.sourceFile).join(", "));
  ok("1b. six doors, the spec's six, unique codes and unique paths",
    ACCESS_DOORS.length === 6
    && new Set(ACCESS_DOORS.map(d => d.code)).size === 6
    && new Set(ACCESS_DOORS.map(d => d.path)).size === 6
    && ["PRACTICE", "ENTERPRISE", "INDIVIDUAL", "RECRUITMENT", "STAFF", "LANDLORD"]
      .every(c => ACCESS_DOORS.some(d => d.code === c)));
  ok("1c. every door carries the sentence that must stay true of it",
    ACCESS_DOORS.every(d => d.truth.length >= 40));
  ok("1d. the shared identity funnel is the estate door PW-014 governs",
    SHARED_IDENTITY_DOOR === "/login");

  // ── 2. THE BUILDING HONESTY -- a door may exist while the room is being built; it must say so ──
  const building = ACCESS_DOORS.filter(d => d.status === "being_built");
  ok("2a. ⚠ every being-built door has NO password field and renders the coming-soon pattern",
    building.length === 2 && building.every(d => {
      const src = readFileSync(d.sourceFile, "utf8");
      return !src.includes('type="password"') && src.includes("ProductComingSoon");
    }));
  const loginSrc = readFileSync("src/app/login/page.tsx", "utf8");
  ok("2b. the estate door still announces both rooms being built before the password is typed",
    loginSrc.includes('"/individual"') && loginSrc.includes('"/recruitment"'));
  const entSrc = readFileSync("src/app/enterprise/sign-in/page.tsx", "utf8");
  ok("2c. the Enterprise door holds no credential field and funnels to the one identity",
    !entSrc.includes('type="password"') && entSrc.includes("/login?next=/enterprise"));
  // ⚠ CONTROL: a needle that can never match proves nothing. The flag-gated Practice door's REAL
  // form does carry a password field -- if this goes red, the needle itself has drifted.
  ok("2d-control. the password needle can hit: the Practice form carries one",
    readFileSync("src/app/practice/sign-in/SignInForm.tsx", "utf8").includes('type="password"'));

  // ── 3. THE STAFF DOOR REUSES THE SHARED MACHINERY ──────────────────────────────────────────────
  const staffForm = readFileSync("src/app/staff/StaffSignInForm.tsx", "utf8");
  ok("3a. the staff form posts to the shared login route", staffForm.includes('"/api/auth/login"'));
  const staffSources = [...walk("src/app/staff"), ...walk("src/lib/staff")]
    .map(f => [f, readFileSync(f, "utf8")] as const);
  ok("3b. no credential logic is respelled behind the staff door",
    staffSources.every(([, src]) => !src.includes("signInWithPassword")),
    staffSources.filter(([, s]) => s.includes("signInWithPassword")).map(([f]) => f).join(", "));
  ok("3c. SSO rides the shared gate module, not a copy",
    staffForm.includes('from "@/lib/oauth-providers"'));
  ok("3d. ⚠ no identity fold is respelled: the loader imports the one spelling",
    readFileSync("src/lib/staff/gateway.ts", "utf8").includes("estateRolesOf(")
    && staffSources.every(([, src]) => !src.includes("roles?.length ? p.roles : [p.role]")));

  // ── 4. THE PURE GATEWAY DECISION -- fixture identities, only held contexts ─────────────────────
  const OWNER = identity({ isOwner: true });
  const dOwner = decideStaffGateway(OWNER);
  ok("4a. an owner is offered HQ, first and exactly once",
    dOwner.state === "SELECT" && dOwner.workspaces[0].href === HQ_DOOR.href
    && dOwner.workspaces.filter(w => w.href === HQ_DOOR.href).length === 1);

  // ⚠ THE LOAD-BEARING PIN (break-tested): gate 1 outranks every offer. Even a contradictory
  // workspace list cannot open the staff environment for a practice-only identity.
  const dPractice = decideStaffGateway(identity({
    platformMember: false,
    workspaces: [{ label: "Unit Manager", icon: "x", href: "/unit-manager" }],
  }));
  ok("4b. ⚠ a practice-only identity is refused the staff environment BEFORE any offer is read",
    dPractice.state === "PRACTICE_ONLY" && dPractice.destination === "/practice/home");

  const two = [
    { label: "Competency Office", icon: "x", href: "/competency-office" },
    { label: "Quality & Accreditation", icon: "x", href: "/quality-accreditation" },
  ];
  const dTwo = decideStaffGateway(identity({ workspaces: two }));
  ok("4c. the selector lists EXACTLY the held contexts -- nothing added, nothing invented",
    dTwo.state === "SELECT"
    && JSON.stringify(dTwo.workspaces.map(w => w.href)) === JSON.stringify(["/competency-office", "/quality-accreditation"]));

  const dAppointee = decideStaffGateway(identity({
    workspaces: [HQ_DOOR],
    governanceContexts: [{ appointmentId: "a1", positionCode: "cp_product_director", positionName: "CP Product Director", productLineCode: "practice" }],
    appointmentStatuses: ["active"],
  }));
  ok("4d. an HQ appointee's governance context rides through to the selector",
    dAppointee.state === "SELECT" && dAppointee.governanceContexts.length === 1
    && dAppointee.workspaces.some(w => w.href === "/super-admin"));

  ok("4e. a member holding nothing lands on the honest ground state",
    decideStaffGateway(identity({})).state === "NO_APPOINTMENT");
  ok("4f. appointments that no longer grant access say WITHDRAWN, not 'never appointed'",
    decideStaffGateway(identity({ appointmentStatuses: ["suspended", "expired", "removed"] })).state === "ACCESS_WITHDRAWN");
  ok("4g. a live appointment that opens nothing says so, distinctly",
    decideStaffGateway(identity({ appointmentStatuses: ["active"] })).state === "INSUFFICIENT");
  // ⚠ CONTROL: 4g must pass for the right reason -- the same appointment WITH a workspace selects.
  const dCtl = decideStaffGateway(identity({ appointmentStatuses: ["active"], workspaces: [two[0]] }));
  ok("4h-control. INSUFFICIENT requires emptiness: the same fixture with one workspace selects",
    dCtl.state === "SELECT");
  const dDup = decideStaffGateway(identity({ workspaces: [two[0], two[0]] }));
  ok("4i. a duplicated destination renders once",
    dDup.state === "SELECT" && dDup.workspaces.length === 1);

  // ── 5. NO FAKERY ON THE NEW SURFACES ───────────────────────────────────────────────────────────
  const newSurfaces = [
    ...staffSources,
    ["src/lib/access-doors.ts", readFileSync("src/lib/access-doors.ts", "utf8")] as const,
    ["src/app/enterprise/sign-in/page.tsx", entSrc] as const,
  ];
  const fakes = [/backup code/i, /trust this device/i, /remember me/i];
  ok("5a. ⚠ none of the comp's refused controls appears on any new surface",
    newSurfaces.every(([, src]) => fakes.every(rx => !rx.test(src))),
    newSurfaces.filter(([, s]) => fakes.some(rx => rx.test(s))).map(([f]) => f).join(", "));
  const figures = ["1.24", "99.8", "8.4%", "92%"];
  ok("5b. none of the comp's invented figures appears on any new surface",
    newSurfaces.every(([, src]) => figures.every(n => !src.includes(n))));
  // ⚠ "disabled=" (the JSX attribute), not the bare word -- the page's own header comment NAMES the
  // disabled-teaser rule, and a comment must not be the needle's haystack (this needle's first run
  // found exactly that).
  ok("5c. the selector renders no disabled-teaser cards (ARCH s14)",
    !readFileSync("src/app/staff/workspaces/page.tsx", "utf8").includes("disabled="));

  // ── 6. PW-014 STANDS -- universal landing unchanged for everyone but the staff door ────────────
  ok("6a. ⚠ /login still lands on /dashboard and never routes into the staff selector",
    loginSrc.includes(': "/dashboard"') && !loginSrc.includes("/staff/workspaces"));
  ok("6b. the SSO fallback destination is still the universal landing",
    readFileSync("src/lib/oauth-providers.ts", "utf8").includes('fallback = "/dashboard"'));
  const referrers = walk("src/app")
    .filter(f => readFileSync(f, "utf8").includes("/staff/workspaces"))
    .map(posix);
  ok("6c. the staff selector is reachable ONLY through the staff door",
    referrers.length > 0 && referrers.every(f => f.includes("src/app/staff/")),
    referrers.filter(f => !f.includes("src/app/staff/")).join(", "));

  // Measured, never pinned: the footer's staff-access target is the owner's pending decision
  // (docs/COMP-ACCESS-SURVEY-001.md s6.3).
  const footerHref = /href:\s*'([^']+)'/.exec(readFileSync("src/lib/marketing/home-content.ts", "utf8").split("STAFF_ACCESS")[1] ?? "")?.[1];
  console.log(`    measured (reported, never pinned): footer Competen Staff Access points at ${footerHref ?? "«unreadable»"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
