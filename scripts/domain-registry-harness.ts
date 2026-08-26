/**
 * COMP-ACCESS-URL-001 s13 step 2, s8 and s12 "Regression" -- THE CANONICAL DOMAIN REGISTRY.
 *
 * WHAT IT PROVES:
 *   - the registry names s1's seven gateways, each on the one domain family, each host distinct;
 *   - s8: `recruit.<domain>` is a retired name, and NOTHING in the tree references it -- this is the
 *     "regression check/search so the deprecated hostname cannot re-enter" that s8 asks for by name
 *     and that did not exist before this file;
 *   - s3: none of the four Enterprise module hostnames appears anywhere, so Workforce, Assessment,
 *     Learning and Quality cannot quietly acquire their own authentication estates;
 *   - s12 "Isolation"/"Privileged boundaries": `gatewayForHost` is an EXACT match, so a Host header of
 *     `notstaff.<domain>` or `staff.<domain>.evil.test` buys nothing;
 *   - ⚠ CONTAINMENT: no NEW executable Competen hostname literal outside the registry. Two exceptions
 *     are allowlisted with their reasons below. This is the assertion that keeps step 2 true after
 *     today -- a registry with no control is a comment, and the reason there were three executable
 *     hostnames before this work is that nothing ever said there should be one.
 *   - ⚠ THE `/hq` CONFLICT IS PINNED. s2 names `/hq` as the staff route; the application serves
 *     `/staff` and COMP-HQ-ACCESS-001 s5 froze it. The registry records the disagreement instead of
 *     picking a side, and this harness asserts the built route is the one written down AND that it
 *     exists on disk, so resolving the conflict is a deliberate act with a red test, not an edit.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE: that any of these hostnames resolve. s9 is DNS, TLS and
 * deployment mapping -- an owner action on the registrar and on Vercel. Measured 2026-08-24, six of
 * the seven do not resolve at all. A test cannot make a DNS record exist, and one that asserted the
 * registry "is implemented" while nothing answered would be the worst kind of green.
 *
 * Run: npx --yes tsx scripts/domain-registry-harness.ts
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  COMPETEN_DOMAIN,
  GATEWAYS,
  GATEWAY_KEYS,
  DEPRECATED_HOSTS,
  FORBIDDEN_MODULE_HOSTS,
  NON_GATEWAY_HOSTS,
  gatewayForHost,
  deprecatedHostTarget,
  gatewayOrigin,
  normaliseHost,
} from "../src/lib/identity/domains";
import { STAFF_HOSTS, STAFF_DOOR_PATH, isStaffHost, staffEntryRewrite } from "../src/lib/identity/staff-host";
import { gatewayEntryRewrite } from "../src/lib/identity/gateway-entry";

let pass = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

/**
 * Comments are stripped before any source scan: a needle must not match the prose describing it.
 * CRLF-safe -- `.` does not match a newline, and `$` with /m stops before the \r, so a trailing \r is
 * left behind rather than swallowing the line. This codebase has been bitten by that exact detail.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const ROOT = join(__dirname, "..");

/** Every source file worth scanning. The stale worktree copy under .claude is not this codebase. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git" || entry === ".claude") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx|mjs|js|json|sql)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const SCAN_DIRS = ["src", "scripts", "supabase"].map(d => join(ROOT, d)).filter(existsSync);
const FILES = SCAN_DIRS.flatMap(d => sourceFiles(d));
const rel = (f: string) => f.slice(ROOT.length + 1).replace(/\\/g, "/");

/** This harness and the registry legitimately name every host, including the retired ones. */
const REGISTRY_FILES = new Set(["src/lib/identity/domains.ts", "scripts/domain-registry-harness.ts"]);

console.log(`\nCOMP-ACCESS-URL-001 domain registry -- scanning ${FILES.length} files\n`);

// ── 1. The registry names s1's family ────────────────────────────────────────────────────────────
const EXPECTED: Record<string, string> = {
  public: `www.${COMPETEN_DOMAIN}`,
  practice: `practice.${COMPETEN_DOMAIN}`,
  enterprise: `enterprise.${COMPETEN_DOMAIN}`,
  individual: `individual.${COMPETEN_DOMAIN}`,
  recruitment: `recruitment.${COMPETEN_DOMAIN}`,
  staff: `staff.${COMPETEN_DOMAIN}`,
  platform: `platform.${COMPETEN_DOMAIN}`,
};
ok("1a. all seven s1 gateways are present, and no others",
  GATEWAY_KEYS.length === 7 && Object.keys(EXPECTED).every(k => GATEWAY_KEYS.includes(k as never)),
  GATEWAY_KEYS.join(", "));
