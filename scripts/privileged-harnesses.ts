/**
 * The PRIVILEGED-LIVE acceptance harnesses — the 182 that CI can never run, and what happens to them.
 *
 * ⚠ WHY THIS FILE EXISTS. On 2026-08-27 two tables were found serving a real patient's diagnosis,
 * medication and follow-up to anyone holding the anon key. `scripts/anon-exposure-harness.ts` — the check
 * that finds exactly that — was already written, already correct, and had never been run. It is not in
 * ci-harnesses.ts because it CANNOT be: it needs the service-role key and the live database, and the
 * standing constraints forbid connecting authenticated CI to production Supabase.
 *
 * !! SO "PUT IT IN CI" WAS NEVER THE FIX, AND THE GAP WAS STRUCTURAL RATHER THAN AN OVERSIGHT.
 * scripts/harness-classify.ts tiers 230 harnesses: 48 `pure/local` and 182 `privileged-live`.
 * ci-harnesses.ts has an excellent coverage control — but it filters `tier === "pure/local"`, so it
 * guarantees only that those 48 are accounted for. NOTHING TRACKED THE OTHER 182 AT ALL. "Written,
 * correct, and unwired" was not an accident that happened once; it was the default state of 79% of this
 * estate's checks. This file is the missing half.
 *
 * ⚠⚠ 161 OF THE 182 WRITE TO THE DATABASE, AND .env.local POINTS AT PRODUCTION. A runner that fired all
 * 182 would run 154 inserts, 118 updates and 116 deletes against the live project. So the auto-run set is
 * not a list somebody curated and promised was read-only: SECURITY and TRIAGED are CHECKED against the
 * classifier on every run, and a harness that gains a single `.insert(` leaves the auto-run set by going
 * RED rather than by being remembered. It is checked a SECOND time against RAW_DML, because the
 * classifier's detector has a blind spot that this file's own EXCLUDED list documents.
 *
 * ⚠ AND RUNNING THE WHOLE ESTATE IS NOT MERELY SLOW, IT IS DISRUPTIVE. TESTING.md records the
 * measurement: 68 harnesses into a full sweep, Supabase Auth on the shared project began returning HTTP
 * 504 after 35–50 second timeouts — to the dev server, to plain fetch, and to the owner trying to sign
 * in. It reads exactly like an outage. That is why the default run is a SHORT security subset rather than
 * everything green, and why `--all` is a separate decision.
 *
 * ⚠ THE WRITING HARNESSES RUN AGAINST STAGING, NEVER HERE. `--staging` remaps the same three variables
 * scripts/dev-staging.mjs and scripts/smoke-staging.mjs already remap, so the harness and the guard agree
 * about which project is under test. The remap is SPAWN-TIME — no harness file is edited — and it rests
 * on one verified fact: `loadEnvConfig` does NOT overwrite an already-set variable. That was tested
 * directly before any of this was built, because if it were false, every harness spawned here would run
 * against production while this file printed the staging ref.
 *
 * ✔ STAGING IS AT FULL SCHEMA PARITY since 2026-08-28: the owner applied the eight catch-up migrations
 * (349, 350, 352, 353, 356, 357, 358, 360 — measured with migration-verify --staging, whose own head:true
 * defect had to be fixed first), and the paged registry now reads 671 of 671 tables, RLS on everywhere.
 * The gap's history matters because it masqueraded as product defects: both document harnesses broke on
 * getDocument selecting mig-357 COLUMNS, and one of those breaks printed a hard-coded detail string that
 * read as a clinical-integrity breach. After parity, both run green (65/65 and 56/56) — the amendment
 * protections pass on a real read.
 *
 *   npx tsx scripts/privileged-harnesses.ts              run the security subset (read-only)
 *   npx tsx scripts/privileged-harnesses.ts --all        also run the triaged non-security subset
 *   npx tsx scripts/privileged-harnesses.ts --staging    run the WRITING harnesses against staging
 *   npx tsx scripts/privileged-harnesses.ts --staging --only <substr>   one harness, output streamed
 *   npx tsx scripts/privileged-harnesses.ts --list       print every list and exit, running nothing
 *   npx tsx scripts/privileged-harnesses.ts --untriaged  print what has not been screened yet
 *
 * ⚠ `--staging` NOW TAKES ROUGHLY HALF AN HOUR, and that is not a fault. Four of its entries cost 250-475
 * SECONDS EACH: a round-trip from here is ~450ms to either project and these harnesses make many hundreds
 * of them sequentially. Nothing is hung. `--only` exists so one can be re-run alone with its output
 * streamed instead of captured, which is the shape this repository's own rule requires -- "a red harness
 * late in a sweep is not evidence until it is re-run alone."
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { PRODUCTION_READ_GO_ENV, assertSafeTarget, judgeTarget, productionReadDecision, refOf } from "./production-guard";

const ROOT = join(import.meta.dirname, "..");
loadEnvConfig(ROOT);

/**
 * `rawSql` is required on any entry whose SOURCE contains raw DML, and its value is the review that
 * found the DML harmless. See RAW_DML below for why the detector is deliberately over-sensitive.
 */
type Listed = { file: string; note: string; rawSql?: string };

/**
 * SECURITY — read-only, security-critical, and confirmed green against the live project. These answer
 * questions no static check can: what the anon key can actually read, which capabilities the database
 * actually grants, whether a real membership boundary actually refuses. Run these before a release and
 * after any migration that touches RLS, membership, capabilities or the plane boundary.
 */
const SECURITY: Listed[] = [
  { file: "anon-exposure-harness.ts", note: "what the PUBLIC anon key can actually read, across all 671 tables. The check that found two tables serving a real patient's diagnosis and medication. ~4 min -- it is the slow one, and it is the one that matters most." },
  { file: "api-membership-harness.ts", note: "CP-SPLIT-002 -- platform membership enforced at the API boundary, not merely in the UI. 14/14." },
  { file: "blanket-policy-harness.ts", note: "the latent tenant leak: a policy broad enough to admit another tenant's rows. 59 assertions." },
  { file: "enterprise-membership-harness.ts", note: "gate 3, plus the drift detector migration 286 promised by name. 31/31." },
  { file: "hq-nav-filter-harness.ts", note: "the capability-filtered HQ sidebar and search -- an unauthorised viewer must not be offered a destination, nor find one by typing its exact name. 35/35." },
  { file: "hww-access-harness.ts", note: "the HWW frontline read-scope filters -- what a nurse may read of other people's records." },
  { file: "identity-resolver-harness.ts", note: "COMP-IDENTITY-001 -- the read-side identity resolver. 12/12." },
  { file: "pd-capability-matrix-harness.ts", note: "the capability matrix AS IT EXISTS IN THE DATABASE, including maker-checker separation and the backfill class (a capability granted to nobody refuses everyone for ever). 11/11." },
  { file: "practice-api-plane-harness.ts", note: "Platform and Practice are separate products behind separate gates. 16/16." },
  {
    file: "practice-auth-guard-harness.ts",
    note: "the three doors to super_admin on public.profiles, watched from the deployed app. 92 assertions.",
    rawSql: "REVIEWED 2026-08-27 -- the `INSERT into` matches are a section title, a comment about migration 250, "
      + "and the assertion `every INSERT into profiles in src/ runs on a service-role client`. It reads SOURCE "
      + "for those strings; it does not execute them.",
  },
  { file: "public-disclosure-harness.ts", note: "WEB-HOME-001 -- what the public surface may disclose. 212 assertions." },
  { file: "library-scope-harness.ts", note: "clinical library search scope (migrations 167, 169, 186) -- 11 passed, 6 honestly reported as not assertable on current data." },
];

/**
 * TRIAGED — read-only and confirmed green, but not a security boundary. Kept out of the default run so
 * the security subset stays short enough that somebody actually runs it.
 */
const TRIAGED: Listed[] = [
  { file: "estate-hygiene-harness.ts", note: "does the live estate contain anything that is not a real practice. 3/3." },
  { file: "framework-currency-harness.ts", note: "XWI P2-10b -- competency framework currency. 10 assertions." },
  {
    file: "gov-evidence-harness.ts",
    note: "CPR-PD-010 -- the three evidence gates. 27/27.",
    rawSql: "REVIEWED 2026-08-27 -- both matches are regex assertions OVER MIGRATION TEXT "
      + "(`!/insert into gov_risk_methodology/.test(sql)`). The file makes no query call at all.",
  },
  { file: "mission-profile-harness.ts", note: "PLAT-GOV-001 product lines and mission-control composition. 43/43." },
  { file: "practice-content-harness.ts", note: "the Practice public section, CPR-V2-000..020. 126 assertions." },
  { file: "qie-hub-harness.ts", note: "QIE-000 -- does the hub tell the truth about its own engines. 36/36." },
  { file: "ssw-reference-harness.ts", note: "does the SSW reference inventory promise what the search delivers. 39/39." },
];

/**
 * EXCLUDED — screened and deliberately not run from here, each with the reason. Printed on every run, the
 * same discipline as ci-harnesses.ts: an exclusion nobody sees is indistinguishable from a harness nobody
 * wrote. Remove an entry the moment its reason stops being true.
 */
const EXCLUDED: Listed[] = [

  // -- The 2026-08-28 sweep's solo-confirmed reds, each with its verdict. Every one reproduced ALONE. --

  // -- The final 11 solo verdicts, closing the sweep 2026-08-28. Screening of all 161 is COMPLETE. --
  {
    file: "cgr-suggest-harness.ts",
    note:
      "CALLS THE SHIPPED AI ENGINE, so every run costs money and returns something slightly different. Its "
      + "own header calls it a one-off. A non-deterministic check in a routine runner trains people to "
      + "ignore the runner. Needs ANTHROPIC_API_KEY, which a green run here would silently depend on.",
  },
];

/**
 * STAGING — the harnesses that WRITE, run against the staging project with the environment remapped.
 *
 * ⚠ THESE NEVER RUN AGAINST PRODUCTION, AND THAT IS ENFORCED THREE TIMES: `--staging` is required to run
 * any of them, the three STAGING_* variables must be present, and assertSafeTarget refuses a URL that
 * resolves to the production ref or to no identifiable project at all.
 *
 * The remap is the one scripts/dev-staging.mjs and scripts/smoke-staging.mjs already use — the same three
 * variables, so the harness, the guard and the server all agree about which project is under test. It is
 * spawn-time only: nothing here edits a harness, and `loadEnvConfig` was verified not to overwrite an
 * already-set variable, which is the fact the whole approach rests on.
 */
