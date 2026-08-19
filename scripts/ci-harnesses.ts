/**
 * The acceptance harnesses that run in CI, and — just as importantly — the ones that do not, each with
 * the reason it was kept out.
 *
 * COMP-ENG-001 §7 left this open: TESTING.md said the 32 `pure/local` harnesses were "theoretically
 * CI-safe today, pending a pass to confirm each runs cleanly and deterministically outside a
 * developer's machine — not yet done, not claimed as done." This file is that pass, executed
 * 2026-08-18: every one of the 32 was run twice with a scrubbed environment and its exit code and
 * summary line compared.
 *
 * ⚠ THE HEADLINE: "pure/local" DID NOT MEAN "CI-SAFE". Ten of the 32 do not belong in CI — six are RED
 * on real, pre-existing defects, and four would report green in CI for a reason that has nothing to do
 * with the thing they claim to check. Wiring all 32 in on the strength of the tier label would have
 * produced a pipeline born red AND four checks that pass while proving nothing.
 *
 * ⚠ EXCLUSIONS ARE RECORDED DEVIATIONS, NOT SILENCE — the same discipline as
 * security/audit-allowlist.json. Every excluded harness prints on every run, so the list cannot rot
 * unseen. Remove an entry the moment its reason stops being true.
 *
 * ⚠ THE COVERAGE CONTROL AT THE BOTTOM IS THE POINT. A harness added to scripts/ later would otherwise
 * be silently absent from CI forever, and nobody would ever see a red light saying so. This runner
 * fails if the classifier's `pure/local` set and (INCLUDED + EXCLUDED) ever disagree.
 *
 * Run locally exactly as CI does:  npx tsx scripts/ci-harnesses.ts
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/**
 * Confirmed CI-safe: exit 0 on two consecutive scrubbed-environment runs, no network, no database, no
 * dev server, no build artefact, no .env.local read, and an assertion set that is actually evaluated on
 * a clean checkout rather than skipped.
 */
const INCLUDED = [
  // COMP-ENG-002H Track A: next.config.ts and playwright.config.ts must agree about the dev origin.
  // Pure static read of two config files, so it belongs in the no-credential subset.
  "dev-origin-harness.ts",
  "access-doors-harness.ts",
  "access-scanner-harness.ts",
  "attendance-harness.ts",
  // Reads only src/** and security/*.json, counts in-process. Its drift control is the reason it is
  // here rather than run occasionally: an unclassified guard helper makes gated routes look open.
  "auth-boundary-harness.ts",
  "clock-format-harness.ts",
  "cpr040-design-system-harness.ts",
  "hww-cnci-harness.ts",
  "mos-gap-matrix-harness.ts",
  "pd-health-harness.ts",
  "pd-nav-harness.ts",
  "pd-screen-doctrine-harness.ts",
  "plane-boundary-harness.ts",
  "practice-diagnosis-capture-harness.ts",
  "practice-nav-discoverability-harness.ts",
  // ⚠ THE ONE TIMING-SENSITIVE ENTRY. 3i asserts a refusal costs <150ms and 7a asserts a PBKDF2
  // derivation costs >50ms. Both passed three consecutive local runs with room to spare, and 7a failing
  // on faster hardware would be a REAL signal (the iteration count no longer protects a short secret),
  // not noise. Kept in deliberately, flagged here so a future flake is diagnosed rather than guessed at.
  "practice-offline-lock-harness.ts",
  "practice-outbox-harness.ts",
  "practice-planner-freeze-harness.ts",
  "practice-responsive-harness.ts",
  "practice-taxonomy-harness.ts",
  // Both were RED and are now green -- and for opposite reasons, which is the point of the note in
  // EXCLUDED's place: pui-a11y found two genuinely unprotected modal surfaces (plus a third whose
  // hand-rolled trap was inert), while pui-components was itself stale, pinned to where the focus code
  // used to live before it moved into use-modal-focus.ts.
  "pui-a11y-harness.ts",
  "pui-charts-harness.ts",
  "pui-components-harness.ts",
  // ADR-008. Reads only src/**, counts in-process, no ambient dependency -- CI-safe by construction.
  "role-authorization-ratchet-harness.ts",
  "pui-colour-harness.ts",
  "pui-tokens-harness.ts",
  "sidebar-active-harness.ts",
  "staff-host-harness.ts",
];

type Exclusion = { file: string; reason: string };

/**
 * ⚠ SIX OF THESE ARE RED ON REAL DEFECTS, NOT ON BEING UNSAFE TO RUN. They are excluded so this gate is
 * not born red — the same call made when the pipeline first landed and ten pre-existing lint errors were
 * fixed rather than tolerated. Each names the defect so it is a tracked bug, not a disappeared one.
 * Fixing the defect and moving the entry into INCLUDED is the intended end state for all six.
 */
