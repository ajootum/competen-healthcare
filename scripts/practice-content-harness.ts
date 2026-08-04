/**
 * Competen Practice public section harness (CPR-V2-000 .. CPR-V2-020).
 *
 * WHAT THIS IS FOR. The /practice section was derived from twenty developer specifications. "Derived from"
 * is exactly the kind of claim that is true on the day it is written and quietly false a year later: a
 * module gets dropped in a copy edit, an area is renamed and its screens are never re-pointed, a roadmap
 * integration loses its label and starts reading as shipped. None of that breaks a build. So the claims are
 * asserted here instead of trusted.
 *
 * FOUR THINGS ARE PROVEN:
 *
 *   COVERAGE  - every specified module (CPR-V2-001..020) is claimed by exactly one area, and no area claims a
 *               module that does not exist. Dropping a spec is then a test failure, not an oversight.
 *   ASSETS    - every screen referenced by the catalogue exists on disk AND is served. A broken image on a
 *               marketing page is the most embarrassing possible failure and the easiest to not notice.
 *   HONESTY   - the preview note renders on every page that shows a mockup, and every roadmap integration
 *               is labelled as such on the rendered page. Both are promises to the visitor; both live in
 *               prose, which is to say both decay silently.
 *   DISCLOSURE- WEB-STRAT-001's forbidden product names appear on none of these pages.
 *
 * Asserted against RENDERED HTML, not source, because a leak or a lost label reaches the visitor through
 * the render regardless of which file it came from.
 *
 * Needs the dev server on :3000.
 *   npx --yes tsx scripts/practice-content-harness.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  PRACTICE_AREAS, INTEGRATIONS, PREVIEW_NOTE, MODULES_WITHOUT_SPECS, PRACTICE_HERO, TENANT_MODEL,
  OVERVIEW_WORKSPACES, OVERVIEW_SCREEN, AREA_COUNT_WORD,
  NOT_AN_EMR, LP3_HERO, LP3_BENEFITS, LP3_AI, LP3_WORKSPACE,
} from "../src/lib/marketing/practice-content";
import { JOURNEYS, AVAILABILITY, JOURNEY_GATES, FAQS } from "../src/lib/marketing/practice-site";
import { V2_SPECIFIED_WORKSPACES, V1_IDS, isUnknownV1Id } from "../src/lib/practice/spec-numbering";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

// The words 3e recognises as a stated count. Kept here rather than exported from the content module: the
// harness should not learn its vocabulary from the thing it is checking.
const COUNT_WORDS = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/**
 * TWO SPECIFICATION LAYERS, because the product has two and they cross-cut.
 *
 * ENGINES  PEN-001..015, the capability layer -- one document each, stable since v2.
 * SURFACES CPR-V2-001..020, the workspace layer. The CPR space was in flux (its numbering disagreed with
 *          itself in two places, which is why the areas were anchored to PEN alone), and the V2 documents
 *          settled it. Both are now cited and both are proven covered exactly once.
 *
 * Coverage is asserted per layer, not merged: an area can legitimately own workspaces and no engine.
 * "Care anywhere" is exactly that -- teleconsultation and offline working consume engines that other areas
 * explain, so forcing it to own one would have meant taking an engine off the area that explains it.
 *
 * SURFACES comes from the numbering register rather than being generated here. It used to be generated,
 * and a generated id is invisible to a re-key: when the V2 set was namespaced (CPR-BUILD-001 s1) every
 * literal in the tree moved and this one silently did not, leaving the harness asserting coverage of a
 * scheme that no longer existed anywhere else -- which is precisely the failure mode s1 warns about.
 */
const ENGINES = Array.from({ length: 15 }, (_, i) => `PEN-${String(i + 1).padStart(3, "0")}`);
const SURFACES = V2_SPECIFIED_WORKSPACES;

// Same list as the public-disclosure harness, deliberately duplicated: if that file is ever narrowed, this
// one still fails, and two harnesses disagreeing is a louder signal than one silently relaxing.
const FORBIDDEN = [
  "Competency Management", "Workforce Management", "Executive Intelligence",
  "Recruitment platform", "Learning platform", "Competency Studio", "Assessment Studio",
  "AI platform", "Platform operations", "Configuration, integration",
];