const STAGING: Listed[] = [
  {
    file: "cascade-immutability-ratchet-harness.ts",
    note:
      "CPR-DEL-001 s10 -- the cascade-vs-immutability ratchet, proved by creating a real workspace and "
      + "trying to delete its append-only trail. "
      + "⚠ IT IS ALREADY STAGING-ONLY AND ALWAYS WAS: it connects to STAGING_DB_URL over raw `pg` and "
      + "REFUSES unless that connection's project ref matches STAGING_SUPABASE_URL, so it cannot reach "
      + "production even if the remap were wrong. It needs no remap; it is listed here because this is "
      + "where a writing harness belongs. "
      + "!! IT IS ALSO WHY RAW_DML EXISTS: harness-classify reports mutates:false for it -- the flag "
      + "detects `.insert(` METHOD CALLS and this file writes `await c.query(\"insert into ...\")` -- so it "
      + "screened GREEN and, on the classifier's evidence alone, would have joined the production-pointed "
      + "security set.",
  },

  // ── Screened against staging 2026-08-27, exit 0 with a real assertion count ──────────────────────
  // 46 of the 161 writing harnesses were screened; these 27 passed. Counts are from that run, recorded
  // so a later collapse toward zero is visible rather than merely still-green.
  { file: "cpl-catalogue-harness.ts", note: "the CPL catalogue. 64 assertions." },
  { file: "gov-controls-harness.ts", note: "governance controls. 20/20." },
  { file: "gov-decisions-harness.ts", note: "governance decisions. 20/20." },
  { file: "gov-evidence-audit-harness.ts", note: "the governance evidence audit. 20/20." },
  { file: "gov-exceptions-harness.ts", note: "governance exceptions. 17/17." },
  { file: "gov-hq-escalation-harness.ts", note: "HQ escalation paths. 21/21." },
  { file: "gov-obligations-harness.ts", note: "regulatory obligations. 19/19." },
  { file: "gov-psc-harness.ts", note: "the patient safety committee surface. 19/19." },
  { file: "gov-reviews-harness.ts", note: "governance reviews. 17/17." },
  { file: "gov-risk-register-harness.ts", note: "the risk register. 22/22." },
  { file: "gov-triggers-harness.ts", note: "governance triggers. 20/20." },
  { file: "hq-appointment-harness.ts", note: "HQ office appointments -- one live appointment decides authorization. 26/26." },
  { file: "hww-assessments-harness.ts", note: "HWW assessments. Reports `ALL PASS -- n pass / 0 fail`." },
  { file: "hww-assignment-harness.ts", note: "HWW assignment. Reports `ALL PASS`." },
  { file: "hww-concerns-harness.ts", note: "HWW concerns. Reports `ALL PASS`." },
  { file: "hww-instruments-harness.ts", note: "HWW instruments. Reports `ALL PASS`." },
  { file: "hww-medications-harness.ts", note: "HWW medications. Reports `ALL PASS`." },
  { file: "hww-navigation-harness.ts", note: "HWW navigation. Reports `ALL PASS`." },
  {
    file: "individual-acceptance-harness.ts",
    note: "COMPETEN-IND-003 s5 acceptance for Competen Individual (ADR-016): both experiences, one experience, "
      + "direct Professional, DB-clock liveness, graduation, primary fallback, no cross-product state, own-row RLS. "
      + "Creates and deletes its own harness-ind003-* identities. Refuses production via assertSafeTarget, and "
      + "reports PEND (exit 0, nothing created) until migration 370 is applied.",
  },
  {
    file: "individual-commerce-staging-harness.ts",
    note: "P1 Commercial: migrations 399/400 at library level -- post-state (capability held by no position, "
      + "individual_commerce absent), plan CHECKs, the composite plan keys, one delivery row per event, the Individual "
      + "settlement adapter (purchase membership, appended paid period, renewal start, D8) and AI fair use off while "
      + "commerce is off. Never writes either flag. Own harness-p1c-* identities and zz_p1c_* plans, deleted after. "
      + "PEND (exit 0, nothing created) until 399 is applied.",
  },
  {
    file: "scholar-join-harness.ts",
    note: "COMPETEN-SCHOLAR-JOIN-01 Stage 1 over HTTP: registration (one identity, no estate role), email verification "
      + "(the confirmation token followed; mailbox delivery PEND), the 18+ declaration and governed context refused then "
      + "accepted, activation on the declared basis, welcome -> terms -> Upload, context history (402) and the J1 path for "
      + "an existing member. Needs a staging-pointed dev server at BASE_URL with individual_app ON; never writes that flag. "
      + "Turns individual_self_registration ON for the run and restores it, and restores the two policy rows it sets. "
      + "Own harness-join-* identities. PEND (exit 0, nothing created) until 402/403 are applied.",
  },
  {
    file: "scholar-intelligence-harness.ts",
    note: "COMPETEN-SCHOLAR-01 S5 over HTTP: the four Learning Intelligence measures (not measured, too little practice, measured "
      + "separately), coverage Not measured until S1/S2, the review log (391) and revision in the Passport as a count. Needs a "
      + "staging-pointed dev server at BASE_URL with individual_app ON; never writes the flag. Own harness-s5-* fixtures.",
  },
  {
    file: "individual-access-harness.ts",
    note: "COMPETEN-IND-ACCESS-001 s6 over HTTP: the public doors, the one login with the destination preserved, "
      + "first-entry welcome, primary and switching, expired/revoked/ended, uninvited guidance, deep links, and the HQ "
      + "pilot grant through its API (self, 18+, past end date, no capability). Needs a staging-pointed dev server at "
      + "BASE_URL with individual_app ON; NEVER writes the flag (PEND when off). Own harness-access001-* fixtures.",
  },
  {
    file: "competency-foundation-acceptance-harness.ts",
    note: "COMPETEN-SCHOLAR-01 S1 against migration 384: the schema refuses a profession catalogue without a profession, a "
      + "foundational one with a profession, an unknown layer and non-list outcomes; with no allowlist Scholar and Professional "
      + "are offered nothing; the staging seed (CF-FOUND, NUR-RESP) has its layers, profession, Core Nursing extension, CPUs and "
      + "Holdings links; the read API over the allowlisted seed (draft offers nothing). Restores both allowlists exactly. PEND until 384.",
  },
  {
    file: "controlled-catalogue-acceptance-harness.ts",
    note: "P0 controlled catalogues against migration 394 and the CFCA mirror: the mirror holds the committed export by id; the 394 "
      + "guard refuses a hospital catalogue, a hospital competency and an unknown status, freezes entries once published, and keeps "
      + "the cascade path; the read API offers exactly what a fixture catalogue names with home, practice, CPU and content status; "
      + "SCH-RESPCARD names only production records, all unreviewed, in no allowlist. Writes and removes its own fixtures. PEND until 394.",
  },
  {
    file: "ai-fair-use-acceptance-harness.ts",
    note: "AI-FAIR-USE-01 against migration 410's database functions: one engine with independent product policies; 20 concurrent "
      + "reservations cannot overspend; a retried id holds once; failure before billing releases free, double settle refused; a "
      + "price change does not re-price; levels follow the balance; the reserve's hard cap; a new period opens at zero; a signed-in "
      + "person cannot read, write or call it; policies published through the audited engine. Never calls a provider or flips the "
      + "ai_fair_use flag. Creates and removes one throwaway account. PEND until 410 and the provisional seed.",
  },
  {
    file: "clinical-review-acceptance-harness.ts",
    note: "Owner D2, migration 395, against the real triggers: hash and snapshot are the database's; the author cannot approve; a "
      + "suspended or borrowed appointment and an out-of-scope reviewer are refused; a material edit makes approval stale; two-approval "
      + "content; rejection, one decision per reviewer, append-only; the catalogue read shows approved only for approved content. "
      + "Creates and removes four throwaway accounts, their reviewer appointments to an existing HQ office, and one draft framework. PEND until 395.",
  },
  {
    file: "case-intelligence-acceptance-harness.ts",
    note: "COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s14, migrations 422-423, the owner journey: candidacy on the current text only; a "
      + "clean offer eligible, an identifiable or unchecked one ineligible with no content kept; the 24-hour queue lists only eligible "
      + "offers, names no student and spends no AI; take, promote, edit, submit through 395; an author cannot approve; nothing publishes "
      + "before an independent scoped reviewer approves; another student works through it deterministically with no AI; revocation keeps "
      + "only the promoted case; case intelligence counts it. Creates and removes five throwaway accounts and their HQ appointments. "
      + "One retired fixture case (CASE-HARNESS-<stamp>) stays as the record by design. PEND until 423.",
  },
  {
    file: "learning-acceptance-harness.ts",
    note: "COMPETEN-LEARNING-01, migrations 460-464, the two s21 journeys at library level: a hosted ECG course built and CFCA-mapped in "
      + "the studio, approved by an independent scoped reviewer and published by someone else; certificate issuance and price approval "
      + "refused to the author; paid access refused until a verified course purchase (LEARNING_SETTLEMENT.onPaid, no provider call) "
      + "opens ONE course entitlement, idempotently, with no experience granted; lessons and a deterministic check complete the record; "
      + "Professional and the Passport read it by reference with nothing copied; certificates verify; history outlives the entitlement; "
      + "an external listing approved on the listing route only, completed self-declared and source-linked, never verified; no AI call. "
      + "Turns learning_app ON for its run and restores it; never writes learning_commerce. Creates and removes seven throwaway "
      + "accounts and their HQ appointments. Fixture providers and offerings (LRN-HARNESS-*) stay retired by design. PEND until 464.",
  },
  {
    file: "hq-users-directory-acceptance-harness.ts",
    note: "HQ-USERS-C: the directory loader against real staging rows (platform membership, Individual membership and a "
      + "live Professional entitlement, an HQ appointment), every source readable, a stranger with nothing; and over HTTP "
      + "a platform_director viewer finds the subject with the product and HQ filters, no record content in the payload, "
      + "and a stranger gets no directory. ⚠ NEEDS BASE_URL naming a STAGING-pointed dev server for the H group. Creates "
      + "and deletes harness-usersc-* identities and their rows.",
  },
  {
    file: "hq-users-reset-acceptance-harness.ts",
    note: "HQ-USERS-B against migration 379, over HTTP: a stranger is refused, the old owner-only reset is no second door, "
      + "self-reset is refused by name, verified/unverified/suspended/unknown targets all get the same neutral answer with "
      + "the true reason audited and no address or link anywhere, and the 3-per-person / 20-per-administrator hourly limits "
      + "hold (seeded audit rows, DB clock). The email itself and the owner-account rule are PEND. ⚠ NEEDS BASE_URL naming a "
      + "STAGING-pointed dev server. Creates and deletes harness-usersb-* identities. PEND until 379 is applied.",
  },
  {
    file: "hq-users-authority-acceptance-harness.ts",
    note: "HQ-USERS-A: over HTTP, a platform_director appointee (hq.platform.users.view) reads the users directory and its "
      + "page with no write controls, every owner-only write (reset, suspend, role change, create, delete) is 403 and changes "
      + "nothing, and an unappointed person is refused the directory. The owner path is PEND (needs a synthetic super admin). "
      + "⚠ NEEDS BASE_URL naming a STAGING-pointed dev server, else PEND. Creates and deletes harness-usersa-* identities.",
  },
  {
    file: "individual-professional-acceptance-harness.ts",
    note: "COMPETEN-IND-007 acceptance for Competen Professional: direct entry with no Scholar row, the whole journey, "
      + "schema-generated evidence classes, cross-person links refused, own-row RLS, once-only reminders, share carries own "
      + "records only for a Professional link, shared frameworks only, no estate rows. Creates and deletes its own "
      + "harness-ind007-* identities. Refuses production via assertSafeTarget, and reports PEND until migration 373 is applied.",
  },
  {
    file: "professional-profile-acceptance-harness.ts",
    note: "COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, owner GO s10: an existing Scholar user adds Professional on one identity, "
      + "a new invited Professional-only user registers (required facts, optional skipped, enter), the profile enriched later, "
      + "versioned records and context history kept, verification states, Scholar history and Passport unchanged, no catalogue, "
      + "configuration controls the form, own-row RLS and no cross-person writes. Writes the two registration policy rows and "
      + "restores them exactly. Own harness-prof01-* identities, deleted after. Never writes individual_app. PEND until 450 is applied.",
  },
  {
    file: "professional-profile-b-acceptance-harness.ts",
    note: "COMPETEN-PROFESSIONAL-PROFILE-01 part B (451-453): verification needs an appointed, independent verifier and a request "
      + "first, enforced by the database; history append-only; a new version starts unverified; configurable reminders send once at "
      + "the tightest offset and release failed claims; selective sharing carries only ticked current versions with their exact "
      + "states. Fixtures: harness-prof01b-* identities and one staging verifier appointment, deleted after; three policy rows and "
      + "individual_app restored exactly; no real email (injected sender). PEND until 451-453 are applied.",
  },
  {
    file: "professional-needs-acceptance-harness.ts",
    note: "COMPETEN-PROFESSIONAL-NEEDS-01 Stage 2 (470), owner GO s14 for an illustrative paediatric nurse: a need saved with only its "
      + "description, a private reflection and a need from it, CFCA links with version, learning discovery, suggestions accepted, "
      + "dismissed and deferred, priority and free stages, goals many to many, history kept, the reflection never shared, no "
      + "catalogue, no AI. Own harness-prof02-* identity, deleted after; two policy rows restored exactly. PEND until 470 is applied.",
  },
  {
    file: "professional-passport-acceptance-harness.ts",
    note: "COMPETEN-PROFESSIONAL-PASSPORT-01 Stage 7 (540), owner GO s15: one Individual with Scholar then Professional history; the shared "
      + "Passport; a view chosen record by record, previewed as a closed draft, activated once, time-limited; unrelated records excluded; "
      + "provenance, validity and meaning on every record; nothing self-reported shown as verified; revocation refuses the hosted view; "
      + "sources untouched; no AI needed; an organisation link carries none of the personal Passport. /verify over HTTP with VERIFY_BASE_URL. "
      + "Items 6 and 7 bounded (530, 510/511 not on main). Own harness-prof07-* identity and Scholar material, deleted after; one policy row restored.",
  },
  {
    file: "professional-competency-acceptance-harness.ts",
    note: "COMPETEN-PROFESSIONAL-COMPETENCY-01 Stage 5 (520), owner GO s15 items 1-16: My Competencies, a published competency explored with its "
      + "outcomes and expected proficiency, a self-assessment (self-reported) with confidence and a private reflection, CPD and an observation "
      + "mapped to outcomes without duplication, a need and a goal from the competency, reassessment with history kept, no catalogue, no AI, "
      + "a Passport link carrying chosen parts, nothing private shared. Own harness-prof05-* identity, deleted after; three policy rows restored exactly. PEND until 520 is applied.",
  },
  {
    file: "professional-c5-wiring-acceptance-harness.ts",
    note: "COMPETEN-PROFESSIONAL-COMPETENCY-01, the person side of the C5 Studio (#128), over HTTP with BASE_URL: methods offered, "
      + "a request with the chosen method and linked evidence, further evidence never resent, another person's request refused, "
      + "withdrawal recorded, a revoked verified decision never current. Own harness-prof05-c5wire identity, deleted after with its requests.",
  },
  {
    file: "professional-plan-acceptance-harness.ts",
    note: "COMPETEN-PROFESSIONAL-PLAN-01 Stage 3 (480), owner GO s15, the ECG Interpretation goal: created from a need and directly, "
      + "saved with only a description, CFCA outcomes with version, catalogue and external learning added with no enrolment, study and "
      + "mentorship ordered with a dependency, milestones and review dates with reminders, CPD referenced (completed only with the record, "
      + "one activity serving two goals), review and evidence, revision with history, addressed without verification, reopen and defer, "
      + "no catalogue, no AI, nothing shared. Own harness-prof03-* identity, deleted after; three policy rows restored exactly. PEND until 480 is applied.",
  },
  {
    file: "professional-evaluation-acceptance-harness.ts",
    note: "COMPETEN-PROFESSIONAL-EVALUATION-01 Stage 6 (530), owner GO s14, the ECG Interpretation goal: six separate findings with cited, "
      + "provenanced sources, strengths and limitations, recommendations followed to their owning module (an activity through Stage 3), "
      + "immutable snapshots and notes, a later evaluation leaving the first unchanged, comparison, a C5 decision read never written (an "
      + "in-process stand-in Studio where C5 is absent), no catalogue, no AI, private unless ticked, no claim of verified competence. "
      + "Own harness-prof06-* identity, deleted after; two policy rows restored exactly. PEND until 530 is applied.",
  },
  {
    file: "account-profile-acceptance-harness.ts",
    note: "My profile (owner GO 2026-10-23, PR D): a real anon-key user session updates its own personal fields and "
      + "is refused every authority column and the email (column grants plus RLS WITH CHECK profile_authority_unchanged), "
      + "cannot update another row, sets 380's given/family names (PEND until 380 is applied), and an email change is "
      + "pending with profiles.email untouched. Creates and deletes its own harness-acct-* identities. Writes no flag.",
  },
  {
    file: "individual-config-acceptance-harness.ts",
    note: "COMPETEN-CONFIG-002 acceptance for the Competen Individual policy against migration 376: the resolver grant, then "
      + "over HTTP with real session cookies 401 with no session, 403 for a non-holder, 422 past every hard limit and on "
      + "individual_app, draft not effective until published, exact scoped rollback, the WCE audit trail, and the reader "
      + "clamping a hand-written value. ⚠ THE HTTP GROUPS NEED BASE_URL naming a STAGING-pointed dev server (no default), "
      + "or they print PEND and the run is not acceptance. Creates and deletes its own harness-cfg002-* identities and its "
      + "appointment, restores the Individual WCE partition to its pre-run rows, never touches individual_app. PEND (exit 0, "
      + "nothing created) until 376 is applied.",
  },
  {
    file: "email-sync-acceptance-harness.ts",
    note: "Migration 381 (owner GO 2026-10-23, item 4): a CONFIRMED Auth email change is copied into profiles.email with one "
      + "audit_log row (actor auth), an UNCONFIRMED one is not, and an update that leaves the email alone copies nothing. "
      + "Creates and deletes its own harness-esync-* identities. PEND (exit 0) until 381 is applied. Writes no flag.",
  },
  {
    file: "scholar-acceptance-harness.ts",
    note: "COMPETEN-IND-004 Scholar learning journey against migration 372: consent, real PDF and DOCX upload with the "
      + "anon key, FTS retrieval, questions, SM-2 cards, progress, cross-user isolation (store, RLS, storage, "
      + "composite keys), AI through the gateway when configured, D1, erasure. Creates and deletes its own "
      + "harness-ind004-* identities, turns individual_app ON and restores it. PEND (exit 0) until 372 is applied.",
  },
  {
    file: "scholar-passport-acceptance-harness.ts",
    note: "COMPETEN-IND-004 s11 Scholar Passport achievements against migration 375: nothing shown by default, opt-in per "
      + "earned item, independent removal, study history unchanged, no notes/answers/AI, distinct labels, cross-user "
      + "isolation (store, RLS, composite key), and removal reaching the SAME live /verify link (over HTTP when "
      + "VERIFY_BASE_URL names a running server). Creates and deletes its own harness-ind004p-* identities, turns "
      + "individual_app ON and restores the prior row. PEND (exit 0, nothing created) until 375 is applied. 32/32 on staging.",
  },
  {
    file: "scholar-competency-acceptance-harness.ts",
    note: "COMPETEN-SCHOLAR-01 S2-S4 against migrations 384/387/388/389 and the S1 seed: nothing offered with an empty "
      + "Scholar allowlist, programmes as configuration (a second profession and a non-allowlisted catalogue), real PDF "
      + "upload, AI concepts and PROPOSED mappings only to offered competencies (foundational and nursing), append-only "
      + "accept/reject/own links with the trigger refusing UPDATE and DELETE, isolation (store, RLS, composite keys), "
      + "explain modes, competency-tagged questions, a multi-step case, progress by competency, erasure cascading through "
      + "the trail. Needs an AI provider. Never changes a Scholar allowlist that is set (shared viewing config); adds one only where none exists and removes it only while unchanged; creates and "
      + "deletes its own harness-s2-* identities and programmes; never touches individual_app. PEND (exit 0, nothing "
      + "created) until 388 is applied and the seed is published.",
  },
  {
    file: "scholar-upload-harness.ts",
    note: "COMPETEN-SCHOLAR-UPLOAD Stage 2 over HTTP: Welcome (Upload my notes) to the upload panel stating the POLICY's "
      + "formats and size; a real PDF through the browser path; refusals (attestation, size, photo/no OCR, a format the "
      + "policy has off, an NHS-number shape with its object removed); audit; plain text where 405 and the policy allow "
      + "it (else PEND); the material page with sections, original download and its educational-context stamp; topic "
      + "finding with clinical-status labels; an explanation and questions from the upload; isolation (404 for another "
      + "student); erasure. Needs BASE_URL naming a STAGING-pointed dev server with the legal versions and an AI "
      + "provider. Reads shared config only (never individual_app, the allowlist or the policy). Creates and deletes its "
      + "own harness-upload-* identities.",
  },
  {
    file: "scholar-clinical01-harness.ts",
    note: "COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (Stage 5A) over HTTP, IND-004's steps of the owner's 19-step journey: a "
      + "private respiratory case written from the notes and checked (private formative, linear) -> CFCA links -> a "
      + "progressive scenario with nothing ahead -> findings asked for -> decisions to the end with feedback and the "
      + "debrief -> resume, decisions append-only -> back to Teach Me/Revision -> stored cases playable with the quota "
      + "used up (synthetic rows for the fixture only) -> no catalogue -> isolation -> erase-all. Library reuse and "
      + "offering a case need the case_library flag (PEND when off); the Individual budget needs metering ON (PEND). "
      + "Real AI. Needs BASE_URL naming a STAGING-pointed dev server with the legal versions and URLs, an AI provider "
      + "and 435/436. Reads shared config only. Creates and deletes its own harness-clinical01-* identities.",
  },
  {
    file: "scholar-progress01-harness.ts",
    note: "COMPETEN-SCHOLAR-PROGRESS-01 (Progress, Stage 8 of 8) over HTTP, the owner's first acceptance journey (steps "
      + "1-15) on the respiratory materials: upload and classify -> Teach Me, Revision, a clinical case -> an evaluation -> "
      + "Progress, next steps first -> separate indicators (engagement and coverage labelled, never understanding) -> the "
      + "evidence behind them -> CFCA exploration -> a reinforcement step followed with its context -> development over "
      + "time (new evidence apart from practice) -> three Passport tiers (427) -> history across a context change -> no "
      + "catalogue -> available with the quota used up (synthetic rows, fixture only) -> never verified competence -> "
      + "isolation -> erase-all. Real AI. Needs 426 (PEND without; step 11 needs 427) and BASE_URL naming a STAGING-pointed "
      + "dev server. Own harness-prog01-* identities.",
  },
  {
    file: "scholar-evaluation01-harness.ts",
    note: "COMPETEN-SCHOLAR-EVALUATION-01 (Stage 6) over HTTP, the owner's first acceptance journey (steps 1-15) on the "
      + "respiratory materials: learning, revision and a clinical case -> existing evidence retrieved and interpreted "
      + "continuously (no AI) -> a Respiratory Assessment evaluation kept as a record -> six dimensions apart -> a fresh "
      + "knowledge check (Mock), deterministic marking without AI, free text by an eligible model or held -> confidence "
      + "and limitations -> CFCA outcomes where linked -> recommendations to Teach Me, Revision, Clinical Reasoning -> "
      + "history preserved (supersedes; a rewrite refused) -> available with the quota used up (synthetic rows, fixture "
      + "only) -> no catalogue -> never verified competence -> isolation -> erase-all. Real AI. Needs 426 (PEND without) "
      + "and BASE_URL naming a STAGING-pointed dev server. Own harness-eval01-* identities.",
  },
  {
    file: "scholar-revision-hold-harness.ts",
    note: "COMPETEN-SCHOLAR-REVISION-01 R4 owner decision (hold self-grading until the end), the focused live check of "
      + "that change over HTTP: in Mock and end-of-session feedback an unmarkable short answer is held unmarked (425) "
      + "and reveals nothing, cannot be graded or re-answered early, survives a resume, is offered for self-grading "
      + "at the end with the accepted answers, explanation and source, and is graded as the answer written "
      + "(self_graded, once); immediate feedback unchanged; erase-all. The Individual quota is used up for the "
      + "fixture only (synthetic rows) so AI evaluation is not available. Real AI writes the questions. Needs 425 "
      + "(PEND without) and BASE_URL naming a STAGING-pointed dev server. Own harness-revhold-* identities.",
  },
  {
    file: "scholar-journey-harness.ts",
    note: "Scholar Stages 4 and 5 final acceptance, the ONE integrated journey (owner GO 2026-10-25): one student "
      + "Upload -> Teach Me -> Revision -> Clinical Case -> Feedback -> Learning History, connecting what learn01, "
      + "revision01 and clinical01 prove apart: source references intact, work and progress kept, CFCA where linked, "
      + "no-catalogue learning, the Individual quota enforced (synthetic rows for the fixture only) with stored "
      + "learning carrying on without AI, private isolation, and the library/publication boundary with case_library "
      + "OFF. Metering OFF (PEND when ON). Real AI. Needs BASE_URL naming a STAGING-pointed dev server with the legal "
      + "versions and URLs and an AI provider. Reads shared config only. Creates and deletes its own harness-journey-* identities.",
  },
  {
    file: "scholar-revision01-harness.ts",
    note: "COMPETEN-SCHOLAR-REVISION-01 over HTTP, the owner's first Stage 4 journey on the respiratory materials: open "
      + "Revision -> the respiratory materials -> ten questions in several formats (reuse first, the shortfall written, "
      + "private formative, competency-linked where the section is) -> answers with feedback that says how they were "
      + "marked -> quotes found in the student's own sections -> resume the same session -> Weak areas and the "
      + "difficult concepts -> Teach Me with the way back -> flashcards and SM-2 with the 391 log -> recall history "
      + "and progress -> a saved set replayed with no AI -> mock practice holding feedback -> a short answer never "
      + "wrong by default -> continuity with the quota used up (synthetic usage rows for the fixture only) -> no "
      + "catalogue -> isolation -> erase-all. Real AI. Needs BASE_URL naming a STAGING-pointed dev server with the "
      + "legal versions and URLs, an AI provider and 416/417 (else PEND). Reads shared config only. Creates and "
      + "deletes its own harness-revision01-* identities. The metering-ON variant of R13 is PEND unless metering is on.",
  },
  {
    file: "scholar-learn01-harness.ts",
    note: "COMPETEN-SCHOLAR-LEARN-01 over HTTP, the owner's first acceptance journey on the Stage 2 respiratory materials: "
      + "several documents -> Teach Me -> a cited explanation -> Simplify -> a follow-up (Ask) -> a related concept "
      + "across the library -> an informal check -> a clarification with a verdict -> continue -> leave and resume -> "
      + "source references -> learning activity against the CFCA (labelled not competence); the same without a "
      + "catalogue; Start learning opens Teach Me; history structure-only and pruned with a deleted material; "
      + "isolation; erase-all. Real AI, no mocks. Needs BASE_URL naming a STAGING-pointed dev server with the legal "
      + "versions AND URLs, an AI provider and 414 (else PEND). Reads shared config only. Creates and deletes its own "
      + "harness-learn01-* identities.",
  },
  {
    file: "scholar-upload01-harness.ts",
    note: "COMPETEN-SCHOLAR-UPLOAD-01 over HTTP, the owner's three-resource scenario: a respiratory anatomy PDF with a "
      + "scanned (empty) page, a pneumonia PowerPoint with speaker notes and oxygen therapy Word notes in one session; "
      + "duplicate, macro and zip-bomb refusals with their objects removed; read quality (partial, never a clean "
      + "success); 'Your notes are ready' ending in the EXISTING material page; AI suggestions with catalogue version "
      + "and verified learning outcomes; student links naming an outcome; questions across documents, chosen documents "
      + "and a competency; rename, collections and topic correction; isolation for each new route; erase-all leaving "
      + "nothing. Needs BASE_URL naming a STAGING-pointed dev server with the legal versions AND URLs, an AI provider, "
      + "406-409 and pptx in the policy (else PEND). Reads shared config only, EXCEPT R1 (SCHOLAR_R1_ZZ=1): it creates "
      + "and removes a synthetic catalogue-less programme row, so that section runs only when the owner asks. Creates "
      + "and deletes its own harness-upl01-* identities.",
  },
  { file: "mos-phase1-harness.ts", note: "CPR-CORE-MOS-001 phase 1. 20/20." },
  { file: "mos-phase2-harness.ts", note: "MOS phase 2. 25/25." },
  { file: "mos-phase3-harness.ts", note: "MOS phase 3. 73/73." },
  { file: "mos-phase4-harness.ts", note: "MOS phase 4. 22/22." },
  { file: "mos-support-records-harness.ts", note: "MOS support records. 29/29." },
  { file: "practice-activity-harness.ts", note: "the practice activity spine. 91/91." },
  { file: "practice-ask-harness.ts", note: "Practice Ask. 23/23." },
  { file: "practice-booking-link-harness.ts", note: "public booking links. 34/34." },
  { file: "practice-booking-sections-harness.ts", note: "booking sections. 111/111." },

  // ⚠ THE FOUR THAT WERE RECORDED AS HANGS AND WERE WORKING ALL ALONG. Each exceeded the screener's old
  // fixed 240s ceiling and was written down as a hang. practice-billing beat it by NINE SECONDS. Their
  // real cost is a few hundred sequential round-trips at ~450ms each, which is the same on either
  // project -- staging's median is 489ms against production's 449ms. Timings recorded so a genuine hang
  // is later distinguishable from a harness that was always this long.
  { file: "practice-audit-harness.ts", note: "the practice audit trail. 48/48 in 297s." },
  { file: "practice-availability-config-harness.ts", note: "availability configuration. 81/81 in 341s." },
  { file: "practice-billing-harness.ts", note: "practice billing. 77/77 in 249s -- nine seconds over the old ceiling." },
  { file: "practice-booking-rules-harness.ts", note: "CPR-V5-007 phase 3, the booking rules engine (migration 244). 133/133 in 473s -- the longest in the estate so far." },
  {
    file: "governance-context-harness.ts",
    note:
      "PLAT-GOV-001 -- exactly one active appointment decides authorization. 20/20, 1 skipped. "
      + "⚠ IT WAS RED ON A PIN, NOT A DEFECT: S2 required the /super-admin door's capability line "
      + "character-for-character, and the layout had been refactored to resolve into a named binding so "
      + "it could reuse positions and positionNames from the SAME call (205 HQ pages, one resolution). "
      + "Repointed to the property -- the call is made with real arguments, capabilities come from it, "
      + "nothing narrows them, the owner branch is empty -- plus S2-control, because the exactness was "
      + "guarding a real `.slice(0, 0)` break that a prefix match once let through.",
  },

  // ── ⚠ UNBLOCKED BY scripts/provision-staging-estate-fixture.ts, 2026-08-27 ───────────────────────
  //
  // All nine failed on a MISSING PREREQUISITE rather than on the thing they check, and every one refused
  // rather than passing over an empty estate -- which is the only reason the cause was legible. One root:
  // STAGING HAD NO PEOPLE. No super_admin, no platform_membership, no organisational unit, no tenant, no
  // patient, no assignment. One provisioner turned all nine green.
  //
  // !! SIX WERE THE TARGET AND THREE WERE NOT. hww-census, learning-provenance and decision-immutability
  // were sitting in UNTRIAGED with unrelated-looking symptoms (a NOT NULL violation, a null id, an empty
  // failure line) and turned out to share the same absence. A fixture gap does not announce itself as one.
  { file: "identity-join-harness.ts", note: "COMP-IDENTITY-001 join layer. 29/29 (was 22/1 -- needed an organisational unit)." },
  { file: "platform-flag-gate-harness.ts", note: "tenant/country/plan flag scoping. 26/26 (was 19/1, then 25/1 -- the tenant alone was not enough, check 8 also wants tenants.primary_country and an active plat_subscriptions row)." },
  { file: "hq-guard-harness.ts", note: "the HQ estate guard. 68/68 on staging -- IDENTICAL to its production run, which is the strongest evidence the estate fixture is faithful. (was 67/1: P2 is an owner control and staging had no super_admin.)" },
  { file: "platform-membership-harness.ts", note: "CP-SPLIT-002 gate 1. 62/62 (was 59/3 -- no owners, no active memberships)." },
  { file: "hww-evidence-harness.ts", note: "the HWW evidence bridge. 14/14 (was bailing on `No active assignment`, under a libuv exit crash that hid the message)." },
  { file: "hww-gaps-harness.ts", note: "the HWW gap batch. 13/13 (same absence, same buried message)." },
  { file: "hww-census-harness.ts", note: "the HWW census. 24/24 (was `Seed failed: null value in column hospital_id of relation op_patients`)." },
  { file: "learning-provenance-harness.ts", note: "learning provenance. 7 assertions (was `HARNESS ERROR: Cannot read properties of null (reading 'id')`)." },
  { file: "decision-immutability-harness.ts", note: "decision immutability. 10 assertions (was failing with an empty reason line)." },

  // ── Screened against staging 2026-08-27, offsets 0-29: 27 of 30 green ───────────────────────────
  { file: "hww-sidebar-harness.ts", note: "the HWW sidebar. 24 assertions." },
  { file: "practice-appointment-notice-harness.ts", note: "appointment notices. 32/32." },
  { file: "practice-assistant-harness.ts", note: "the practice assistant. 51/51." },
  { file: "practice-brief-harness.ts", note: "the practice brief. 20/20." },
  { file: "practice-calendar-harness.ts", note: "the calendar. 31/31." },
  { file: "practice-capability-harness.ts", note: "practice capabilities. 146/146." },
  { file: "practice-case-memory-harness.ts", note: "case memory. 50/50." },
  { file: "practice-checklist-harness.ts", note: "checklists. 133/133." },
  { file: "practice-clinic-day-harness.ts", note: "the clinic day. 40/40." },
  { file: "practice-cohort-harness.ts", note: "cohorts. 21/21." },
  { file: "practice-command-centre-harness.ts", note: "the command centre. 50/50." },
  { file: "practice-communication-harness.ts", note: "communication. 44/44." },
  { file: "practice-configuration-harness.ts", note: "configuration. 40/40." },
  { file: "practice-continuity-harness.ts", note: "continuity. 67/67." },
  { file: "practice-current-activity-harness.ts", note: "current activity. 115/115." },
  { file: "practice-dashboard-harness.ts", note: "the dashboard. 24/24." },
  { file: "practice-delegation-harness.ts", note: "delegation. 48/48." },
  { file: "practice-documentation-tools-harness.ts", note: "documentation tools. 67/67." },
  { file: "practice-documents-phase2-harness.ts", note: "documents phase 2. 78/78." },
  { file: "practice-documents-phase3-harness.ts", note: "documents phase 3. 121/121." },
  { file: "practice-documents-workspace-harness.ts", note: "the documents workspace. 99/99." },
  { file: "practice-encounter-start-harness.ts", note: "encounter start. 65/65." },
  { file: "practice-encounter-workspace-harness.ts", note: "the encounter workspace. 135 assertions." },
  { file: "practice-encounters-harness.ts", note: "encounters. 46 assertions." },
  { file: "practice-events-harness.ts", note: "practice events. 55/55." },
  { file: "practice-facilities-harness.ts", note: "facilities. 44/44." },
  { file: "practice-followup-plans-harness.ts", note: "follow-up plans. 50/50." },

  // -- Screened against staging 2026-08-27/28 (delegated sweep over the 92-list): 69 green of 89,
  // plus two batch reds that passed their solo re-run. Solo-confirmed reds are in EXCLUDED. --
  { file: "practice-handle-reachability-harness.ts", note: "handle reachability. 48/48." },
  { file: "practice-hfe-harness.ts", note: "CPR-HFE-001 conformance. 25/25." },
  { file: "practice-hospital-booking-harness.ts", note: "hospital booking. 30/30." },
  { file: "practice-identity-claim-harness.ts", note: "identity claims. 53/53." },
  { file: "practice-identity-publication-harness.ts", note: "identity publication. 49/49." },
  { file: "practice-identity-service-harness.ts", note: "the identity service. 84/84." },
  { file: "practice-import-harness.ts", note: "imports. 39 assertions." },
  { file: "practice-intelligence-harness.ts", note: "practice intelligence. 31/31." },
  { file: "practice-intelligence-pie-harness.ts", note: "intelligence PIE. 93/93." },
  { file: "practice-intelligence-suite-harness.ts", note: "the intelligence suite. 76/76." },
  { file: "practice-interruption-harness.ts", note: "interruptions. 29/29." },
  { file: "practice-knowledge-harness.ts", note: "knowledge. 88/88." },
  { file: "practice-library-harness.ts", note: "the library. 38/38." },
  { file: "practice-lifecycle-harness.ts", note: "the practice lifecycle. 80/80." },
  { file: "practice-longitudinal-harness.ts", note: "longitudinal views. 72 assertions." },
  { file: "practice-medication-harness.ts", note: "medication. 100/100." },
  { file: "practice-medication-weight-decision-harness.ts", note: "weight-based dosing decisions. 57/57." },
  { file: "practice-offline-cache-harness.ts", note: "the offline cache. 113/113." },
  { file: "practice-offline-clinical-harness.ts", note: "offline clinical capture. 71/71." },
  { file: "practice-offline-filing-harness.ts", note: "offline filing. 18/18." },
  { file: "practice-offline-guidance-harness.ts", note: "offline guidance. 71/71." },
  { file: "practice-operations-harness.ts", note: "practice operations. 50/50." },
  { file: "practice-parameters-harness.ts", note: "parameters. 180 assertions." },
  { file: "practice-pathways-harness.ts", note: "pathways. 85/85." },
  { file: "practice-patient-workspace-harness.ts", note: "the patient workspace. 133/133." },
  { file: "practice-patients-harness.ts", note: "patients. 31 assertions." },
  { file: "practice-pay-docs-harness.ts", note: "payment documents. 13/13." },
  {
    file: "practice-public-profile-harness.ts",
    note: "CPR-BOOK-PROFILE-001 public booking profile against a real database. Screened 2026-10-22 (COMPETEN-IND-003): "
      + "provisions its own practice, identity, handle and location, writes and purges them (_cleanup), and addresses no "
      + "live practice -- so STAGING, never the read-only default run. Not yet run here: staging was unreachable.",
  },
  { file: "practice-period-harness.ts", note: "periods. 86/86." },
  { file: "practice-personalisation-harness.ts", note: "personalisation. 48/48." },
  { file: "practice-pi-v2-harness.ts", note: "PI v2. 36/36." },
  { file: "practice-pid-harness.ts", note: "PID. 18 assertions." },
  { file: "practice-planner-navigation-harness.ts", note: "planner navigation. 130/130." },
  { file: "practice-portfolio-harness.ts", note: "the portfolio. 96/96." },
  { file: "practice-privacy-harness.ts", note: "privacy. 37/37." },
  { file: "practice-procedures-harness.ts", note: "procedures. 72/72." },
  { file: "practice-provisioning-harness.ts", note: "provisioning. 25 assertions." },
  { file: "practice-recurrence-harness.ts", note: "recurrence. ALL GREEN (no count printed)." },
  { file: "practice-reflection-harness.ts", note: "reflection. 55/55." },
  { file: "practice-registration-conditional-harness.ts", note: "conditional registration. 27/27." },
  { file: "practice-registration-config-harness.ts", note: "registration config. 51/51." },
  { file: "practice-registration-harness.ts", note: "registration. 66/66." },
  { file: "practice-relationships-harness.ts", note: "relationships. 48/48." },
  { file: "practice-reports-harness.ts", note: "reports. 37/37." },
  { file: "practice-reports-v2-harness.ts", note: "reports v2. 39/39." },
  { file: "practice-reschedule-harness.ts", note: "reschedules. 30/30." },
  { file: "practice-saved-search-harness.ts", note: "saved search. 30/30." },
  { file: "practice-schedule-exception-harness.ts", note: "schedule exceptions. 90/90." },
  { file: "practice-scheduling-harness.ts", note: "scheduling. 24 assertions." },
  { file: "practice-search-harness.ts", note: "search. 46/46." },
  { file: "practice-security-harness.ts", note: "practice security. 149/149." },
  { file: "practice-session-engine-harness.ts", note: "the session engine. 76/76." },
  { file: "practice-session-harness.ts", note: "sessions. 60/60." },
  { file: "practice-session-lifecycle-harness.ts", note: "session lifecycle. 78/78." },
  { file: "practice-solo-approval-harness.ts", note: "solo approval. 19/19." },
  { file: "practice-stream-harness.ts", note: "the stream. 18/18." },
  { file: "practice-sync-harness.ts", note: "sync. 97/97." },
  { file: "practice-task-orchestration-harness.ts", note: "task orchestration. 36/36." },
  { file: "practice-tasks-harness.ts", note: "tasks. 44/44." },
  { file: "practice-team-harness.ts", note: "teams. 53/53." },
  { file: "practice-timeline-harness.ts", note: "the timeline. 18/18." },
  { file: "practice-treatment-investigation-harness.ts", note: "treatment and investigation. 238/238." },
  { file: "practice-v5007-phase56-harness.ts", note: "CPR-V5-007 phases 5-6. 104/104." },
  { file: "pui-notifications-harness.ts", note: "PUI notifications. 67/67." },
  { file: "qie-loop-harness.ts", note: "the QIE loop. Exit 0; summary line not captured by the screener (a known extraction gap, same class as the hww-* forms)." },
  { file: "ssw-navigation-harness.ts", note: "SSW navigation. 26/26." },
  { file: "umw-personalisation-harness.ts", note: "UMW personalisation. Exit 0; summary not captured (extraction gap)." },
  { file: "umw-resources-harness.ts", note: "UMW resources. Exit 0; summary not captured (extraction gap)." },
  { file: "xw-competency-harness.ts", note: "cross-workspace competency. Exit 0; summary not captured (extraction gap)." },
  { file: "practice-followups-harness.ts", note: "follow-ups. Exit 0 solo (batch run showed 78/1 and did NOT reproduce alone -- possible fixture interference with a batch neighbour; worth remembering if it flakes again)." },
  { file: "practice-forms-harness.ts", note: "forms. Exit 0 solo (the batch FAIL line was a screener extraction artifact, not a harness result)." },
  { file: "umw-permissions-harness.ts", note: "UMW permissions. Exit 0 solo (batch showed 66/67 and did NOT reproduce alone -- batch-only flake, same class as practice-followups)." },
  { file: "practice-encounters-landing-harness.ts", note: "the encounters landing. Exit 0 solo (the batch run CRASHED with a stack trace and the crash did not reproduce alone -- batch-only, not evidence)." },
  { file: "practice-documentation-harness.ts", note: "the documentation lifecycle, amendment chain included. 65/65 after the 2026-08-28 staging catch-up. Its earlier red was a getDocument null over missing mig-357 columns, and its scariest line was a hard-coded detail string -- both are fixed, and the amendment protections now PASS on a real read: signed body unchanged, original AMENDED, chain linked both ways." },
  { file: "practice-generation-harness.ts", note: "document generation. 56/56 after the staging catch-up (was 48/8 on the same getDocument null)." },

  // -- The two fixture-family extensions, 2026-08-28: ten harnesses cleared by two causes. Family A
  // (booking-constraints x5): the harness rules predated CPR-BOOK-READY-001 s3 and set no visibility,
  // so publish refused with EFFECTIVE_BOOKING_CONSTRAINTS_SATISFIED; visibility: "public" added to each
  // fixture rule. Family B (hospital-profile cohort x5): provision-staging-estate-fixture section 6
  // seeds five staff identities on the fixture hospital, memberships included (D2b). --
  { file: "practice-patient-booking-screens-harness.ts", note: "the patient booking screens. 68/68 (was 18/3 on the visibility-less rule -- the fixture predated CPR-BOOK-READY-001 s3)." },
  { file: "practice-patient-intake-harness.ts", note: "patient intake. 44/44 (same family fix: visibility on the fixture rules)." },
  { file: "practice-patient-manage-harness.ts", note: "patient self-management. 46/46 (was 6/1 -- the publish gate had been hiding the rest of the harness)." },
  { file: "practice-registration-scheduling-harness.ts", note: "registration scheduling. 76/76 (same family fix)." },
  { file: "practice-session-booking-mode-harness.ts", note: "session booking modes. 34/34 (was 7/1, same family fix)." },
  { file: "ssw-attendance-harness.ts", note: "SSW shift attendance. 30/30, cleans up its own 29 rows (unblocked by the estate fixture's staff cohort)." },
  { file: "ssw-mdt-harness.ts", note: "SSW MDT. 44/44, self-cleaning (same cohort)." },
  { file: "umw-communications-harness.ts", note: "UMW communications. 53/53 (same cohort; its old libuv exit crash was noise after the data gate)." },
  { file: "umw-wellbeing-harness.ts", note: "UMW wellbeing. 53/53, self-cleaning (same cohort)." },
  { file: "xw-sweep-harness.ts", note: "the cross-workspace sweep. 54/54 -- matching its recorded historical count exactly (same cohort)." },

  // -- The three stale pins, fixed 2026-08-28: in each the PRODUCT was right and the fixture or pin
  // predated a deliberate hardening (location-at-start; module 23 registering itself). --
  { file: "practice-planner-harness.ts", note: "the activity planner. 93/93 (its fixture predated activity.ts's rule that a practice WITH locations must record one before a session RUNS; planned at L2, the four REFUSES checks breathe again)." },
  { file: "practice-setup-harness.ts", note: "practice setup. 54/54 (2f repointed 22 -> 23: module 23 Document Design, the mig-357/358 style arc, per the harness's own named-repoint trail)." },
  { file: "practice-setup-domains-harness.ts", note: "the setup domains. 62/62 (Foundation holds FIVE named modules now -- document_design joined -- and 3d's fixture publishes a style, because setup.ts counts status published only)." },

  // -- The four config/data singletons, cleared 2026-08-28. One had already evaporated with schema
  // parity; one was a harness that outsourced its test world to the deployment; two were ambient-data
  // reads now anchored by estate-fixture standing rows. --
  { file: "practice-messaging-harness.ts", note: "practice messaging, handed-over-is-not-delivered included. 40/40 -- its red predated the schema catch-up and evaporated with it; no code change was needed." },
  { file: "practice-patient-access-harness.ts", note: "the patient access boundary. 77/77. Its sections now CREATE the no-gateway world they test (scrubbing every provider variable the engines read) instead of demanding a bare deployment -- an assumption the 2026-08-27 email activation broke. Also fixed: section 5's pretended RESEND key leaked into section 7, the exact leak 3g-control-4 catches on its own pretend." },
  { file: "practice-adoption-harness.ts", note: "adoption and activation. 68/68 -- anchors on ambient appointments by design, so the estate fixture holds a standing past-dated one (real traffic on production; self-cleaning harnesses leave none on staging)." },
  { file: "xw-uplift-harness.ts", note: "the UMW-to-HEX uplift. 31/31 -- the estate fixture writes one daily op_ops_snapshots row, since HEX occupancy is snapshot-derived by design and no snapshot writer runs on staging." },
  { file: "cgr-gate-harness.ts", note: "the CGR activation gate. All checks pass, the decisive one being the MET path: AMU meets requirements it actually holds, verdict ready 4/4 -- proven against estate-fixture section 8, which seeds the six NAMED competencies the harness picks by regex (staging's 271-row library was a different catalogue from production's), an AMU department, and decisions written to activation.ts's own outcome/maturity rule. CAVEAT worth keeping: this harness sets its exit code only on create-failure, not on its printed FAIL lines -- READ its output when it matters, do not trust exit 0 alone." },
  { file: "practice-signup-harness.ts", note: "self-service signup, end to end over HTTP. 27/27 on staging 2026-08-28, the day the owner opened the front door: flag gate, eight validation refusals, a clean signup provisioning workspace + both memberships + capabilities + entitlement, duplicate-email refusal pointed at sign-in, the session-hijack refusal (ALREADY_AUTHENTICATED), server-side legal versions, and the launch flag restored to its pre-run value. ⚠ IT NEEDS A RUNNING STAGING SERVER: start competen-dev-staging (port 3100) and pass BASE_URL=http://localhost:3100, or it SKIPS with exit 0 -- a sweep that shows it green without a server has proven nothing about signup." },
];