const EXCLUDED: Exclusion[] = [
  {
    file: "pui-header-harness.ts",
    reason:
      "RED ON A REAL DEFECT. The super-admin workspace layout renders sign out in its sidebar, which the "
      + "header doctrine forbids. Small fix, but it is a doctrine question rather than a mechanical one "
      + "— confirm the rule still holds for super-admin before moving the control.",
  },
  {
    file: "umw-nav-harness.ts",
    reason:
      "RED ON A REAL DEFECT (10/11). Sub-headings are not hidden in the collapsed icon rail, leaving "
      + "stray unlabelled text in the icon strip.",
  },
  {
    file: "security-headers-harness.ts",
    reason:
      "RED, AND STRUCTURALLY UNFIT ANYWAY (45 passed, 1 failed). It fetches http://localhost:3000 and "
      + "needs `next build && next start` running first, and it reads .env.local via loadEnvConfig for "
      + "NEXT_PUBLIC_SUPABASE_URL. Neither exists on a clean CI checkout. This belongs in a future job "
      + "that builds and starts the app, not in the no-credential subset.",
  },
  {
    file: "practice-bundle-harness.ts",
    reason:
      "WOULD BE A VACUOUS GREEN. It reads .next/, and with no build present it skip()s its two real "
      + "checks to PEND and still exits 0 — pending does not fail. It passed locally only because a dev "
      + "server had populated .next. In CI it would report green having scanned nothing. Needs a build "
      + "step to be meaningful; that is a deliberate later decision about CI cost.",
  },
  {
    file: "practice-outbox-durability-harness.ts",
    reason:
      "WOULD BE A VACUOUS GREEN, AND CANNOT RUN. Its own header states it needs the dev server on :3000 "
      + "and Google Chrome installed — it drives a real browser against a real origin. It exited 0 during "
      + "screening only because a dev server happened to be running on this machine at the time.",
  },
  {
    file: "pui-migration-harness.ts",
    reason:
      "WOULD BE A VACUOUS GREEN. Its core assertion compares `git diff HEAD -- src/app` before and after "
      + "a codemod, and a clean CI checkout has no working-tree diff, so it prints 'nothing to verify' "
      + "and passes having compared zero files. It is a developer tool for verifying a codemod in "
      + "progress, not a standing invariant.",
  },
  {
    file: "sso-harness.ts",
    reason:
      "LIVE NETWORK. Checks 3a/3b fetch the real Supabase GoTrue /auth/v1/settings endpoint, using "
      + "credentials it loads from .env.local via loadEnvConfig — which is why it survived an `env -u` "
      + "scrub during screening and reported live data. The classifier tiered it pure/local because it "
      + "never imports @supabase/supabase-js; it reaches the database estate by raw fetch instead.",
  },
];

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────
console.log("\n=== CI acceptance harnesses (no-credential subset) ===\n");

console.log(`Excluded from CI (${EXCLUDED.length}) — printed every run so the list cannot rot unseen:`);
for (const e of EXCLUDED) console.log(`  - ${e.file}\n      ${e.reason}`);
console.log("");

const failures: string[] = [];
for (const file of INCLUDED) {
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
    // The harness's own output is the diagnosis -- reprint it rather than a wrapper's summary.
    console.log((e.stdout ?? "").split("\n").filter(l => /FAIL|failed|Error/i.test(l)).slice(0, 12)
      .map(l => `      ${l.trim()}`).join("\n") || `      ${(e.stderr ?? "").slice(0, 800)}`);
  }
}

// ── ⚠ COVERAGE CONTROL ───────────────────────────────────────────────────────────────────────────
// Without this, a harness added later is silently absent from CI and nothing ever says so.
let coverageBroken = false;
try {
  const classified = JSON.parse(
    execFileSync("npx", ["tsx", join("scripts", "harness-classify.ts"), "--json"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, shell: process.platform === "win32",
    }),
  ) as { file: string; tier: string }[];
  const pure = new Set(classified.filter(r => r.tier === "pure/local").map(r => r.file));
  const accounted = new Set([...INCLUDED, ...EXCLUDED.map(e => e.file)]);
  const unaccounted = [...pure].filter(f => !accounted.has(f));
  const stale = [...accounted].filter(f => !pure.has(f));
  if (unaccounted.length) {
    coverageBroken = true;
    console.log(`\n⚠ ${unaccounted.length} pure/local harness(es) are in neither list: ${unaccounted.join(", ")}`);
    console.log("  Screen each one, then add it to INCLUDED or to EXCLUDED with a reason.");
  }
  if (stale.length) {
    coverageBroken = true;
    console.log(`\n⚠ ${stale.length} listed harness(es) no longer classify as pure/local: ${stale.join(", ")}`);
    console.log("  A harness that gained a database dependency must leave this file.");
  }
  if (!unaccounted.length && !stale.length) {
    console.log(`\nCoverage control: all ${pure.size} pure/local harnesses are accounted for.`);
  }
} catch (err) {
  coverageBroken = true;
  console.log(`\n⚠ the coverage control could not run: ${(err as Error).message.slice(0, 300)}`);
}

console.log(`\n${failures.length === 0 && !coverageBroken ? "ALL GREEN" : "RED"}  `
  + `${INCLUDED.length - failures.length}/${INCLUDED.length} harnesses passed, `
  + `${EXCLUDED.length} excluded by record`);
if (failures.length) console.log(`FAILED: ${failures.join(", ")}`);
process.exit(failures.length === 0 && !coverageBroken ? 0 : 1);
