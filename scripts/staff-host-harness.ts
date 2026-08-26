/**
 * COMP-HQ-ACCESS-001 s5 -- THE STAFF HOST ENTRANCE.
 *
 * WHAT IT PROVES:
 *   - the staff host's bare root resolves to the staff door, and NOTHING else on that host moves;
 *   - ⚠ the fail-open property: every other host is returned untouched, which is every request this
 *     application serves today -- the file that runs in front of everything must be provably inert
 *     for the site it already has;
 *   - the host test is an EXACT match, so `notstaff.<domain>` and any attacker-chosen host that
 *     merely ends the same way are refused;
 *   - the customer host keeps /staff working (the spec's temporary fallback, and the owner's
 *     existing way in -- an entrance is being added, nothing is being taken away);
 *   - the file follows THIS Next version's convention (proxy.ts, exported `proxy`) rather than the
 *     deprecated middleware one -- written the old way it would simply never be called;
 *   - ⚠ the entrance was ADDED to the existing proxy, not substituted for it: the trace id,
 *     x-pathname, the session refresh and the device cookie all still run, and the matcher was
 *     NOT narrowed to the one path the entrance needs.
 *
 * Run: npx --yes tsx scripts/staff-host-harness.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { staffEntryRewrite, isStaffHost, normaliseHost, STAFF_DOOR_PATH } from "../src/lib/identity/staff-host";

let pass = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

/** Comments are stripped before any source scan: a needle must not match the prose describing it. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CUSTOMER = "competenhealthcare.com";
const STAFF = "staff.competenhealthcare.com";

// ── 1. The entrance ────────────────────────────────────────────────────────────────────────────
ok("1a. the staff host's root resolves to the staff door",
  staffEntryRewrite(STAFF, "/") === STAFF_DOOR_PATH, String(staffEntryRewrite(STAFF, "/")));
ok("1b. the development staff host behaves identically",
  staffEntryRewrite("staff.localhost:3000", "/") === STAFF_DOOR_PATH);
ok("1c. the host test is case-insensitive (headers are not normalised for us)",
  staffEntryRewrite("STAFF.COMPETENHEALTHCARE.COM", "/") === STAFF_DOOR_PATH);

// ── 2. ⚠ FAIL OPEN -- the property that makes this file safe to ship ───────────────────────────
ok("2a. ⚠ the customer host's root is returned UNTOUCHED",
  staffEntryRewrite(CUSTOMER, "/") === null, String(staffEntryRewrite(CUSTOMER, "/")));
ok("2b. an absent host is untouched rather than guessed",
  staffEntryRewrite(null, "/") === null && staffEntryRewrite("", "/") === null);
ok("2c. ⚠ the customer host keeps the staff door on its own path (the fallback, and the way in today)",
  staffEntryRewrite(CUSTOMER, STAFF_DOOR_PATH) === null);

// ── 3. Only the root, only that host ───────────────────────────────────────────────────────────
ok("3a. ⚠ deeper paths on the staff host are untouched, so the selector and HQ routes still resolve",
  staffEntryRewrite(STAFF, "/staff/workspaces") === null
  && staffEntryRewrite(STAFF, "/hq/practice") === null
  && staffEntryRewrite(STAFF, "/api/auth/login") === null);

// ── 4. ⚠ EXACT MATCH, not a suffix test ────────────────────────────────────────────────────────
ok("4a. ⚠ a host that merely ENDS with the staff host is refused",
  staffEntryRewrite("notstaff.competenhealthcare.com", "/") === null
  && staffEntryRewrite("evil-staff.competenhealthcare.com", "/") === null,
  "a suffix test would accept an attacker-chosen subdomain");
ok("4b. a lookalike domain is refused",
  staffEntryRewrite("staff.competenhealthcare.com.evil.test", "/") === null);
ok("4c-control: the exact host IS accepted, so 4a/4b are not vacuously true",
  isStaffHost(STAFF) && !isStaffHost("notstaff.competenhealthcare.com"));

// ── 5. Host normalisation ──────────────────────────────────────────────────────────────────────
ok("5a. the port is stripped and an IPv6 literal survives its brackets",
  normaliseHost("STAFF.LOCALHOST:3000") === "staff.localhost"
  && normaliseHost("[::1]:3000") === "[::1]");
ok("5b. a forwarded list takes the first host, not the concatenation",
  normaliseHost("staff.competenhealthcare.com, proxy.internal") === STAFF);

// ── 6. The proxy itself: convention, delegation, and everything it was ALREADY doing ───────────
const mw = stripComments(readFileSync("src/proxy.ts", "utf8"));
// ⚠ REPOINTED 2026-08-26, WITH THE SUPERSESSION RECORDED RATHER THAN PERFORMED QUIETLY.
// This pinned `staffEntryRewrite(` by name. The proxy now calls `gatewayEntryRewrite`, which applies
// the SAME rule to all six product gateways (COMP-ACCESS-URL-001 s13 step 5) and reads each route from
// the registry. What this assertion PROVES is unchanged and is the half that matters: the proxy
// delegates to a decision that can be tested without a request object, and parses no hostnames itself.
// Either delegate satisfies that; a hand-rolled `endsWith` or `split(".")` in the proxy still does not.
ok("6a. the proxy delegates to the tested decision rather than parsing hosts itself",
  /\b(staffEntryRewrite|gatewayEntryRewrite)\(/.test(mw) && !/endsWith\(|split\("\."\)/.test(mw),
  mw.match(/\b(staff|gateway)EntryRewrite\(/)?.[0] ?? "no delegate call found");
ok("6b. ⚠ THE MATCHER IS NOT NARROWED FOR THE STAFF ENTRANCE. It still runs for every route but"
  + " static assets -- narrowing it to the one path the entrance needs would silently disable the"
  + " trace id, x-pathname, the session refresh and the device cookie for the whole product",
  /_next\/static/.test(mw) && /_next\/image/.test(mw) && !/matcher:\s*"\/"/.test(mw),
  mw.match(/matcher:[\s\S]{0,120}/)?.[0] ?? "no matcher found");
ok("6c. an untouched request is passed through explicitly",
  mw.includes("NextResponse.next("));
ok("6d. ⚠ THIS Next's convention -- proxy.ts exporting `proxy`, with the deprecated middleware.ts"
  + " absent: written the old way it would be a file the framework never calls",
  /export async function proxy\(/.test(mw)
  && !existsSync("src/middleware.ts") && !existsSync("middleware.ts"));
ok("6e. ⚠ THE ENTRANCE WAS ADDED, NOT SUBSTITUTED: the trace id, x-pathname, the session refresh"
  + " and the device cookie all still run, and the rewrite carries the same forwarded headers",
  mw.includes("x-trace-id") && mw.includes("x-pathname")
  && mw.includes("supabase.auth.getUser()") && mw.includes("needsDeviceCookie(")
  && /NextResponse\.rewrite\(url, \{ request: \{ headers: withTrace\(request\) \} \}\)/.test(mw));

console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