ok("1b. every gateway carries s1's canonical hostname",
  GATEWAY_KEYS.every(k => GATEWAYS[k].host === EXPECTED[k]),
  GATEWAY_KEYS.filter(k => GATEWAYS[k].host !== EXPECTED[k]).join(", "));
ok("1c. every hostname sits inside the one domain family (s1: no standalone per-product domains)",
  GATEWAY_KEYS.every(k => GATEWAYS[k].host.endsWith(`.${COMPETEN_DOMAIN}`)));
ok("1d. hostnames are distinct -- two gateways sharing a host would make gatewayForHost ambiguous",
  new Set(GATEWAY_KEYS.map(k => GATEWAYS[k].host)).size === 7);
ok("1e. every gateway states a purpose and a product label (s10: messages use product names)",
  GATEWAY_KEYS.every(k => GATEWAYS[k].purpose.length > 10 && GATEWAYS[k].label.startsWith("Competen")));
ok("1f. gatewayOrigin composes an https origin with no trailing slash",
  gatewayOrigin("practice") === `https://practice.${COMPETEN_DOMAIN}`, gatewayOrigin("practice"));

// ── 2. s2 route equivalents, and the /hq conflict pinned ─────────────────────────────────────────
ok("2a. every gateway names a main-domain route (s2)",
  GATEWAY_KEYS.every(k => GATEWAYS[k].route.startsWith("/")));
