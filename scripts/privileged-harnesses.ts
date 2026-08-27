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
 * Staging is real: it answers /auth/v1/health and carries 665 of production's 671 tables. The six it
 * lacks are from migrations 349, 352, 353 and 357, and NONE of the 161 writing harnesses reference any of
 * them — measured, not assumed — so the drift does not block this. It does mean staging is behind, and
 * that is the owner's to apply.
 *
 *   npx tsx scripts/privileged-harnesses.ts              run the security subset (read-only)
 *   npx tsx scripts/privileged-harnesses.ts --all        also run the triaged non-security subset
 *   npx tsx scripts/privileged-harnesses.ts --staging    run the WRITING harnesses against staging
 *   npx tsx scripts/privileged-harnesses.ts --list       print every list and exit, running nothing
 *   npx tsx scripts/privileged-harnesses.ts --untriaged  print what has not been screened yet
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { assertSafeTarget, judgeTarget, refOf } from "./production-guard";

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
const UNTRIAGED_CEILING = 161;

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
  const batch = untriaged.filter(f => mutatesOf.get(f)).slice(fromIdx, fromIdx + n);
  console.log(`Screening ${batch.length} writing harness(es) against staging, offset ${fromIdx} of ${untriaged.filter(f => mutatesOf.get(f)).length}\n`);
  const green: string[] = [], red: string[] = [];
  for (const file of batch) {
    process.stdout.write(`── ${file} ... `);
    try {
      const out = execFileSync("npx", ["tsx", join("scripts", file)], {
        cwd: ROOT, encoding: "utf8", stdio: "pipe", env: stagingEnv(),
        shell: process.platform === "win32", timeout: 240_000,
      });
      const sum = out.split("\n").filter(l => /passed|PASS \d|ALL GREEN|assertion/i.test(l)).pop() ?? "";
      console.log(`PASS   ${sum.trim().slice(0, 66)}`);
      green.push(file);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; signal?: string };
      const why = e.signal === "SIGTERM" ? "TIMED OUT (240s)"
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

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────
show("EXCLUDED — printed every run so the list cannot rot unseen", EXCLUDED);

const runAll = process.argv.includes("--all");
// ⚠ THE MODES DO NOT MIX. --staging runs the writing harnesses against staging and NOTHING ELSE; the
// default run is read-only against whatever .env.local names. Combining them would mean one command
// writing to one project and reading another, and a reader could not tell from the output which
// harness hit which.
const toRun = stagingMode ? STAGING : runAll ? [...SECURITY, ...TRIAGED] : SECURITY;
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
      execFileSync("npx", ["tsx", join("scripts", file)], {
        cwd: ROOT, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32",
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
  console.log(`     ${privileged.filter(r => r.mutates).length} of the ${privileged.length} write to the database. A staging project EXISTS and carries the`);
  console.log(`     schema, so these are UNRUN rather than unrunnable -- pointing them at it is the next step.`);
}
console.log("");
process.exit(failures.length === 0 && !broken ? 0 : 1);