/**
 * ⚠ THE SECOND DETECTOR, BECAUSE THE FIRST ONE HAS A KNOWN BLIND SPOT.
 *
 * The safety gate above asks the classifier whether a harness mutates. The classifier answers by looking
 * for `.insert(` / `.update(` / `.delete(` / `.upsert(` -- method calls on a Supabase builder. A harness
 * holding a raw `pg` client writes `await c.query("delete from ...")` and matches none of them, so it
 * reports read-only while creating and destroying real rows. cascade-immutability-ratchet-harness.ts is
 * exactly that, and it screened GREEN: on the classifier's evidence alone it would have joined the
 * security set and started writing to production on every run.
 *
 * !! SO THIS DETECTOR IS DELIBERATELY OVER-SENSITIVE AND MATCHES PROSE TOO. Two of the three files it
 * flags are false positives -- one asserts `/insert into gov_risk_category/` against migration text, the
 * other has "no browser-side INSERT into profiles" as a section heading. Both are recorded above with the
 * review that cleared them. That asymmetry is the point: a false positive costs one line of note, and a
 * false negative costs a write to the production database.
 */
const RAW_DML = /\b(delete\s+from|insert\s+into|update\s+[a-z_]+\s+set|truncate\s|drop\s+table)\b/i;

/**
 * ⚠ THE CEILING IS A RATCHET, NOT A TARGET. Everything privileged-live that is in none of the three lists
 * above is UNTRIAGED — derived, so a harness added tomorrow lands here automatically and pushes the count
 * over the ceiling, which goes red. Lower this number as harnesses are screened; never raise it.
 *
 * !! AND THE HONEST FRAMING IS "DEBT", NOT "HEALTH". A green run of this file means the screened subset
 * passed. It does NOT mean the estate is checked — it means UNTRIAGED_CEILING checks have still never
 * been run by anybody, and the number is printed on every run so that stays visible.
 */
