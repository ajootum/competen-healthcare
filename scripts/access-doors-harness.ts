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

  /**
   * ⚠ 2e/2f: THE PUBLIC PRODUCT PAGE ANSWERS A PROSPECT WHETHER OR NOT THEY ARE SIGNED IN.
   *
   * Found by the owner on competenhealthcare.com/enterprise (2026-08-17). The outer layout rendered
   * "this account is not attached to an organisation" for NO_TENANT -- at EVERY path beneath
   * /enterprise, including /enterprise itself. So anyone already signed in to Competen for another
   * reason (a practitioner on Practice, a member of HQ staff) who followed a product link to find out
   * what Enterprise IS was met with a dead end about not belonging to something they had never asked
   * to join, while the marketing gateway sat behind it, rendered for nobody.
   *
   * The page's own words are the argument: it calls the signed-out visitor "a PROSPECT following a
   * product card". Having no tenant is what makes somebody a prospect; being signed out never was.
   *
   * These pins hold the two halves apart, because the fix is only correct if BOTH are true: the root
   * shows the gateway to a tenant-less visitor, AND the honest sentence still exists where a person
   * actually reached for tenant content. Deleting the sentence would trade one defect for another.
   */
  const entLayout = readFileSync("src/app/enterprise/layout.tsx", "utf8");
  const entPage = readFileSync("src/app/enterprise/page.tsx", "utf8");
  ok("2e. /enterprise renders the gateway for a signed-in visitor with no tenant, not a dead end",
    /NO_TENANT"\s*\)\s*return\s*<>\{children\}<\/>/.test(entLayout)
    && /AUTH_REQUIRED"\s*\|\|\s*shell\.state\s*===\s*"NO_TENANT"/.test(entPage));

  // ⚠ REFUSED IS NOT THE SAME STATE and must NOT have been swept into the same branch: it means a
  // genuine block or an outage the gate could not read past, and a product that answered that with a
  // marketing page would be claiming all is well while something is wrong.
  ok("2e-control. REFUSED still renders its own sentence rather than the gateway",
    /REFUSED"\s*\)\s*\n?\s*return <NoAccess>\{shell\.sentence\}<\/NoAccess>/.test(entLayout));

  const entWorkforce = readFileSync("src/app/enterprise/workforce/layout.tsx", "utf8");
  ok("2f. the not-attached sentence still exists, on the tenant surface, with a way onward",
    entWorkforce.includes("NO_TENANT")
    && entWorkforce.includes("an administrator there can attach")
    && entWorkforce.includes('href="/enterprise"'));

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
  // ⚠ 4a, 4d, 4h and 4i REPOINTED (2026-08-17, COMP-HQ-ACCESS-001 updated consolidated). They
  // asserted SELECT for identities holding exactly ONE destination, which was the older staff
  // spec's permitted "confirm" branch. The consolidated HQ document withdraws that permission and
  // makes direct landing acceptance test one, so single-destination identities now resolve DIRECT.
  // What each pin PROVES is unchanged -- the offer is still exactly what is held, deduped, and
  // gate 1 still outranks it -- only the state name moved with the doctrine.
  const OWNER = identity({ isOwner: true });
  const dOwner = decideStaffGateway(OWNER);
  ok("4a. an owner is taken straight to HQ, offered exactly once",
    dOwner.state === "DIRECT" && dOwner.destination.href === HQ_DOOR.href);

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
  ok("4d. an HQ appointee's governance context rides through to the landing",
    dAppointee.state === "DIRECT" && dAppointee.governanceContexts.length === 1
    && dAppointee.destination.href === "/super-admin");

  ok("4e. a member holding nothing lands on the honest ground state",
    decideStaffGateway(identity({})).state === "NO_APPOINTMENT");
  ok("4f. appointments that no longer grant access say WITHDRAWN, not 'never appointed'",
    decideStaffGateway(identity({ appointmentStatuses: ["suspended", "expired", "removed"] })).state === "ACCESS_WITHDRAWN");
  ok("4g. a live appointment that opens nothing says so, distinctly",
    decideStaffGateway(identity({ appointmentStatuses: ["active"] })).state === "INSUFFICIENT");
  // ⚠ CONTROL: 4g must pass for the right reason -- the same appointment WITH a workspace selects.
  const dCtl = decideStaffGateway(identity({ appointmentStatuses: ["active"], workspaces: [two[0]] }));
  ok("4h-control. INSUFFICIENT requires emptiness: the same fixture with one workspace lands there",
    dCtl.state === "DIRECT" && dCtl.destination.href === two[0].href);
  const dDup = decideStaffGateway(identity({ workspaces: [two[0], two[0]] }));
  ok("4i. a duplicated destination is deduped, so it lands rather than offering the same door twice",
    dDup.state === "DIRECT" && dDup.destination.href === two[0].href);

  // ⚠ THE NEW DOCTRINE, PINNED AT BOTH ENDS (COMP-HQ-ACCESS-001 s7/s8, acceptance test one).
  // One destination is not a choice; two still are. Break-tested: restoring the old
  // `workspaces.length > 0 -> SELECT` branch takes this red.
  ok("4j. ⚠ one destination lands DIRECTLY and several still ask -- HQ is not a compulsory page",
    dCtl.state === "DIRECT" && dTwo.state === "SELECT" && dTwo.workspaces.length === 2);
  ok("4k. ⚠ and the door ACTS on it: the workspaces page redirects a DIRECT decision",
    /decision\.state === "DIRECT"\) redirect\(decision\.destination\.href\)/
      .test(readFileSync("src/app/staff/workspaces/page.tsx", "utf8")));

  // ── 4l-4n. DEEP LINKS SURVIVE THE SIGN-IN (COMP-HQ-ACCESS-001 s14) ────────────────────────────
  //
  // "All authorised routes support bookmarking. If signed out, authenticate then restore the
  // validated route." A bookmarked Mission Control used to be DROPPED: /super-admin redirected to a
  // bare /login and the person surfaced somewhere else with no way to tell why.
  const hqLayout = readFileSync("src/app/super-admin/layout.tsx", "utf8");
  ok("4l. ⚠ a signed-out HQ deep link carries its destination into the sign-in",
    /redirect\(`\/login\?next=\$\{encodeURIComponent\(next\)\}`\)/.test(hqLayout)
    && hqLayout.includes('headers()).get("x-pathname")'),
    "the destination must ride to /login, not be dropped");
  ok("4m. ⚠ and it is VALIDATED, not trusted -- an open redirect is a real attack",
    /\^\\\/super-admin/.test(hqLayout) && hqLayout.includes('"/super-admin"'),
    "only a plain relative /super-admin path may be honoured");
  const signInForm = readFileSync("src/app/staff/StaffSignInForm.tsx", "utf8");
  const staffDoorPage = readFileSync("src/app/staff/page.tsx", "utf8");
  // ── 4o-4r. s7's RETURNING-STAFF RULES for people holding SEVERAL destinations (migration 310) ──
  const dLast = decideStaffGateway(identity({ workspaces: two, lastWorkspaceHref: two[1].href }));
  ok("4o. ⚠ several destinations + a remembered last workspace lands there, not on a chooser",
    dLast.state === "DIRECT" && dLast.destination.href === two[1].href);
  const dPrimary = decideStaffGateway(identity({ workspaces: two, primaryWorkspaceHref: two[1].href }));
  ok("4p. with nothing observed yet, the administered primary answers instead",
    dPrimary.state === "DIRECT" && dPrimary.destination.href === two[1].href);
  ok("4q. ⚠ observed BEATS administered -- the returning case is what 'last' means",
    (() => {
      const d = decideStaffGateway(identity({
        workspaces: two, lastWorkspaceHref: two[0].href, primaryWorkspaceHref: two[1].href,
      }));
      return d.state === "DIRECT" && d.destination.href === two[0].href;
    })());
  // ⚠ THE LOAD-BEARING ONE: a hint is not an authority. A workspace withdrawn since the last visit
  // must NOT be reopened by a remembered href -- the account is asked instead.
  const dStale = decideStaffGateway(identity({
    workspaces: two, lastWorkspaceHref: "/a-workspace-no-longer-held",
  }));
  ok("4r. ⚠ a remembered workspace NO LONGER HELD is discarded, and the person is asked",
    dStale.state === "SELECT" && dStale.workspaces.length === 2,
    "a stale hint must never reopen a withdrawn workspace");

  ok("4n. the staff door returns somebody to where they were sent from, refusing protocol-relative",
    signInForm.includes('startsWith("/")') && signInForm.includes('!asked.startsWith("//")')
    && staffDoorPage.includes('!asked.startsWith("//")'));

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
  //
  // ⚠ 6a REPOINTED FOR COMP-ID-ROUTE-001 (2026-08-17). /login's neutral landing stopped being the
  // unconditional "/dashboard" literal and became the SERVER-RESOLVED destination set -- in which
  // the platform estate (/dashboard) is one destination, so a single-home account behaves exactly
  // as PW-014 decided. What this pin protects is unchanged and still asserted: the CUSTOMER
  // identity never routes into the staff selector, and the estate landing survives inside the
  // resolver (product-resolution.ts carries the PW-014 reconciliation in its header).
  ok("6a. ⚠ /login resolves destinations server-side, keeps /dashboard as the estate landing, and never routes into the staff selector",
    loginSrc.includes("resolveDestinations") && !loginSrc.includes("/staff/workspaces")
    && readFileSync("src/lib/identity/product-resolution.ts", "utf8").includes('href: "/dashboard"'));
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
