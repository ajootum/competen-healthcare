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
 * ⚠ A STAGING PROJECT EXISTS, so the mutating 161 are UNRUN rather than UNRUNNABLE — a different problem
 * with a different fix. Verified 2026-08-27: staging answers /auth/v1/health and carries the schema
 * (hq_capability holds 50 rows there against production's 50). production-guard.ts already knows both
 * refs. Pointing the mutating harnesses at it is real work — fixture ownership, cleanup, and the 504
 * hazard above apply there too — and it is the next thing this file should grow.
 *
 *   npx tsx scripts/privileged-harnesses.ts              run the security subset (read-only)
 *   npx tsx scripts/privileged-harnesses.ts --all        also run the triaged non-security subset
 *   npx tsx scripts/privileged-harnesses.ts --list       print every list and exit, running nothing
 *   npx tsx scripts/privileged-harnesses.ts --untriaged  print what has not been screened yet
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { judgeTarget, refOf } from "./production-guard";

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
    file: "cascade-immutability-ratchet-harness.ts",
    note:
      "⚠⚠ IT WRITES, AND THE CLASSIFIER SAYS IT DOES NOT. harness-classify tiers it privileged-live but "
      + "reports mutates:false, because it detects `.insert(` / `.delete(` METHOD CALLS and this harness "
      + "uses a raw `pg` connection: `await c.query(\"insert into practice_workspace ...\")` at line 113, "
      + "a lifecycle transition at 117, then delete and update at 122-123. Eleven query calls. It creates "
      + "a real workspace to prove the cascade-vs-immutability ratchet. "
      + "!! IT SCREENED GREEN AND WOULD HAVE BEEN ADMITTED TO THE SECURITY SET ON THAT EVIDENCE -- the "
      + "classifier's blind spot is the reason RAW_DML below exists and is deliberately over-sensitive. "
      + "Run it deliberately, against staging, not from here.",
  },
  {
    file: "cgr-suggest-harness.ts",
    note:
      "CALLS THE SHIPPED AI ENGINE, so every run costs money and returns something slightly different. Its "
      + "own header calls it a one-off. A non-deterministic check in a routine runner trains people to "
      + "ignore the runner. Needs ANTHROPIC_API_KEY, which a green run here would silently depend on.",
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
const listed = [...SECURITY, ...TRIAGED, ...EXCLUDED];
const untriaged = privileged.filter(r => !listed.some(l => l.file === r.file)).map(r => r.file).sort();

// ── What are we pointed at? ──────────────────────────────────────────────────────────────────────
const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
const verdict = judgeTarget(target);
const ref = refOf(target);
// ⚠ judgeTarget returns a VERDICT OBJECT, not a string. Interpolating it printed "[object Object]" --
// caught by running it, not by reading it, which is the whole argument for this file existing.
const verdictText = verdict.ok ? "not production — safe for destructive automation"
  : verdict.reason === "PRODUCTION" ? "PRODUCTION — read-only harnesses only"
  : "UNIDENTIFIABLE — refused, the guard fails closed";

console.log("\n=== Privileged-live acceptance harnesses ===\n");
console.log(`  target project : ${ref ?? "(unidentifiable)"}  — ${verdictText}`);
console.log(`  privileged-live: ${privileged.length} of ${rows.length} harnesses (${privileged.filter(r => r.mutates).length} of them WRITE to the database)`);
console.log(`  security ${SECURITY.length} · triaged ${TRIAGED.length} · excluded ${EXCLUDED.length} · UNTRIAGED ${untriaged.length}\n`);

let broken = false;
const fail = (msg: string) => { broken = true; console.log(msg); };

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
  fail(`  Screen the new harness and add it to SECURITY, TRIAGED or EXCLUDED — or raise the ceiling`);
  fail(`  deliberately and say why. A ceiling that drifts upward is not a ratchet.`);
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

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────
show("EXCLUDED — printed every run so the list cannot rot unseen", EXCLUDED);

const runAll = process.argv.includes("--all");
const toRun = runAll ? [...SECURITY, ...TRIAGED] : SECURITY;
const failures: string[] = [];

if (!toRun.length) {
  console.log("  nothing to run — SECURITY is empty.\n");
} else {
  for (const { file } of toRun) {
    process.stdout.write(`── ${file} ... `);
    try {
      execFileSync("npx", ["tsx", join("scripts", file)], {
        cwd: ROOT, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32",
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