const UNTRIAGED_CEILING = 0;  // 161 -> ... -> 11 -> 0. SCREENING COMPLETE 2026-08-28: every privileged-live harness is in a list. A new harness lands here and goes red until it is screened.

// ── The classifier is the authority on the set and on what mutates ───────────────────────────────
type Row = { file: string; tier: string; mutates: boolean; purpose: string };
let rows: Row[];
try {
  rows = JSON.parse(
    execFileSync("npx", ["tsx", join("scripts", "harness-classify.ts"), "--json"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, shell: process.platform === "win32",
    }),
  ) as Row[];
} catch (err) {
  console.error(`\n  the classifier could not run, so nothing below can be trusted: ${(err as Error).message.slice(0, 300)}\n`);
  process.exit(1);
}

const privileged = rows.filter(r => r.tier === "privileged-live");
const mutatesOf = new Map(privileged.map(r => [r.file, r.mutates]));
const listed = [...SECURITY, ...TRIAGED, ...STAGING, ...EXCLUDED];
const untriaged = privileged.filter(r => !listed.some(l => l.file === r.file)).map(r => r.file).sort();

// ── Staging: resolved and guarded before anything can run against it ─────────────────────────────
const stagingMode = process.argv.includes("--staging");
const stagingUrl = process.env.STAGING_SUPABASE_URL ?? null;
const stagingAnon = process.env.STAGING_ANON_KEY ?? null;
const stagingService = process.env.STAGING_SERVICE_ROLE_KEY ?? null;
/**
 * The same three variables scripts/dev-staging.mjs and scripts/smoke-staging.mjs remap, so the harness,
 * the guard and anything else reading the environment all name the same project.
 *
 * ⚠ SPAWN-TIME ONLY, AND THAT RESTS ON A VERIFIED FACT. Harnesses call `loadEnvConfig(process.cwd())`,
 * which re-reads .env.local -- and .env.local names PRODUCTION. If that overwrote an already-set
 * variable, every harness spawned here would quietly run against production while this file printed the
 * staging ref. Tested directly before building any of this: an injected value SURVIVES loadEnvConfig.
 * If that ever stops being true, the symptom is silent and catastrophic, so STAGING_ASSERT below makes
 * each spawned harness re-check the target it actually resolved.
 */
