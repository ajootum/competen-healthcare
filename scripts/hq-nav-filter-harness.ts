/**
 * CP-HQ-NAV-001 — the capability-filtered HQ sidebar, and the switcher entry that leads to it.
 *
 * Run:  npx --yes tsx scripts/hq-nav-filter-harness.ts
 *
 * ⚠ WHAT THIS HARNESS DOES NOT PROVE. It proves what is DRAWN, not what is REACHABLE. 167 of the 205
 * /super-admin pages still test the `super_admin` role directly, so for those the filter only removes a
 * link that would have refused the person who clicked it. Nothing here should ever be cited as evidence
 * that a route is guarded — scripts/hq-guard-harness.ts is where that lives.
 *
 * ⚠ AND IT IMPORTS THE REAL NAV TABLES. The previous sidebar harness re-declared its own fixture of the
 * nav and stayed green under every deliberate break. The tables moved to
 * src/app/super-admin/_components/nav-tables.ts precisely so this file can assert over the data that ships.
 *
 * ⚠ THE LIVE SUBJECT IS DERIVED, NEVER PINNED. Three assertions in the HQ harnesses went stale the day real
 * people were appointed, and one of them asserted an EMPTY table — whose obvious "fix" would have deleted
 * real governance appointments. So this file finds whoever currently holds a non-owner HQ position, and if
 * nobody does it SKIPS and says so rather than asserting the absence.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { filterHqNav, canSeeHqLink } from "../src/lib/hq/nav-filter";
import { hqSearchCatalogue, matchHqDestinations } from "../src/lib/hq/search-catalogue";
import { capabilityForRoute, HQ_HOME_CAPABILITY, HQ_CAPABILITY_CODES } from "../src/lib/hq/spaces";
import { GENERAL_NAV, ALL_NAV_TABLES } from "../src/app/super-admin/_components/nav-tables";
import { resolveHqPositions } from "../src/lib/hq/context";

loadEnvConfig(process.cwd());

let pass = 0;
const failures: string[] = [];
const skips: string[] = [];
function ok(id: string, cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  ✗ ${id}  ${msg}`); }
}
function skip(id: string, msg: string) { skips.push(`${id}  ${msg}`); console.log(`  ○ ${id}  SKIPPED - ${msg}`); }

const src = (p: string) => readFileSync(p, "utf8");
const itemsOf = (sections: { items: { href: string }[] }[]) => sections.flatMap(s => s.items);
const countItems = (sections: { items: unknown[] }[]) => sections.reduce((n, s) => n + s.items.length, 0);

const OWNER = { isOwner: true, capabilities: [] as string[] };
const NOBODY = { isOwner: false, capabilities: [] as string[] };

(async () => {
  // ── A. The pure filter ────────────────────────────────────────────────────────────────────────────
  console.log("\nA. filterHqNav");

  // ⚠ THE CONTROL THAT MAKES EVERY OTHER ASSERTION IN THIS SECTION MEAN SOMETHING. Asserting over an empty
  // list is the vacuity trap this codebase keeps re-discovering: every "no forbidden link is shown" test
  // below passes trivially if the nav is empty.
  const fullGeneral = countItems(GENERAL_NAV);
  ok("A0", fullGeneral > 30 && GENERAL_NAV.length > 10,
    `CONTROL: GENERAL_NAV is non-trivial (${GENERAL_NAV.length} groups, ${fullGeneral} items)`);

  // ⚠ THE ONE THAT MATTERS MOST. An owner reaches the sidebar with capabilities: [] because the layout
  // short-circuits before reading any HQ table. If the filter ever infers ownership from a non-empty
  // capability list, every platform owner gets a blank console — and the accounts that could fix it are
  // the ones locked out.
  const ownerGeneral = filterHqNav(GENERAL_NAV, OWNER);
  ok("A1", countItems(ownerGeneral) === fullGeneral && ownerGeneral.length === GENERAL_NAV.length,
    `owner with ZERO capabilities still sees the whole sidebar (${countItems(ownerGeneral)}/${fullGeneral})`);

  ok("A2", ALL_NAV_TABLES.every(t => countItems(filterHqNav(t.sections, OWNER)) === countItems(t.sections)),
    `owner sees every item of all ${ALL_NAV_TABLES.length} nav tables unchanged`);

  ok("A3", filterHqNav(GENERAL_NAV, NOBODY).length === 0,
    "non-owner holding no capability sees no groups at all");

  // Every position holds HQ_HOME_CAPABILITY, which the intent map gives to /super-admin EXACTLY (and to
  // nothing beneath it), so this viewer should see the Overview link and nothing else in the table.
  const homeOnly = filterHqNav(GENERAL_NAV, { isOwner: false, capabilities: [HQ_HOME_CAPABILITY] });
  const homeItems = itemsOf(homeOnly);
  ok("A4", homeItems.length === 1 && homeItems[0].href === "/super-admin",
    `home capability alone yields exactly the Overview link (got ${homeItems.length}: ${homeItems.map(i => i.href).join(", ") || "none"})`);

  ok("A5", ALL_NAV_TABLES.every(t =>
        [OWNER, NOBODY, { isOwner: false, capabilities: [HQ_HOME_CAPABILITY] }]
          .every(v => filterHqNav(t.sections, v).every(s => s.items.length > 0))),
    "no group with zero items is ever returned (no empty headers)");

  // Links that LEAVE /super-admin are unmapped, and unmapped denies. /platform-admin is in PLATFORM
  // OPERATIONS and is another workspace behind its own gate.
  const everything = { isOwner: false, capabilities: [...HQ_CAPABILITY_CODES] };
  ok("A6", !canSeeHqLink("/platform-admin", everything) && canSeeHqLink("/platform-admin", OWNER),
    "an off-estate href is hidden from a non-owner holding EVERY capability, but shown to an owner");

  ok("A7", countItems(filterHqNav(GENERAL_NAV, { isOwner: false, capabilities: ["hq.not.a.real.capability"] })) === 0,
    "CONTROL: a capability no route maps to grants no links");

  // The invariant, over every table and several viewers: nothing is drawn that the viewer does not hold.
  const viewers = [
    NOBODY,
    { isOwner: false, capabilities: [HQ_HOME_CAPABILITY] },
    { isOwner: false, capabilities: [HQ_HOME_CAPABILITY, "hq.practice.operations.view"] },
    { isOwner: false, capabilities: ["hq.learning.studio.view"] },
    everything,
  ];
  const violations: string[] = [];
  for (const t of ALL_NAV_TABLES)
    for (const v of viewers)
      for (const i of itemsOf(filterHqNav(t.sections, v))) {
        const cap = capabilityForRoute(i.href);
        if (!cap || !v.capabilities.includes(cap)) violations.push(`${t.name} ${i.href}`);
      }
  ok("A8", violations.length === 0,
    `every drawn link is one the viewer holds, across ${ALL_NAV_TABLES.length} tables x ${viewers.length} viewers (${violations.length} violations)`);

  // ── B. The sidebar actually applies it ────────────────────────────────────────────────────────────
  console.log("\nB. WorkspaceSidebar / layout wiring");
  const sidebar = src("src/app/super-admin/_components/WorkspaceSidebar.tsx");
  const layout = src("src/app/super-admin/layout.tsx");

  ok("B1", /filterHqNav\(\s*table\s*,\s*\{\s*isOwner\s*,\s*capabilities:\s*hqCapabilities\s*\}\s*\)/.test(sidebar),
    "the sidebar filters the table through filterHqNav with the viewer");

  // The tables must no longer be declared in the component, or the harness would be asserting over a copy
  // nobody renders.
  ok("B2", /from "\.\/nav-tables"/.test(sidebar) && !/const GENERAL_NAV\s*=/.test(sidebar),
    "the nav tables live in nav-tables.ts and are not re-declared in the component");

  ok("B3", /isOwner=\{isOwner\}/.test(layout) && /hqCapabilities=\{hqCapabilities\}/.test(layout),
    "the layout passes BOTH isOwner and hqCapabilities to the sidebar");

  // ⚠ isOwner must not be optional or defaulted: an owner arrives with an empty capability list.
  ok("B4", /isOwner:\s*boolean;/.test(sidebar) && !/isOwner\?:/.test(sidebar),
    "isOwner is a REQUIRED prop (an owner's capability list is empty, so it cannot be inferred)");

  // Highlighting must be computed from the UNFILTERED table, or a parent reverts to prefix matching for a
  // viewer whose children are hidden.
  ok("B5", /parentHrefs\(table\.flatMap/.test(sidebar),
    "exact-match hrefs are derived from the unfiltered table, so highlighting does not depend on the viewer");

  // A person here by appointment is not a super admin, and the console must not tell them they are.
  ok("B6", /isOwner \? \(inWorkspace \? "Platform Owner" : "Super Admin"\) : "HQ Appointee"/.test(sidebar),
    "the identity line under the viewer's name is true for a non-owner");
  ok("B7", /const spaceLabel = isOwner \? "Super Admin" : "Competen HQ"/.test(sidebar)
        && /workspaceTitle=\{isOwner \? "Platform Super Admin" : "Competen HQ"\}/.test(layout),
    "sidebar and header both name the space honestly for a non-owner");

  // ── C. The way in ─────────────────────────────────────────────────────────────────────────────────
  console.log("\nC. workspaceLinksForUser");
  const wl = src("src/lib/workspace-links.ts");

  ok("C1", /href:\s*"\/super-admin"/.test(wl) && /HQ_WORKSPACE/.test(wl),
    "an HQ workspace link exists and points at /super-admin");

  // ⚠ The label is the point. A position is not a role.
  const labelMatch = wl.match(/const HQ_WORKSPACE[^=]*=\s*\{[^}]*label:\s*"([^"]+)"/);
  ok("C2", labelMatch?.[1] === "Competen HQ",
    `the switcher label is "Competen HQ", not a role name (got ${JSON.stringify(labelMatch?.[1] ?? null)})`);
  ok("C3", !/label:\s*"Super Admin"/.test(wl),
    "CONTROL: no switcher entry in this file is labelled with the super_admin role");

  ok("C4", /if \(capabilities\.length\) links\.unshift\(HQ_WORKSPACE\)/.test(wl),
    "the link is offered on CAPABILITIES, not positions (a deactivated position must stop advertising it)");

  ok("C5", /!userRoles\.includes\("super_admin"\)/.test(wl) && /!links\.some\(l => l\.href === HQ_WORKSPACE\.href\)/.test(wl),
    "a super admin (who already reaches /super-admin via ROLE_CONFIG) gets no duplicate entry");

  ok("C6", /ogs_office_appointments[\s\S]{0,200}\.limit\(1\)/.test(wl),
    "a cheap indexed probe runs before the full HQ resolution (this executes on every page load)");

  // ── D. Live ───────────────────────────────────────────────────────────────────────────────────────
  console.log("\nD. Live data");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    skip("D*", "no Supabase service credentials in the environment");
  } else {
    const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

    // Derive the subject: somebody holding an HQ position who is NOT an owner. Never pinned by name.
    const { data: profiles } = await admin.from("profiles").select("id, full_name, role, roles").limit(500);
    const nonOwners = ((profiles ?? []) as any[]).filter(p => {
      const roles = (p.roles?.length ? p.roles : [p.role]).filter(Boolean) as string[];
      return !roles.includes("super_admin");
    });
    const resolved = await Promise.all(nonOwners.map(async p =>
      ({ p, caps: (await resolveHqPositions(admin, p.id)).capabilities })));
    const appointees = resolved.filter(r => r.caps.length > 0);

    if (!appointees.length) {
      // ⚠ NOT AN ASSERTION. "No non-owner holds an HQ position" is a legitimate state of the world, and a
      // harness that failed on it would be demanding that somebody stay appointed.
      skip("D1-D4", "no non-owner currently holds an HQ position with live capabilities");
    } else {
      const subject = appointees[0];
      ok("D1", subject.caps.length > 0,
        `subject ${subject.p.full_name ?? subject.p.id} holds ${subject.caps.length} capabilit(y/ies)`);

      const viewer = { isOwner: false, capabilities: subject.caps };
      const seen = filterHqNav(GENERAL_NAV, viewer);
      const seenItems = itemsOf(seen);

      ok("D2", seenItems.length > 0,
        `their sidebar is not empty (${seen.length} group(s), ${seenItems.length} link(s): ${seenItems.map(i => i.href).join(", ")})`);

      ok("D3", seenItems.every(i => subject.caps.includes(capabilityForRoute(i.href) ?? "")),
        "every link they are shown maps to a capability they actually hold");

      // Proves the filter is doing work on real data rather than passing everything through.
      ok("D4", seenItems.length < fullGeneral,
        `the filter removes real links for them (${seenItems.length} shown of ${fullGeneral})`);
    }

    // An owner's console must be untouched by all of this.
    const owners = ((profiles ?? []) as any[]).filter(p => {
      const roles = (p.roles?.length ? p.roles : [p.role]).filter(Boolean) as string[];
      return roles.includes("super_admin");
    });
    if (!owners.length) skip("D5", "no super_admin profile found");
    else ok("D5", countItems(filterHqNav(GENERAL_NAV, { isOwner: true, capabilities: [] })) === fullGeneral,
      `owner accounts (${owners.length} live) see all ${fullGeneral} links`);
  }

  // ══ S. COMP-HQ-ACCESS-001 s15 -- THE SEARCH LAUNCHER'S CORPUS ══════════════════════════════════
  //
  // ⚠ s15's last line is the one that matters: "do not expose unauthorised object names through
  // search". The corpus is built on the SERVER from the same nav tables the sidebar renders, through
  // the same canSeeHqLink filter -- so these pins hold that leak shut at its source rather than
  // trusting a browser to hide anything.
  console.log("\nS. Search HQ / Go to (s15)");
  const ownerCorpus = hqSearchCatalogue(ALL_NAV_TABLES, { isOwner: true, capabilities: [] });
  const noneCorpus = hqSearchCatalogue(ALL_NAV_TABLES, { isOwner: false, capabilities: [] });
  ok("S1", ownerCorpus.length > 20 && new Set(ownerCorpus.map(d => d.href)).size === ownerCorpus.length,
    `an owner sees every destination exactly once (${ownerCorpus.length} deduped across the tables)`);
  ok("S2", noneCorpus.length === 0,
    "⚠ a viewer holding NO capability is offered nothing -- unauthorised names never reach the browser");
  const oneCap = HQ_CAPABILITY_CODES[0];
  const oneViewer = { isOwner: false, capabilities: [oneCap] };
  const oneCorpus = hqSearchCatalogue(ALL_NAV_TABLES, oneViewer);
  ok("S3", oneCorpus.every(d => canSeeHqLink(d.href, oneViewer)),
    `one capability offers only what that capability opens (${oneCorpus.length} destination(s))`);
  ok("S4", matchHqDestinations(ownerCorpus, "").length === 0,
    "an empty query answers nothing rather than dumping the whole console");
  ok("S5", matchHqDestinations(noneCorpus, "overview").length === 0,
    "⚠ an unauthorised viewer cannot find a destination by typing its exact name");
  const multi = matchHqDestinations(ownerCorpus, "mission control");
  ok("S6", multi.length > 0 && multi.every(d =>
    /mission/i.test(`${d.label} ${d.group}`) && /control/i.test(`${d.label} ${d.group}`)),
    `every term must match, not any (${multi.length} row(s) for "mission control")`);
  ok("S7", matchHqDestinations(ownerCorpus, "super-admin").length === 0,
    "the href is NOT searchable -- a route fragment would answer with the entire console");

  console.log(`\n${"=".repeat(72)}`);
  console.log(`PASS ${pass}   FAIL ${failures.length}   SKIP ${skips.length}`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log(`  - ${f}`)); }
  if (skips.length) { console.log("\nSKIPPED:"); skips.forEach(s => console.log(`  - ${s}`)); }
  process.exit(failures.length ? 1 : 0);
})();