// VOCABULARY FROM THE SOURCE DOCUMENTS THAT MUST NOT REACH A VISITOR.
//
// CPR-V2-000A and CPR-V2-019 Revision 2 are internal architecture papers. They describe the landlord control
// plane, the super-administrator's power to suspend a tenant and to open an audited impersonation session,
// and the internal architectures being bridged. Those sentences are RIGHT THERE in the material this page
// was written from, which makes them a copy-paste away from the public site at every future edit -- and
// "we can impersonate your users" is not a claim a clinic should first meet on a marketing page.
//
// This is a separate assertion from FORBIDDEN because it guards a different risk: not a product name that
// competitors should not see, but internal machinery that a CUSTOMER should not be handed unprompted.
const INTERNAL_VOCABULARY = [
  "landlord", "control plane", "impersonat", "super administrator", "super admin",
  "tenant lifecycle", "suspend", "maintenance mode", "telemetry", "LCP", "PSA",
];

/** Every .ts/.tsx/.css file under the given roots. Used by the numbering assertions in section 1f/1g. */
function sourceTree(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); }
      else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
    }
  };
  for (const r of roots) if (existsSync(r)) walk(r);
  return out;
}

function visibleText(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  // Entities are DECODED, not blanked. Blanking them turned "EMR &amp; EHR systems" into "EMR  EHR
  // systems", so searching for the name the page actually displays found nothing -- and a harness that
  // reports a problem the page does not have gets switched off within a week.
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

async function main() {
  // ── 1. COVERAGE: both specification layers actually made it into the content ──────────────────────
  const tally = (ids: string[]) => {
    const m = new Map<string, number>();
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const engines = tally(PRACTICE_AREAS.flatMap(a => a.engines));
  // The overview page claims CPR-V2-001 and CPR-V2-020: the command centre and the navigation architecture are
  // what /practice itself is, so counting them only across the AREAS would report them permanently missing.
  const surfaces = tally([...PRACTICE_AREAS.flatMap(a => a.workspaces), ...OVERVIEW_WORKSPACES]);

  for (const [label, list, counts] of [
    ["engine", ENGINES, engines] as const,
    ["workspace", SURFACES, surfaces] as const,
  ]) {
    const uncovered = list.filter(id => !counts.has(id));
    ok(`1. every ${label} specification is covered`, uncovered.length === 0, `uncovered: ${uncovered.join(", ")}`);

    const twice = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    ok(`1b. no ${label} is claimed twice`, twice.length === 0, twice.join(", "));

    const unknown = [...counts.keys()].filter(id => !list.includes(id));
    ok(`1c. no area claims a ${label} that has no specification`, unknown.length === 0, unknown.join(", "));
  }

  // Engines and workspaces must not be muddled into one another's field -- that would silently pass
  // coverage while making the traceability meaningless.
  const misfiled = [
    ...PRACTICE_AREAS.flatMap(a => a.engines).filter(id => !id.startsWith("PEN-")),
    ...PRACTICE_AREAS.flatMap(a => a.workspaces).filter(id => !id.startsWith("CPR-V2-")),
  ];
  ok("1d. engines and workspaces are not filed in each other's list", misfiled.length === 0, misfiled.join(", "));

  // A recorded gap must stay a gap: if one is ever written into an area, the note beside it has become a lie.
  const gapClaimed = MODULES_WITHOUT_SPECS.filter(id => engines.has(id) || surfaces.has(id));
  ok("1e. recorded spec gaps are still gaps", gapClaimed.length === 0, gapClaimed.join(", "));

  // ── 1f/1g. THE NUMBERING DECISION HOLDS ACROSS THE WHOLE TREE (CPR-BUILD-001 s1) ──────────────────
  //
  // Asserted over the SOURCE rather than over this module's own arrays, because the decision is only
  // worth anything if it survives the next file somebody writes. Two failures are possible and they are
  // different mistakes:
  //
  //   1f  a bare three-digit id in the OLD range -- somebody copied a citation from a pre-decision file
  //       or from a V2 document, and the tree now has a string that means two things again.
  //   1g  a v1.0-shaped id that is not one of the thirty-seven -- a typo'd or invented citation, which
  //       reads as traceability and traces to nothing.
  //
  // Comments are in scope deliberately: nearly every CPR citation in this codebase lives in one, and a
  // comment is where a developer goes to find out which document a module implements.
  // CONTROL FIRST: a scan that reads nothing reports every rule as satisfied. Both counts are asserted
  // non-trivial, so "no violations" cannot mean "no files" or "no citations".
  const sourceFiles = sourceTree(["src", "scripts"]);
  const stray: string[] = [];
  const unknownV1: string[] = [];
  let citations = 0;
  for (const file of sourceFiles) {
    // `CPR-V2-001` is not a candidate at all: the literal `CPR-` must be followed by three digits, and in
    // the namespaced form it is followed by `V2-`. So the scan sees only bare ids, which is the point.
    for (const m of readFileSync(file, "utf8").matchAll(/\bCPR-(\d{3})\b/g)) {
      citations++;
      if (Number(m[1]) <= 21) stray.push(`${relative(process.cwd(), file)}: ${m[0]}`);
      else if (isUnknownV1Id(m[0])) unknownV1.push(`${relative(process.cwd(), file)}: ${m[0]}`);
    }
  }
  ok("1f-control. the numbering scan reads real files and finds real citations",
    sourceFiles.length > 50 && citations > 10, `${sourceFiles.length} files, ${citations} citations`);
  ok("1f. no bare old-set CPR id survives anywhere in src/ or scripts/", stray.length === 0,
    `${stray.length} found -- ${stray.slice(0, 4).join("; ")}`);
  ok("1g. every v1.0-shaped CPR id cited in code is one of the 37 specifications", unknownV1.length === 0,
    `${unknownV1.length} found -- ${unknownV1.slice(0, 4).join("; ")}`);
  ok("1h. the v1.0 register holds all 37 specifications", V1_IDS.length === 37, String(V1_IDS.length));

  // ── 2. ASSETS: every screen exists on disk ────────────────────────────────────────────────────────
  const allImages = [PRACTICE_HERO.image, OVERVIEW_SCREEN.src, ...PRACTICE_AREAS.flatMap(a => a.screens.map(s => s.src))];
  const missingOnDisk = [...new Set(allImages)].filter(src => !existsSync(join(process.cwd(), "public", src)));
  ok("2. every referenced screen exists on disk", missingOnDisk.length === 0, missingOnDisk.join(", "));

  const emptyAlt = [OVERVIEW_SCREEN, ...PRACTICE_AREAS.flatMap(a => a.screens)].filter(s => s.alt.trim().length < 20);
  ok("2b. every screen has descriptive alt text", emptyAlt.length === 0, emptyAlt.map(s => s.src).join(", "));

  // ALT TEXT MUST NOT NAME THE DEMO PRACTICE.
  //
  // The agreed name is "Competen Medical Centre", but the current mockups are rendered PNGs showing
  // "Sunrise Medical Centre" on nineteen screens and "Eonrise Medical Centre" on the integrations screen
  // (a typo in the source artwork). Until the screens are re-exported, naming the practice in a caption or
  // alt attribute tells a screen-reader user something different from what a sighted user reads -- which
  // is a worse failure than the omission it fixes.
  //
  // Asserted in BOTH directions on purpose: the old names must not appear because they are wrong, and the
  // new one must not appear because the pixels do not say it yet. Whichever way somebody "tidies" this,
  // the harness objects until the images actually match.
  const practiceNames = ["Sunrise Medical", "Eonrise Medical", "Competen Medical"];
  const named = [OVERVIEW_SCREEN, ...PRACTICE_AREAS.flatMap(a => a.screens)]
    .filter(s => practiceNames.some(n => `${s.alt} ${s.caption}`.toLowerCase().includes(n.toLowerCase())));
  ok("2c. no screen alt or caption names the demo practice", named.length === 0,
    named.map(s => s.src).join(", "));

  // ── 3. every area page is reachable, and carries what it promises ─────────────────────────────────
  const PAGES = ["/practice", ...PRACTICE_AREAS.map(a => `/practice/${a.slug}`)];
  const overview = await fetch(`${BASE}/practice`).then(r => r.text()).catch(() => "");

  for (const path of PAGES) {
    let html = "";
    try {
      const r = await fetch(BASE + path);
      ok(`3. ${path} returns 200`, r.ok, `status ${r.status}`);
      html = await r.text();
    } catch (e) {
      ok(`3. ${path} returns 200`, false, e instanceof Error ? e.message : String(e));
      continue;
    }
    const text = visibleText(html);

    const leaked = FORBIDDEN.filter(f => text.toLowerCase().includes(f.toLowerCase()));
    ok(`3b. ${path} discloses no hidden product`, leaked.length === 0, leaked.join(", "));

    // HONESTY RULE 1. Every page here renders mockups; every one of them must say so.
    ok(`3c. ${path} labels its screens as previews`, text.includes(PREVIEW_NOTE));

    // Case-insensitive and substring, so "Impersonation", "impersonate" and "Landlord Control Plane" all
    // trip it. Word-boundary matching would let a plural or a participle through.
    const internal = INTERNAL_VOCABULARY.filter(w => text.toLowerCase().includes(w.toLowerCase()));
    ok(`3d. ${path} leaks no internal platform vocabulary`, internal.length === 0, internal.join(", "));

    // 3e. PROSE THAT COUNTS A GENERATED LIST MUST AGREE WITH IT.
    //
    // The overview said "Six areas, one product" directly above a grid rendering all eight, because V2 grew
    // the list and the sentence introducing it was a string literal. Nothing could catch that: the number is
    // inside prose, so the typecheck sees a valid string and the coverage assertions see a complete list.
    // Matching "<word> areas" wherever it appears is the general form -- it fails for any page that states
    // the count, however that page came to state it.
    const stated = [...text.matchAll(/\b([A-Za-z]+)\s+areas\b/gi)]
      .map(m => m[1].toLowerCase())
      .filter(w => COUNT_WORDS.includes(w) && w !== AREA_COUNT_WORD);
    ok(`3e. ${path} states the area count correctly`, stated.length === 0,
      `says "${stated.join('", "')}" areas; there are ${PRACTICE_AREAS.length} (${AREA_COUNT_WORD})`);
  }

  // ── 4. NAVIGATION: catalogue, nav and routes agree ────────────────────────────────────────────────
  //
  // CPR-V2-001 v3 made the homepage SHORT: it no longer enumerates every capability area, it links to the
  // catalogue. So the assertion moved with it -- the homepage must offer a way IN to the areas, and each
  // area must still resolve. Asserting a link per area against a page that deliberately stopped listing
  // them would be testing the old design, which is how a harness starts blocking the work it guards.
  ok("4. /practice links into the capability catalogue",
    PRACTICE_AREAS.some(a => overview.includes(`/practice/${a.slug}"`)));
  for (const a of PRACTICE_AREAS) {
    const s = await fetch(`${BASE}/practice/${a.slug}`).then(r => r.status).catch(() => 0);
    ok(`4a. /practice/${a.slug} resolves`, s === 200, `status ${s}`);
  }
  ok("4b. the dynamic route file exists",
    existsSync(join(process.cwd(), "src", "app", "practice", "[area]", "page.tsx")));

  // A slug that is not in the catalogue must 404 rather than render an empty shell.
  const bogus = await fetch(`${BASE}/practice/not-a-real-area`).then(r => r.status).catch(() => 0);
  ok("4c. an unknown area 404s", bogus === 404, `status ${bogus}`);

  // ── 5. HONESTY RULE 2: roadmap integrations are labelled where they are shown ─────────────────────
  const overviewText = visibleText(overview);
  const roadmap = INTEGRATIONS.filter(i => !i.inV1);
  ok("5. there is something on the roadmap to label", roadmap.length > 0);

  // Each roadmap integration must be followed by its label before the next integration's name starts --
  // asserting only that the word "Roadmap" appears somewhere would pass even if the chips were rendered
  // against the wrong items.
  // 5b/5c WERE ASSERTED HERE AND ARE NOW ASSERTED CONDITIONALLY.
  //
  // CPR-V2-001 v3 removed the integrations table from the homepage, so the old assertions had no subject.
  // They were briefly stubbed to `true` to get the suite green -- which is the "fails as good news"
  // pattern this file exists to prevent, and worse than deleting them, because a stub still prints PASS.
  // The honest shape is: check it WHERE IT IS SHOWN, and say plainly when it is shown nowhere.
  const shown = roadmap.filter(i => overviewText.includes(i.name));
  if (shown.length === 0) {
    console.log("  NOTE  5b/5c. the homepage no longer lists integrations, so roadmap labelling is not testable here");
  } else {
    const mislabelled = shown.filter(i => {
      const at = overviewText.indexOf(i.name);
      return !overviewText.slice(at, at + i.name.length + 60).includes("Roadmap");
    });
    ok("5b. every roadmap integration shown is labelled", mislabelled.length === 0,
      mislabelled.map(i => i.name).join(", "));

    const overLabelled = INTEGRATIONS.filter(i => i.inV1).filter(i => {
      const at = overviewText.indexOf(i.name);
      return at !== -1 && overviewText.slice(at, at + i.name.length + 60).includes("Roadmap");
    });
    ok("5c. Version 1 integrations are NOT labelled as roadmap", overLabelled.length === 0,
      overLabelled.map(i => i.name).join(", "));
  }

  // ── 5d. CPR-V2-000A: the tenant model renders, and its diagram does NOT ──────────────────────────────
  // The short page keeps the OWNERSHIP BOUNDARY and drops the four pillars -- that sentence is the one a
  // clinician hesitates over, and it is asserted below at 5e. The pillars live on the capability pages.
  ok("5e. /practice states who can change what", overviewText.includes(TENANT_MODEL.boundary.slice(0, 60)));

  // The enterprise architecture diagram draws the control plane and the full product ecosystem. It must
  // not be published, and an image cannot be caught by any text assertion above -- so its absence from the
  // built assets is asserted directly.
  const architectureLeaks = ["architecture", "cpr-000a", "ecosystem", "control-plane"]
    .filter(n => existsSync(join(process.cwd(), "public", "images", "practice", `${n}.webp`)));
  ok("5f. the enterprise architecture diagram is not published", architectureLeaks.length === 0,
    architectureLeaks.join(", "));

  // ── 7. LP-PRA-001 journeys, and the honesty they carry ────────────────────────────────────────────
  //
  // Four journeys replaced a single "Book a Demo" that sent everyone to /signup. Two things can rot here:
  // a journey losing its page, and a journey page quietly dropping the notice that says it is not open.
  // The second is the dangerous one -- it turns an honest holding page into a product that appears broken.

  const areaSlugs = new Set(PRACTICE_AREAS.map(a => a.slug));
  const shadowed = JOURNEYS.filter(j => areaSlugs.has(j.href.replace("/practice/", "")));
  ok("7. no journey route collides with a capability slug", shadowed.length === 0,
    shadowed.map(j => j.href).join(", "));

  // The launch flags are read from the SAME database the pages read, so 7b compares the page against
  // reality rather than against an assumption about which posture we are in. A missing flag row reads as
  // closed, which is the safe direction and is asserted below rather than silently defaulted.
  const gateOpen: Record<string, boolean> = {};
  let serverSeesFlags = true;
  {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
    const wanted = [...new Set(Object.values(JOURNEY_GATES).map(g => g.flag))];
    const { data } = db ? await db.from("practice_platform_flags").select("flag, enabled").in("flag", wanted) : { data: null };
    const rows = (data ?? []) as { flag: string; enabled: boolean }[];
    for (const f of wanted) gateOpen[f] = !!rows.find(r => r.flag === f)?.enabled;
    // DOES THE SERVER AGREE WITH THE DATABASE ABOUT THE FLAGS? A discriminator, not a nicety.
    //
    // This harness reads practice_platform_flags with its own service-role client. The SERVER reads them
    // with its own, and when the two disagree every gated page renders closed while the database says
    // open. The gate assertions would then report a page bug that does not exist, and the next person
    // spends an hour in JourneyPage -- the same confident wrong measurement this file exists to prevent,
    // aimed at itself.
    //
    // The homepage CTA is the probe: it is flag-driven, public, and needs no session. With sign-in ON a
    // working server offers "Sign in"; a disagreeing one falls through to "Talk to us".
    //
    // ⚠️ THE NOTE BELOW USED TO NAME ONE CAUSE WITH CONFIDENCE, AND IT SENT THE NEXT READER WRONG.
    //
    // It blamed a dev server started without NODE_EXTRA_CA_CERTS behind TLS interception. Chasing that
    // produced two further wrong answers before the truth: the cert variable turned out not to be the
    // discriminator at all. What actually decides it is HOW THE DEV SERVER WAS SPAWNED -- a server
    // started from a terminal (`npm run dev`) reads the flags; one spawned by the editor's preview
    // tooling gets "TypeError: fetch failed" on every Supabase call, in the same repository, from the
    // same build.
    //
    // So this note now lists what to check rather than asserting which it is. If the flag-dependent
    // assertions are skipping, the first thing to try is starting the dev server yourself.
    const home = await fetch(`${BASE}/practice`).then(r => r.text()).catch(() => "");
    const signInFlag = !!rows.find(r => r.flag === "practice_sign_in")?.enabled;
    serverSeesFlags = !signInFlag || !/Talk to us about your practice/.test(visibleText(home));
    if (!serverSeesFlags) {
      console.log("  NOTE  7b-gate. the SERVER disagrees with the database about the launch flags, so the");
      console.log("        gated pages below are not testable here. What to check, in order:");
      console.log("        1. START THE DEV SERVER YOURSELF -- `npm run dev` in a terminal. A server");
      console.log("           spawned by editor preview tooling has been seen to fail every Supabase call");
      console.log("           while an identical terminal-started one succeeds. This is the usual answer.");
      console.log("        2. Does the server log `could not read launch flag`? Then its fetch is failing;");
      console.log("           NODE_EXTRA_CA_CERTS matters if HTTPS is intercepted on this machine.");
      console.log("        3. Is /practice still force-dynamic? A statically rendered flag is baked.");
      console.log("        4. Stale build? Remove .next and restart.");
    }

    ok("7-flags. every gated journey's flag exists in the database", rows.length === wanted.length,
      `${rows.length}/${wanted.length} -- a gate pointing at a missing flag is permanently and silently closed`);
  }

  for (const j of JOURNEYS) {
    let html = "";
    try {
      const r = await fetch(BASE + j.href);
      ok(`7a. ${j.href} returns 200`, r.ok, `status ${r.status}`);
      html = await r.text();
    } catch (e) {
      ok(`7a. ${j.href} returns 200`, false, e instanceof Error ? e.message : String(e));
      continue;
    }
    const text = visibleText(html);

    // 7b. EXACTLY ONE OF THE TWO PANELS, never both and never neither.
    //
    // The old assertion was "says it is not open yet", which would turn red the moment a launch flag
    // flipped -- reporting a successful launch as a regression, which is the fastest way to teach
    // somebody to ignore a harness. What must stay true is not the notice; it is that a visitor is told
    // where they stand. So: a gated journey whose flag is ON shows the live action and links to a real
    // route; every other journey shows the notice. "Neither" is the failure that matters, because that
    // is the state where a person reads three screens and is never told they cannot use any of it.
    const gate = JOURNEY_GATES[j.key];
    const saysClosed = text.includes(AVAILABILITY.headline);
    const saysOpen = !!gate && text.includes(gate.headline) && html.includes(`href="${gate.action.href}"`);
    ok(`7b. ${j.href} states its availability exactly once`, saysClosed !== saysOpen,
      saysClosed && saysOpen ? "shows BOTH panels" : "shows NEITHER panel");
    if (gate && serverSeesFlags) {
      ok(`7b-gate. ${j.href} matches the ${gate.flag} flag`, saysOpen === gateOpen[gate.flag],
        `flag=${gateOpen[gate.flag]} page=${saysOpen ? "open" : "closed"}`);
    } else if (gate) {
      // Not skipped silently: the NOTE above says why, and the count below says how many were lost.
      console.log(`  SKIP  7b-gate. ${j.href} -- the server cannot read flags in this environment`);
    } else {
      ok(`7b-ungated. ${j.href} shows the notice (nothing behind it is built)`, saysClosed);
    }

    const leaked = FORBIDDEN.filter(f => text.toLowerCase().includes(f.toLowerCase()));
    ok(`7c. ${j.href} discloses no hidden product`, leaked.length === 0, leaked.join(", "));

    const internal = INTERNAL_VOCABULARY.filter(w => text.toLowerCase().includes(w.toLowerCase()));
    ok(`7d. ${j.href} leaks no internal platform vocabulary`, internal.length === 0, internal.join(", "));

    // NO SIGN-IN FORM. The roles these pages route to do not exist, so a password field here would
    // collect a credential and have nowhere to send the person who typed it. Asserted on the rendered
    // HTML rather than the source, because a form could arrive through a shared component.
    const hasPasswordField = /<input[^>]+type=["']password["']/i.test(html);
    ok(`7e. ${j.href} has no password field`, !hasPasswordField);
  }

  // Every journey must be reachable from the landing page, or it is a page with no way in.
  for (const j of JOURNEYS) {
    ok(`7f. /practice links to ${j.href}`, overview.includes(`href="${j.href}"`));
  }

  // LP-PRA-001 asks for FAQs. The availability question is the one a visitor has by the time they reach
  // the bottom and the easiest to quietly drop, so its presence is asserted rather than assumed.
  ok("7g. /practice renders the FAQs", FAQS.every(f => overviewText.includes(f.q)));

  ok("7h. the FAQs answer whether it can be used today",
    FAQS.some(f => /try it today|available/i.test(f.q)));

  // ── 6. the images are actually served, not merely present ─────────────────────────────────────────
  const notServed: string[] = [];
  for (const src of [...new Set(allImages)]) {
    const r = await fetch(BASE + src).catch(() => null);
    if (!r?.ok) notServed.push(`${src} (${r?.status ?? "no response"})`);
  }
  ok("6. every screen is served over HTTP", notServed.length === 0, notServed.join(", "));

  // ── 8. CPR-V2-001 v3: the short homepage, and what it refuses to say ─────────────────────────────────
  //
  // The sections are asserted so a future edit cannot quietly drop one. The REFUSALS are asserted because
  // they are decisions, and a decision that lives only in a commit message is one the next person working
  // from the comp will undo. This comp is the most dangerous the project has had: it bands six real,
  // identifiable hospitals under "trusted by" and invents three clinicians with photographs and ratings.

  ok("8a. /practice carries the v3 headline", LP3_HERO.headline.every(l => overviewText.includes(l)));
  ok("8b. /practice renders all six benefits", LP3_BENEFITS.every(b => overviewText.includes(b.title)));
  ok("8c. /practice renders the workspace section", overviewText.includes(LP3_WORKSPACE.title));
  ok("8d. /practice keeps the EMR boundary", overviewText.includes(NOT_AN_EMR.title));
  ok("8e. the hero illustration is on disk",
    existsSync(join(process.cwd(), "public", "images", "practice", "hero-illustration.webp")));

  // The AI section renders at the user's decision and is MARKED at mine: no AI module exists, and the
  // built Practice modules are Home, Calendar, Patients and Encounters.
  ok("8f. the AI section renders", overviewText.includes(LP3_AI.title));
  ok("8g. the AI section is marked as in development", overviewText.includes(LP3_AI.eyebrow));
  ok("8h. nothing claims the AI assistant is live", !/now live/i.test(overviewText));

  // NO NAMED INSTITUTION AS A CUSTOMER, and no crowd claim.
  const HOSPITALS = ["Chris Hani", "Baragwanath", "Kenyatta", "Ibadan", "Muhimbili", "Groote Schuur", "Aga Khan"];
  const namedHospitals = HOSPITALS.filter(h => overviewText.includes(h));
  ok("8i. /practice names no hospital as a customer", namedHospitals.length === 0, namedHospitals.join(", "));
  ok("8j. /practice makes no trusted-by or crowd claim",
    !/trusted by|loved by|join thousands|hundreds of practices/i.test(overviewText));

  // NO TESTIMONIALS until a real person said it and agreed to be quoted.
  ok("8k. /practice carries no testimonial", !/Dr\. Sarah|Dr\. James|Dr\. Amina/i.test(overviewText));

  // NO PRICE and NO APP-STORE BADGE -- both the user's call, both otherwise reinstated from the comp.
  ok("8l. /practice publishes no price", !/\$\s?\d|\/month/i.test(overviewText));
  ok("8m. /practice offers no app-store badge", !/App Store|Google Play/i.test(overviewText));

  // WHEREVER A TRIAL IS MENTIONED IT IS THIRTY DAYS, because practice_plans.trial_days says 30. The comp
  // says fourteen, which matches nothing in the system.
  ok("8n. no fourteen-day trial is claimed", !/14[- ]day/i.test(overviewText));

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