const stagingEnv = () => ({
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: stagingUrl!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: stagingAnon!,
  SUPABASE_SERVICE_ROLE_KEY: stagingService!,
});

// ── What are we pointed at? ──────────────────────────────────────────────────────────────────────
const target = stagingMode ? stagingUrl : (process.env.NEXT_PUBLIC_SUPABASE_URL ?? null);
const verdict = judgeTarget(target);
const ref = refOf(target);
// ⚠ judgeTarget returns a VERDICT OBJECT, not a string. Interpolating it printed "[object Object]" --
// caught by running it, not by reading it, which is the whole argument for this file existing.
const verdictText = verdict.ok ? "not production — safe for destructive automation"
  : verdict.reason === "PRODUCTION" ? "PRODUCTION — read-only harnesses only"
  : "UNIDENTIFIABLE — refused, the guard fails closed";

console.log("\n=== Privileged-live acceptance harnesses ===\n");
console.log(`  mode           : ${stagingMode ? "STAGING — the writing harnesses" : "production — read-only only"}`);
console.log(`  target project : ${ref ?? "(unidentifiable)"}  — ${verdictText}`);
console.log(`  privileged-live: ${privileged.length} of ${rows.length} harnesses (${privileged.filter(r => r.mutates).length} of them WRITE to the database)`);
console.log(`  security ${SECURITY.length} · triaged ${TRIAGED.length} · staging ${STAGING.length} · excluded ${EXCLUDED.length} · UNTRIAGED ${untriaged.length}\n`);