const routeDir = (r: string) => join(ROOT, "src", "app", r.replace(/^\//, ""));
const missingRoutes = GATEWAY_KEYS
  .filter(k => GATEWAYS[k].route !== "/")
  .filter(k => !existsSync(routeDir(GATEWAYS[k].route)));
ok("2b. ⚠ every route the registry names is SERVED -- a registry naming a route nobody serves is a lie",
  missingRoutes.length === 0, missingRoutes.map(k => GATEWAYS[k].route).join(", "));
ok("2c. ⚠ the staff route is /staff, NOT s2's /hq -- COMP-HQ-ACCESS-001 s5 froze this door",
  GATEWAYS.staff.route === "/staff", GATEWAYS.staff.route);
ok("2d. ⚠ /hq does not exist, so adopting s2's name would mean BUILDING a second privileged entrance",
  !existsSync(join(ROOT, "src", "app", "hq")));
ok("2e. STAFF_DOOR_PATH is derived from the registry, so the two cannot drift apart",
  STAFF_DOOR_PATH === GATEWAYS.staff.route && STAFF_DOOR_PATH === "/staff", STAFF_DOOR_PATH);

// ⚠ THE RULING THE REGISTRY CITES MUST EXIST AND BE FINDABLE. domains.ts and staff-host.ts both point
// at ADR-014 as the reason the staff route is /staff rather than s2's /hq. A citation to a file nobody
// can find is worse than no citation: it reads as authority while carrying none, and the whole point of
// writing the ruling down was that it had been in force for a week with no record anybody could grep.
const ADR = "docs/adr/ADR-014-hq-mounts-on-super-admin.md";
ok("2f. ⚠ the ADR the registry cites exists",
  existsSync(join(ROOT, ADR)), ADR);
ok("2g. ⚠ ...and is listed in the ADR index, so it is reachable without knowing the filename",
  readFileSync(join(ROOT, "docs/adr/README.md"), "utf8").includes("ADR-014-hq-mounts-on-super-admin.md"));
// ⚠ THIS ASSERTS THE CLAIM, NOT THE SENTENCE. An earlier version of this pin matched one exact phrasing
// ("supersedes COMP-ACCESS-URL-001 s2's /hq") and went red against an ADR that says the same thing in
// the passive voice. Pinning prose word order tests the wording, not the ruling, and it fails on a
// rewrite that changed nothing -- the brittle shape this codebase keeps relearning.
// ⚠ READ DEFENSIVELY. 2f already reports a missing ADR; if this read threw as well, the harness would
// CRASH on that case instead of reporting it, and the run would end here with the later sections
// unevaluated. A control that takes the process down tells you less than one that goes red.
const adrText = existsSync(join(ROOT, ADR)) ? readFileSync(join(ROOT, ADR), "utf8") : "";
ok("2h. ⚠ ...and it rules on /hq rather than merely mentioning it",
  adrText.includes("COMP-ACCESS-URL-001") && /supersede/i.test(adrText) && adrText.includes("/hq"),
  `names-spec=${adrText.includes("COMP-ACCESS-URL-001")} supersede=${/supersede/i.test(adrText)}`);
ok("2i. the registry names the ADR, so a reader of the code reaches the reason",
  readFileSync(join(ROOT, "src/lib/identity/domains.ts"), "utf8").includes("ADR-014"));

// ── 2j. s13 step 5 — the gateway entry rule ──────────────────────────────────────────────────────
ok("2j. every product gateway's root rewrites to that product's route",
  GATEWAY_KEYS.filter(k => k !== "public")
    .every(k => gatewayEntryRewrite(GATEWAYS[k].host, "/") === GATEWAYS[k].route),
  GATEWAY_KEYS.filter(k => k !== "public")
    .filter(k => gatewayEntryRewrite(GATEWAYS[k].host, "/") !== GATEWAYS[k].route).join(", "));
ok("2k. ⚠ the PUBLIC host's root is untouched — the marketing home is what lives there",
  gatewayEntryRewrite(`www.${COMPETEN_DOMAIN}`, "/") === null
  && gatewayEntryRewrite("localhost", "/") === null);
ok("2l. ⚠ the bare apex is untouched too — it is the booking address, not a gateway (s4)",
  gatewayEntryRewrite(COMPETEN_DOMAIN, "/") === null);
ok("2m. ⚠ ONLY the root — every deeper path on a gateway host resolves normally",
  gatewayEntryRewrite(GATEWAYS.practice.host, "/practice/home") === null
  && gatewayEntryRewrite(GATEWAYS.staff.host, "/staff/workspaces") === null
  && gatewayEntryRewrite(GATEWAYS.platform.host, "/login") === null);
ok("2n. an unrecognised host is left alone rather than guessed",
  gatewayEntryRewrite("example.test", "/") === null
  && gatewayEntryRewrite(`notstaff.${COMPETEN_DOMAIN}`, "/") === null
  && gatewayEntryRewrite(null, "/") === null);
// ⚠ THE TWO SPELLINGS MUST AGREE. staffEntryRewrite predates the registry and COMP-HQ-ACCESS-001 s5's
// contract is written in terms of it; the general rule now serves the proxy. If they ever disagreed
// about the staff host there would be two answers to one question, which is the exact drift the
// registry was built to end.
ok("2o. ⚠ the general rule and the staff-specific one agree about the staff host",
  gatewayEntryRewrite(GATEWAYS.staff.host, "/") === staffEntryRewrite(GATEWAYS.staff.host, "/")
  && gatewayEntryRewrite(GATEWAYS.staff.host, "/x") === staffEntryRewrite(GATEWAYS.staff.host, "/x")
  && gatewayEntryRewrite("staff.localhost", "/") === staffEntryRewrite("staff.localhost", "/"));

// ── 3. staff-host.ts consumes the registry rather than its own copy ──────────────────────────────
ok("3a. STAFF_HOSTS derives from the registry (step 2: one shared configuration source)",
  STAFF_HOSTS.length === 2 && STAFF_HOSTS[0] === GATEWAYS.staff.host && STAFF_HOSTS[1] === "staff.localhost",
  STAFF_HOSTS.join(", "));
const staffSrc = stripComments(readFileSync(join(ROOT, "src/lib/identity/staff-host.ts"), "utf8"));
ok("3b. ⚠ staff-host.ts no longer types a hostname literal of its own",
  !/["'`][\w.-]*competenhealthcare\.com/.test(staffSrc),
  (staffSrc.match(/["'`][\w.-]*competenhealthcare\.com/) ?? [""])[0]);
ok("3c. isStaffHost and gatewayForHost agree about the staff host",
  isStaffHost(GATEWAYS.staff.host) && gatewayForHost(GATEWAYS.staff.host) === "staff");
ok("3d. they agree about a host that is neither",
  !isStaffHost("example.test") && gatewayForHost("example.test") === null);

// ── 4. ⚠ EXACT MATCH -- s12 Isolation and Privileged boundaries ──────────────────────────────────
ok("4a. an exact canonical host resolves",
  gatewayForHost(`practice.${COMPETEN_DOMAIN}`) === "practice");
ok("4b. case and port are normalised, because headers are not normalised for us",
  gatewayForHost(`PLATFORM.${COMPETEN_DOMAIN.toUpperCase()}:443`) === "platform");
ok("4c. ⚠ a prefixed lookalike is refused (`notstaff.<domain>`)",
  gatewayForHost(`notstaff.${COMPETEN_DOMAIN}`) === null);
ok("4d. ⚠ an attacker-controlled suffix is refused (`staff.<domain>.evil.test`)",
  gatewayForHost(`staff.${COMPETEN_DOMAIN}.evil.test`) === null);
ok("4e. ⚠ the bare apex is NOT a gateway -- it is the booking address (s4)",
  gatewayForHost(COMPETEN_DOMAIN) === null);
ok("4f. an absent or unusable host is null rather than guessed",
  gatewayForHost(null) === null && gatewayForHost("") === null && gatewayForHost("   ") === null);
ok("4g. a comma-joined forwarded header takes the first hop only",
  gatewayForHost(`staff.${COMPETEN_DOMAIN}, proxy.internal`) === "staff");
ok("4h. normaliseHost survives a bracketed IPv6 literal with a port",
  normaliseHost("[::1]:3000") === "[::1]", String(normaliseHost("[::1]:3000")));

// ── 5. s8 -- the recruitment naming migration ────────────────────────────────────────────────────
const RECRUIT_DEPRECATED = `recruit.${COMPETEN_DOMAIN}`;
ok("5a. recruitment's canonical host is the long form (s8 FREEZE)",
  GATEWAYS.recruitment.host === `recruitment.${COMPETEN_DOMAIN}`);
ok("5b. the canonical route is /recruitment (s8)",
  GATEWAYS.recruitment.route === "/recruitment");
ok("5c. the short form is recorded as retired, pointing at its successor",
  DEPRECATED_HOSTS[RECRUIT_DEPRECATED] === "recruitment");
ok("5d. deprecatedHostTarget resolves the retired name",
  deprecatedHostTarget(RECRUIT_DEPRECATED) === "recruitment");
ok("5e. ⚠ a retired name is NOT also a live gateway -- it must redirect, never serve",
  gatewayForHost(RECRUIT_DEPRECATED) === null);
ok("5f. no canonical gateway host is also listed as deprecated",
  GATEWAY_KEYS.every(k => !(GATEWAYS[k].host in DEPRECATED_HOSTS)));

// ⚠ THE REGRESSION SEARCH s8 ASKS FOR, over real files rather than over a memory of them.
const recruitHits = FILES
  .filter(f => !REGISTRY_FILES.has(rel(f)))
  .filter(f => new RegExp(RECRUIT_DEPRECATED.replace(/\./g, "\\.")).test(readFileSync(f, "utf8")))
  .map(rel);
ok("5g. ⚠ REGRESSION: the deprecated recruitment hostname appears nowhere in the tree",
  recruitHits.length === 0, recruitHits.slice(0, 5).join(", "));

// ── 6. s3 -- Enterprise modules stay inside the Enterprise shell ─────────────────────────────────
ok("6a. all four s3 module hostnames are named as forbidden",
  FORBIDDEN_MODULE_HOSTS.length === 4
  && ["workforce", "assessment", "learning", "quality"]
    .every(m => FORBIDDEN_MODULE_HOSTS.includes(`${m}.${COMPETEN_DOMAIN}`)),
  FORBIDDEN_MODULE_HOSTS.join(", "));
ok("6b. none of them is a gateway -- Enterprise authentication begins at one host",
  FORBIDDEN_MODULE_HOSTS.every(h => gatewayForHost(h) === null));
const moduleHits = FILES
  .filter(f => !REGISTRY_FILES.has(rel(f)))
  .flatMap(f => {
    const body = readFileSync(f, "utf8");
    return FORBIDDEN_MODULE_HOSTS.filter(h => body.includes(h)).map(h => `${rel(f)}: ${h}`);
  });
ok("6c. ⚠ REGRESSION: no independent Enterprise-module login domain appears in the tree (s12)",
  moduleHits.length === 0, moduleHits.slice(0, 5).join(", "));

// ── 7. s4 -- the booking carve-out, which is the thing most likely to be "tidied up" ──────────────
ok("7a. the bare apex is recorded as a non-gateway with its reason",
  COMPETEN_DOMAIN in NON_GATEWAY_HOSTS
  && NON_GATEWAY_HOSTS[COMPETEN_DOMAIN].length > 40);
const identitySrc = readFileSync(join(ROOT, "src/lib/practice/identity-service.ts"), "utf8");
ok("7b. ⚠ identityHost() still defaults to the APEX -- the address printed on patient cards (s4)",
  /NEXT_PUBLIC_PRACTICE_IDENTITY_HOST \?\? "https:\/\/competenhealthcare\.com"/.test(identitySrc));
ok("7c. ⚠ it was NOT repointed at the practice gateway, which would break every printed card",
  !identitySrc.includes(`?? "https://practice.${COMPETEN_DOMAIN}"`));

// ── 8. ⚠ CONTAINMENT -- the assertion that keeps step 2 true after today ─────────────────────────
/**
 * Two files legitimately hold an executable hostname of their own, each for a stated reason. This is
 * an allowlist in the style of plane-boundary.ts: adding an entry is a decision somebody writes down,
 * not something that happens because a literal was convenient.
 */
const HOSTNAME_ALLOWLIST: Record<string, string> = {
  "src/lib/marketing/site.ts":
    "SITE_URL's production default. metadataBase must be absolute in production or every social card points at localhost -- and it is the public gateway (www), which the registry also names.",
  "src/lib/practice/identity-service.ts":
    "identityHost()'s default is the patient booking apex, carved out of the gateway family by s4 and printed on physical cards.",
  // ⚠ THESE FOUR ARE ALLOWLISTED BUT NOT ENDORSED, and the reason is s9's environment separation.
  // Each is an ad-hoc live test script that reads .env.local and defaults `TEST_BASE` to PRODUCTION.
  // They are not repointed at the registry because they are .mjs and cannot import it without tsx,
  // and rewriting four throwaway scripts is not what step 2 is for. They are listed INDIVIDUALLY
  // rather than exempted as a class so that a fifth one fails this harness and somebody has to look:
  // "a test script whose default target is production" is exactly the shape s9 asks about, and it is
  // recorded in docs/COMP-ACCESS-URL-001-inventory.md as an open item rather than swept up here.
  // ⚠ THE THREE OPERATIONAL DNS CHECKS. Each must NAME the domain in order to query it -- a DNS checker
  // that cannot say which zone it is checking is not a checker. They are .mjs and cannot import the .ts
  // registry, the same constraint the four ad-hoc scripts below hit. Listed INDIVIDUALLY rather than
  // exempted as a class so a fourth one fails this assertion and somebody has to decide.
  "scripts/domain-activation-check.mjs": "s9 DNS/TLS activation check. Must name the zone it queries; .mjs cannot import the registry.",
  "scripts/gateway-acceptance-check.mjs": "s12 live acceptance against the six gateways. Must name the hosts it asserts about.",
  "scripts/mail-dns-check.mjs": "SPF/DKIM/DMARC/MX check. Domain is argv-overridable; the default names the zone it defends.",
  "scripts/coe-test.mjs": "Ad-hoc live test. TEST_BASE defaults to production -- see 8f and the inventory doc.",
  "scripts/coe-shift-test.mjs": "Ad-hoc live test. TEST_BASE defaults to production -- see 8f and the inventory doc.",
  "scripts/interaction-test.mjs": "Ad-hoc live test. TEST_BASE defaults to production -- see 8f and the inventory doc.",
  "scripts/workforce-test.mjs": "Ad-hoc live test. TEST_BASE defaults to production -- see 8f and the inventory doc.",
};

/** The four above, kept separate so 8f can assert the property that makes allowlisting them tolerable. */
const ADHOC_LIVE_SCRIPTS = [
  "scripts/coe-test.mjs",
  "scripts/coe-shift-test.mjs",
  "scripts/interaction-test.mjs",
  "scripts/workforce-test.mjs",
];

/** An email address is not a hostname. `hello@competenhealthcare.com` must not trip this scan. */
const HOSTNAME_LITERAL = /["'`](?:https?:\/\/)?((?:[\w-]+\.)*competenhealthcare\.com)/g;

const containmentHits: string[] = [];
for (const f of FILES) {
  const r = rel(f);
  if (REGISTRY_FILES.has(r) || r in HOSTNAME_ALLOWLIST) continue;
  const body = stripComments(readFileSync(f, "utf8"));
  for (const m of body.matchAll(HOSTNAME_LITERAL)) {
    // Harnesses must be able to name a host to test it being refused.
    if (r.startsWith("scripts/") && r.endsWith("-harness.ts")) continue;
    containmentHits.push(`${r}: ${m[1]}`);
  }
}
ok("8a. ⚠ CONTAINMENT: no executable Competen hostname literal outside the registry and its allowlist",
  containmentHits.length === 0, containmentHits.slice(0, 6).join(" | "));
ok("8b. every allowlist entry names a file that exists and states a reason",
  Object.entries(HOSTNAME_ALLOWLIST)
    .every(([f, why]) => existsSync(join(ROOT, f)) && why.length > 40),
  Object.keys(HOSTNAME_ALLOWLIST).filter(f => !existsSync(join(ROOT, f))).join(", "));
ok("8c. ⚠ the scan CAN see a literal -- proven against a synthetic body, so 8a is not vacuous",
  Array.from(
    stripComments(`const x = "https://practice.${COMPETEN_DOMAIN}";`).matchAll(HOSTNAME_LITERAL),
  ).length === 1);
ok("8d. ⚠ ...and an email address does NOT trip it, which is why 8a can be a hard rule",
  Array.from(
    stripComments(`const e = "hello@competenhealthcare.com";`).matchAll(HOSTNAME_LITERAL),
  ).length === 0);
// ⚠ WHAT MAKES ALLOWLISTING THE FOUR PRODUCTION-DEFAULTED SCRIPTS TOLERABLE: nothing runs them.
// s9 forbids a staging hostname routing production traffic or the reverse; a script that reaches for
// production when TEST_BASE is unset is one automated invocation away from being that. It is not
// automated today, and this assertion is what keeps that true.
const ciList = readFileSync(join(ROOT, "scripts/ci-harnesses.ts"), "utf8");
const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
const automated = ADHOC_LIVE_SCRIPTS.filter(s => {
  const base = s.replace("scripts/", "");
  return ciList.includes(base) || pkg.includes(base);
});
ok("8f. ⚠ the production-defaulting ad-hoc scripts are invoked by NOTHING -- not CI, not package.json",
  automated.length === 0, automated.join(", "));
ok("8g. all four are still present and still allowlisted, so 8f is about real files",
  ADHOC_LIVE_SCRIPTS.every(s => existsSync(join(ROOT, s)) && s in HOSTNAME_ALLOWLIST));

ok("8e. ⚠ ...and a commented-out literal does not trip it either",
  Array.from(
    stripComments(`// see https://practice.${COMPETEN_DOMAIN} for the gateway\r\nconst y = 1;`)
      .matchAll(HOSTNAME_LITERAL),
  ).length === 0);

// ── 9. s9 is NOT claimed here, and the file says so out loud ─────────────────────────────────────
const selfSrc = readFileSync(join(ROOT, "scripts/domain-registry-harness.ts"), "utf8");
ok("9a. ⚠ this harness states that it does not prove any hostname resolves (s9 is an owner action)",
  /DELIBERATELY DOES NOT PROVE/.test(selfSrc) && /DNS, TLS and\s+\*? ?deployment mapping/.test(selfSrc));
ok("9b. the registry refuses to model DNS state as a boolean that would drift",
  !/provisioned/.test(readFileSync(join(ROOT, "src/lib/identity/domains.ts"), "utf8").replace(/⚠[^\n]*/g, "")
    .split("\n").filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n")));

console.log(`\n${pass} passed, ${failures.length} failed\n`);
if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