let broken = false;
const fail = (msg: string) => { broken = true; console.log(msg); };

// ── ⚠ THE PRODUCTION GATE (COMPETEN-OPS-001 R13). Without --staging this runner reads whatever .env.local
// names, which is PRODUCTION. Reading production is an owner decision, so the default run refuses unless
// `--production` AND COMPETEN_PRODUCTION_READ_GO (the owner GO it runs under) are both given. --list and
// --untriaged connect to nothing and stay open.
const reportOnly = process.argv.includes("--list") || process.argv.includes("--untriaged");
if (!stagingMode && !reportOnly) {
  const read = productionReadDecision(target);
  if (!read.allowed) {
    console.log(read.reason === "NOT_AUTHORISED"
      ? `⛔ REFUSING: this run would read PRODUCTION. Use --staging, or pass --production with ${PRODUCTION_READ_GO_ENV}=<owner GO reference>.\n`
      : "⛔ REFUSING: the target project cannot be identified, so this run cannot prove it is not production.\n");
    process.exit(1);
  }
  if (read.production) console.log(`  production read authorised by: ${read.go}\n`);
}

// ── ⚠ THE STAGING GATE. Nothing that writes runs until this passes ───────────────────────────────
if (stagingMode) {
  const missing = [
    !stagingUrl && "STAGING_SUPABASE_URL",
    !stagingAnon && "STAGING_ANON_KEY",
    !stagingService && "STAGING_SERVICE_ROLE_KEY",
  ].filter(Boolean) as string[];
  if (missing.length) {
    fail(`⚠ --staging needs ${missing.join(", ")} in .env.local (gitignored). STAGING_ANON_KEY is the PUBLIC key.`);
  } else {
    try {
      // The one predicate provision-staging-fixture.ts and the smoke helper already use. It refuses the
      // production ref AND an unidentifiable URL -- "we could not tell which project this is" is not a
      // reason to write to it.
      assertSafeTarget(stagingUrl, "STAGING_SUPABASE_URL");

      /**
       * ⚠ AND THEN PROVE IT IN A CHILD PROCESS, BECAUSE THAT IS WHERE THE HARNESSES LIVE.
       *
       * Everything above checks variables in THIS process. The harnesses run in spawned ones, and each
       * calls loadEnvConfig, which re-reads .env.local — the file that names PRODUCTION. If that ever
       * overwrites the injected value, every writing harness would hit the live project while this file
       * cheerfully printed the staging ref. _staging-probe.ts resolves the target the way a harness
       * does, in a real child, with exactly the environment a harness gets.
       */
      const out = execFileSync("npx", ["tsx", join("scripts", "_staging-probe.ts")], {
        cwd: ROOT, encoding: "utf8", env: stagingEnv(), shell: process.platform === "win32",
      });
      const m = /RESOLVED (\S+) AUTH (\S+)/.exec(out);
      const stagingRef = refOf(stagingUrl);
      if (!m) {
        fail(`⚠ the staging probe returned nothing usable, so what a spawned harness resolves is UNKNOWN. Refusing.`);
      } else if (m[1] !== stagingRef) {
        fail(`⚠⚠ A SPAWNED HARNESS RESOLVES ${m[1]}, NOT ${stagingRef}. The remap does not survive loadEnvConfig.`);
        fail(`  Every writing harness would run against that project. Refusing to run any of them.`);
      } else if (m[2] !== "ok") {
        // The key is what writes, and keys are project-scoped -- one from another project cannot
        // authenticate here. Checked by using it rather than by reading its shape: staging's key is one
        // of the newer sb_secret_ kind with no decodable payload.
        fail(`⚠ the service-role key does not authenticate against ${m[1]} (${m[2]}).`);
        fail(`  Refusing -- a harness would fail obscurely instead. Check STAGING_SERVICE_ROLE_KEY.`);
      } else {
        console.log(`  staging accepted: a spawned harness resolves ${m[1]} and its service-role key authenticates there\n`);
      }
    } catch (err) {
      fail(`⚠ ${(err as Error).message}`);
    }
  }
}

// ── ⚠ SAFETY GATE. Derived, not promised ─────────────────────────────────────────────────────────
// A curated "these are read-only" list is a claim that decays the first time somebody adds a fixture to
// one of them. This checks the claim against the classifier every run, so the decay is loud.
const autoRun = [...SECURITY, ...TRIAGED];
const wouldMutate = autoRun.filter(l => mutatesOf.get(l.file));
if (wouldMutate.length) {
  fail(`⚠ ${wouldMutate.length} harness(es) in the auto-run set WRITE to the database: ${wouldMutate.map(l => l.file).join(", ")}`);
  fail(`  This runner will not execute a mutating harness. Move it to EXCLUDED, or run it against staging by hand.`);
}

// The second detector. A hit is not a verdict -- it is a demand for a recorded review.
const unreviewed = autoRun.filter(l => {
  let src = "";
  try { src = readFileSync(join(ROOT, "scripts", l.file), "utf8"); } catch { return false; }
  return RAW_DML.test(src) && !l.rawSql;
});
if (unreviewed.length) {
  fail(`⚠ ${unreviewed.length} auto-run harness(es) contain raw SQL DML with no recorded review: ${unreviewed.map(l => l.file).join(", ")}`);
  fail(`  Read the matches. If they are executed, the harness writes and belongs in EXCLUDED. If they are`);
  fail(`  assertions or prose, add a \`rawSql\` note saying so -- the classifier cannot tell the difference.`);
}
// ⚠ AND THE DETECTOR'S OWN CONTROL. A regex that stops matching turns this gate green over everything,
// which is indistinguishable from a clean estate. Feed it a known-bad string on every run.
if (!RAW_DML.test('await c.query("delete from practice_lifecycle_transition where id = $1")')) {
  fail(`⚠ the raw-SQL detector does not match a known raw DELETE -- it is inert, and every result above is meaningless`);
}
const staleReview = autoRun.filter(l => {
  if (!l.rawSql) return false;
  try { return !RAW_DML.test(readFileSync(join(ROOT, "scripts", l.file), "utf8")); } catch { return false; }
});
if (staleReview.length) {
  fail(`⚠ ${staleReview.length} harness(es) carry a rawSql review but no longer contain raw SQL: ${staleReview.map(l => l.file).join(", ")}`);
  fail(`  Remove the note. A review of something that is gone reads as a review of whatever replaced it.`);
}

// ── ⚠ COVERAGE CONTROL, in three directions ──────────────────────────────────────────────────────
// ci-harnesses.ts checks two (unaccounted, stale). The third — the same file appearing in two lists —
// is what makes a count wrong while every individual line looks right.
const stale = listed.filter(l => !privileged.some(p => p.file === l.file));
if (stale.length) {
  fail(`⚠ ${stale.length} listed harness(es) are no longer privileged-live: ${stale.map(l => l.file).join(", ")}`);
  fail(`  A harness that lost its database dependency belongs in ci-harnesses.ts instead.`);
}
const seen = new Set<string>();
const doubled = listed.filter(l => (seen.has(l.file) ? true : (seen.add(l.file), false)));
if (doubled.length) fail(`⚠ ${doubled.length} harness(es) appear in more than one list: ${doubled.map(l => l.file).join(", ")}`);

if (untriaged.length > UNTRIAGED_CEILING) {
  fail(`⚠ UNTRIAGED is ${untriaged.length}, above the ceiling of ${UNTRIAGED_CEILING}.`);
  fail(`  Screen the new harness and add it to SECURITY, TRIAGED, STAGING or EXCLUDED — or raise the`);
  fail(`  ceiling deliberately and say why. A ceiling that drifts upward is not a ratchet.`);
}

// ── --list / --untriaged: report and stop ────────────────────────────────────────────────────────
const show = (title: string, items: Listed[]) => {
  if (!items.length) return;
  console.log(`${title} (${items.length})`);
  for (const i of items) console.log(`  - ${i.file}\n      ${i.note}`);
  console.log("");
};

if (process.argv.includes("--list")) {
  show("SECURITY — read-only, security-critical, run by default", SECURITY);
  show("TRIAGED — read-only, verified, not a security boundary", TRIAGED);
  show("STAGING — the writing harnesses, run against staging with --staging", STAGING);
  show("EXCLUDED — screened and deliberately not run here", EXCLUDED);
  console.log(`UNTRIAGED (${untriaged.length}) — never screened, never run. Pass --untriaged to list them.\n`);
  process.exit(broken ? 1 : 0);
}

if (process.argv.includes("--untriaged")) {
  console.log(`UNTRIAGED (${untriaged.length}) — no runner, no coverage, never screened:\n`);
  for (const f of untriaged) console.log(`  ${mutatesOf.get(f) ? "writes" : " read"}  ${f}`);
  console.log("");
  process.exit(broken ? 1 : 0);
}

/**
 * --screen — triage. Run untriaged WRITING harnesses against staging and report, adding nothing to any
 * list. Filling STAGING is a decision made from the output, not by the script that produced it: a
 * screener that promotes whatever exited 0 would have admitted every harness whose assertions were
 * skipped, which is the failure ci-harnesses.ts records for four of its own.
 *
 * ⚠ SEQUENTIAL, AND IN BOUNDED BATCHES, FOR A MEASURED REASON. TESTING.md: 68 harnesses into a full
 * sweep, GoTrue began shedding load and every later harness failed for a reason unrelated to its code.
 * Staging is a Supabase project like any other and has no special exemption from that. `--screen 20`
 * takes twenty, and `--from N` starts at an offset so batches can be spread out.
 */
if (stagingMode && process.argv.includes("--screen")) {
  if (broken) { console.log(`\nRED  refusing to screen — the staging gate did not pass.\n`); process.exit(1); }
  const n = Number(process.argv[process.argv.indexOf("--screen") + 1]) || 20;
  const fromIdx = process.argv.includes("--from") ? Number(process.argv[process.argv.indexOf("--from") + 1]) || 0 : 0;
  /**
   * ⚠ 240s WAS TOO SHORT, AND IT MANUFACTURED A DEFECT THAT DID NOT EXIST.
   *
   * Four harnesses hit the old fixed 240s ceiling and were recorded as hangs. practice-booking-rules,
   * re-run alone with a 540s ceiling, finished in 473 SECONDS with 133 passed, 0 failed. It was never
   * hanging; it was working.
   *
   * !! AND THE FIRST EXPLANATION -- "staging is slower" -- WAS ALSO WRONG. Measured: staging's median
   * round-trip is 489ms against production's 449ms, i.e. 1.1x, which explains nothing. The real number is
   * that a round-trip from here costs ~450ms to EITHER project, and these harnesses make many hundreds of
   * them sequentially. Eight minutes is simply what they cost, on any target.
   *
   * So the ceiling is generous by default and adjustable, and a timeout now reports itself as a CEILING
   * HIT rather than as a failure -- because those are different claims and only one of them is about the
   * harness.
   */
  const timeoutMs = (Number(process.argv[process.argv.indexOf("--timeout") + 1]) || 600) * 1000;
  const batch = untriaged.filter(f => mutatesOf.get(f)).slice(fromIdx, fromIdx + n);
  console.log(`Screening ${batch.length} writing harness(es) against staging, offset ${fromIdx} of ${untriaged.filter(f => mutatesOf.get(f)).length}\n`);
  const green: string[] = [], red: string[] = [];
  for (const file of batch) {
    process.stdout.write(`── ${file} ... `);
    try {
      const out = execFileSync("npx", ["tsx", join("scripts", file)], {
        cwd: ROOT, encoding: "utf8", stdio: "pipe", env: stagingEnv(),
        shell: process.platform === "win32", timeout: timeoutMs,
      });
      // ⚠ THE EXTRACTION WAS NARROWER THAN THE ESTATE'S REPORTING CONVENTIONS. It missed
      // `ALL PASS — 12 pass / 0 fail` (the hww-* form: "pass", not "passed", and no digit after PASS),
      // so six harnesses that assert plenty screened with a BLANK summary and read as vacuous greens.
      // The exit code had classified them correctly the whole time; only the line shown was missing.
      const sum = out.split("\n").filter(l => /\d+ pass|passed|ALL PASS|ALL GREEN|assertion/i.test(l)).pop() ?? "";
      console.log(`PASS   ${sum.trim().slice(0, 66)}`);
      green.push(file);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; signal?: string };
      const why = e.signal === "SIGTERM" ? `CEILING HIT (${timeoutMs / 1000}s) -- not a failure, re-run with --timeout`
        : ((e.stdout ?? "").split("\n").filter(l => /FAIL|failed|Error|refus/i.test(l)).pop()
          ?? (e.stderr ?? "").split("\n").filter(Boolean).pop() ?? "").trim().slice(0, 66);
      console.log(`FAIL   ${why}`);
      red.push(file);
    }
  }
  console.log(`\n  screened ${batch.length}: ${green.length} green, ${red.length} red`);
  console.log(`  ⚠ green here means EXITED 0 against staging. It is evidence for promoting a harness to`);
  console.log(`     STAGING, not the promotion itself -- read what it asserted before adding it.\n`);
  process.exit(0);
}

/**
 * --only <substring> — run ONE harness, alone, with its output streamed rather than captured.
 *
 * ⚠ THIS IS THE SHAPE THIS REPOSITORY'S OWN RULE REQUIRES. TESTING.md: "a red harness late in a sweep is
 * not evidence until it is re-run alone." Without a way to do that, the only options were to re-run a
 * whole batch or to hand-remap the environment in a shell — and hand-remapping is how somebody eventually
 * exports the production values because that is what makes the red go away.
 *
 * Output is INHERITED, not piped: a harness that hangs shows you how far it got, and a captured stream
 * shows you nothing at all. That distinction is the entire reason the four hangs were diagnosable.
 */
const onlyIdx = process.argv.indexOf("--only");
if (onlyIdx >= 0) {
  const needle = process.argv[onlyIdx + 1] ?? "";
  if (broken) { console.log(`\nRED  refusing — the gate did not pass.\n`); process.exit(1); }
  const match = privileged.map(r => r.file).filter(f => f.includes(needle));
  if (match.length !== 1) {
    console.log(`  --only "${needle}" matched ${match.length} harness(es)${match.length ? `: ${match.join(", ")}` : ""}. Name exactly one.\n`);
    process.exit(1);
  }
  const file = match[0];
  if (mutatesOf.get(file) && !stagingMode) {
    console.log(`  ${file} WRITES to the database and this run is pointed at ${ref}. Add --staging.\n`);
    process.exit(1);
  }
  console.log(`Running ${file} alone against ${ref}, output streamed:\n`);
  try {
    execFileSync("npx", ["tsx", join("scripts", file)], {
      cwd: ROOT, stdio: "inherit", shell: process.platform === "win32",
      ...(stagingMode ? { env: stagingEnv() } : {}),
    });
    console.log(`\n  ${file} exited 0\n`);
    process.exit(0);
  } catch (err) {
    console.log(`\n  ${file} exited non-zero (${(err as { status?: number }).status ?? "signal"})\n`);
    process.exit(1);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────
show("EXCLUDED — printed every run so the list cannot rot unseen", EXCLUDED);

const runAll = process.argv.includes("--all");
// ⚠ THE MODES DO NOT MIX. --staging runs the writing harnesses against staging and NOTHING ELSE; the
// default run is read-only against whatever .env.local names. Combining them would mean one command
// writing to one project and reading another, and a reader could not tell from the output which
// harness hit which.
/**
 * ⚠ THE STAGING RUN CAN BE CHUNKED, because the full list is 161 harnesses and hours of wall clock, and
 * a run that long has been killed mid-flight before (the 2026-08-28 sweep lost two batches that way).
 * `--from N --limit M` runs a slice of the STAGING list in its declared order; a full-estate confirm is
 * several slices back to back, each short enough to finish inside the kill window, results concatenated
 * by the caller. Slicing is display-honest: the summary names the slice so a partial run can never be
 * quoted as the estate.
 */
const runFromIdx = process.argv.includes("--from") ? Number(process.argv[process.argv.indexOf("--from") + 1]) || 0 : 0;
const runLimit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity : Infinity;
const fullList = stagingMode ? STAGING : runAll ? [...SECURITY, ...TRIAGED] : SECURITY;
const toRun = stagingMode ? fullList.slice(runFromIdx, runFromIdx + runLimit) : fullList;
if (stagingMode && toRun.length < fullList.length) {
  console.log(`  SLICE: entries ${runFromIdx}..${runFromIdx + toRun.length - 1} of ${fullList.length} — this run alone is not the estate\n`);
}
const failures: string[] = [];

// ⚠ A GATE THAT FAILED IS A GATE THAT MUST STOP THE RUN. Reporting a refusal and then executing anyway
// is the shape this repository has recorded before: a control that reports without preventing.
if (broken && stagingMode) {
  console.log(`\nRED  refusing to run ${STAGING.length} writing harness(es) — the staging gate did not pass.\n`);
  process.exit(1);
}

if (!toRun.length) {
  console.log(`  nothing to run — ${stagingMode ? "STAGING" : "SECURITY"} is empty.\n`);
} else {
  for (const { file } of toRun) {
    process.stdout.write(`── ${file} ... `);
    try {
      // ⚠ 900s CEILING, generous by measurement: the longest harness in the estate is 473s. Without one,
      // a genuinely hung harness would hang the whole confirm run silently.
      execFileSync("npx", ["tsx", join("scripts", file)], {
        cwd: ROOT, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32",
        timeout: 900_000,
        ...(stagingMode ? { env: stagingEnv() } : {}),
      });
      console.log("PASS");
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      console.log("FAIL");
      failures.push(file);
      // The harness's own output is the diagnosis — reprint it rather than a wrapper's summary.
      console.log((e.stdout ?? "").split("\n").filter(l => /FAIL|failed|EXPOSED|Error/i.test(l)).slice(0, 12)
        .map(l => `      ${l.trim()}`).join("\n") || `      ${(e.stderr ?? "").slice(0, 800)}`);
    }
  }
}

console.log(`\n${failures.length === 0 && !broken ? "ALL GREEN" : "RED"}  `
  + `${toRun.length - failures.length}/${toRun.length} run, `
  + `${EXCLUDED.length} excluded by record, ${untriaged.length} never screened`);
if (failures.length) console.log(`FAILED: ${failures.join(", ")}`);
if (!runAll && TRIAGED.length) console.log(`  (--all would also run the ${TRIAGED.length} triaged non-security harnesses)`);
if (untriaged.length) {
  console.log(`\n  ⚠ ${untriaged.length} privileged-live harness(es) have still never been run by anybody.`);
  console.log(`     They are UNRUN, not unrunnable: staging works and ${STAGING.length} write-harnesses already run there.`);
  console.log(`     Triage the next batch with:  --staging --screen 20 --from ${182 - untriaged.length}`);
}
console.log("");
process.exit(failures.length === 0 && !broken ? 0 : 1);
