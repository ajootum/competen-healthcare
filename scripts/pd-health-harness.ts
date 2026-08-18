/**
 * CPR-PD-008 PRODUCT HEALTH HARNESS.
 *
 * ⚠ THIS EXISTS BECAUSE OF ONE BUG, AND THE BUG IS THE WHOLE ARGUMENT FOR IT. The first version of
 * pd-health.ts counted an AI failure as `status !== "success"`. That column's vocabulary is
 * ('ok','refusal','error','not_configured') — "success" never appears in it. So every one of the 146
 * requests in the window was counted as a failure, and the screen would have told a Product Director the
 * AI service was failing 100% of the time. It typechecked. It ran. Every harness in the repo was green.
 *
 * Only running the loader against the live database caught it.
 *
 * So: the vocabularies the loader branches on are pinned HERE, against the migrations, and the numeric
 * helpers are executed rather than read. A vocabulary that changes under this file turns it red instead
 * of quietly re-scoring a screen.
 *
 *   npx --yes tsx scripts/pd-health-harness.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  p95, share, WINDOW_DAYS, HEALTH_SUBMODULES, PLANE_REFUSED,
  healthStateFor, overallHealth, CRITICAL_JOURNEYS,
} from "../src/lib/hq/pd-health";
import { PD_METRICS } from "../src/lib/hq/pd-metric-registry";
import { PRACTICE_ALLOWLIST } from "../src/lib/access/plane-boundary";

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

const LOADER = "src/lib/hq/pd-health.ts";
const loader = readFileSync(LOADER, "utf8");

/** Every migration, concatenated — the schema is the authority on a vocabulary, never a memory of it. */
const migrations = readdirSync("supabase/migrations")
  .filter(f => f.endsWith(".sql"))
  .map(f => readFileSync(`supabase/migrations/${f}`, "utf8"))
  .join("\n");

/** The `check (col in ('a','b'))` vocabulary declared for a column, as a set. */
function vocabulary(table: string, column: string): Set<string> {
  const create = new RegExp(`create table (?:if not exists )?${table}\\b[\\s\\S]*?\\n\\);`, "i").exec(migrations);
  if (!create) return new Set();
  const col = new RegExp(`\\b${column}\\b[\\s\\S]{0,200}?check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, "i").exec(create[0]);
  if (!col) return new Set();
  return new Set([...col[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
}

console.log("\nCPR-PD-008 PRODUCT HEALTH\n");

// ── the vocabularies the loader branches on ─────────────────────────────────
const aiStatus = vocabulary("plat_ai_requests", "status");
const jobStatus = vocabulary("plat_job_runs", "status");
const evSeverity = vocabulary("plat_platform_events", "severity");

ok("V0", aiStatus.size > 0 && jobStatus.size > 0 && evSeverity.size > 0,
  `control: all three vocabularies were parsed out of the migrations (ai=${aiStatus.size}, job=${jobStatus.size}, severity=${evSeverity.size}) — a parse that found nothing would pass every pin below`);

ok("V1", aiStatus.has("error") && aiStatus.has("refusal"),
  `plat_ai_requests.status holds the two values the loader filters on — {${[...aiStatus].join(", ")}}`);

ok("V2", !aiStatus.has("success"),
  "⚠ 'success' is NOT in that vocabulary — the exact assumption that scored 146 of 146 requests as failures. If this ever passes because the word was added, the loader's filter must be revisited, not this pin");

ok("V3", loader.includes('.eq("status", "error")') && loader.includes('.eq("status", "refusal")'),
  "the loader filters AI outcomes by those literal values rather than by a negation of a guessed success word");

ok("V4", jobStatus.has("failed") && jobStatus.has("running"),
  `plat_job_runs.status holds 'failed' and 'running' — {${[...jobStatus].join(", ")}}`);

ok("V5", evSeverity.has("critical") && evSeverity.has("warning") && !evSeverity.has("high"),
  `plat_platform_events.severity is {${[...evSeverity].join(", ")}} — and holds NO 'high', which an earlier version counted and which could only ever total zero`);

ok("V6", !/"high"/.test(loader),
  "the loader no longer mentions a 'high' severity anywhere");

// ── the plane ───────────────────────────────────────────────────────────────
const practiceReads = [...loader.matchAll(/\.from\("(practice_[a-z_]+)"\)/g)].map(m => m[1]);
ok("P1", practiceReads.length === 0,
  `the loader reads NO practice-plane table (found: ${practiceReads.join(", ") || "none"}) — every figure comes from the platform plane, so this module adds no allowlist surface`);

const refusedTables = PLANE_REFUSED.flatMap(r => r.tables);
const allowed = new Set(PRACTICE_ALLOWLIST.map(p => p.table));
const wronglyRefused = refusedTables.filter(t => allowed.has(t));
ok("P2", wronglyRefused.length === 0,
  `every table this module calls a REFUSED READ is genuinely absent from the practice allowlist (${refusedTables.length} checked)`);

ok("P3", refusedTables.length > 0,
  "control: the refusal list is not empty — P2 is a real check rather than a vacuous one over nothing");

// ── the registry gate ───────────────────────────────────────────────────────
const used = [...loader.matchAll(/figure\("([a-z_.]+)"/g)].map(m => m[1]);
const registered = new Set(PD_METRICS.map(m => m.metricId));
const unregistered = [...new Set(used)].filter(id => !registered.has(id));
ok("R1", unregistered.length === 0,
  `every metric id the loader gates on is registered (${new Set(used).size} distinct ids)${unregistered.length ? " — missing: " + unregistered.join(", ") : ""}`);

ok("R2", used.length > 0, `control: ${used.length} figure() calls were found — a regex that matched nothing would pass R1`);

const healthMetrics = PD_METRICS.filter(m => m.module === "health");
const absentNoSentence = healthMetrics.filter(m => m.producer === "absent" && !m.missing);
ok("R3", absentNoSentence.length === 0,
  `every absent health metric names the fact that does not exist (${healthMetrics.filter(m => m.producer === "absent").length} absences)`);

const rateNoHalves = healthMetrics.filter(m => m.producer === "derivable" && !(m.numerator && m.denominator));
ok("R4", rateNoHalves.length === 0,
  "every derivable health metric declares both a numerator and a denominator — a rate may not render without its base");

// ── the numeric helpers, EXECUTED ───────────────────────────────────────────
ok("N1", p95([]) === null,
  "⚠ p95 of an empty series is null, NOT 0 — a zero here renders as an excellent latency exactly when nothing was measured");

ok("N2", p95([1]) === 1 && p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) === 10 && p95([5, 1, 3]) === 5,
  "p95 is nearest-rank and sorts numerically (not lexically, which would rank 10 below 9)");

ok("N3", p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) === 19,
  "control: p95 of twenty ascending values is the 19th, so it is a percentile rather than a maximum");

ok("N4", share(1, 0) === null && share(null, 10) === null && share(5, null) === null,
  "share refuses a zero denominator and either half being unreadable, rather than returning 0 or Infinity");

ok("N5", share(1, 4) === 0.25, "control: share computes when both halves are real");

// ── the sample-truncation fact ──────────────────────────────────────────────
ok("S1", /truncated: [a-zA-Z]+\.length >= SAMPLE_CAP/.test(loader),
  "every sampled read carries whether it was truncated — PostgREST caps at 1000 rows, and a percentile over a truncated fetch presented as a window statistic is a silent lie");

ok("S2", /SampleNote/.test(readFileSync("src/app/super-admin/pd/health/page.tsx", "utf8")),
  "the overview renders that truncation fact rather than carrying it unused in the payload");

// ── the module surface ──────────────────────────────────────────────────────
const pages = readdirSync("src/app/super-admin/pd/health", { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== "_components").map(d => d.name);
const declared = HEALTH_SUBMODULES.map(s => s.key);
const undeclared = pages.filter(p => !declared.includes(p as (typeof declared)[number]));
const unbuilt = declared.filter(d => !pages.includes(d));
ok("M1", undeclared.length === 0 && unbuilt.length === 0,
  `the ten sub-surfaces on disk and the ten the overview advertises are the same set${undeclared.length ? " — undeclared: " + undeclared.join(", ") : ""}${unbuilt.length ? " — missing: " + unbuilt.join(", ") : ""}`);

const stubs = pages.filter(p => readFileSync(`src/app/super-admin/pd/health/${p}/page.tsx`, "utf8").includes("PdNotBuilt"));
ok("M2", stubs.length === 0, `no page in this module is still a placeholder (${pages.length + 1} pages)`);

const unguarded = [...pages, ""].filter(p => {
  const f = p ? `src/app/super-admin/pd/health/${p}/page.tsx` : "src/app/super-admin/pd/health/page.tsx";
  return !/await\s+requireHqCapability\(/.test(readFileSync(f, "utf8"));
});
ok("M3", unguarded.length === 0,
  `every page awaits its own capability guard — a layout check is not sufficient because layouts do not re-render on navigation${unguarded.length ? " — unguarded: " + unguarded.join(", ") : ""}`);

ok("M4", WINDOW_DAYS > 0 && new RegExp(`${WINDOW_DAYS} days`).test(readFileSync("src/app/super-admin/pd/health/_components/health-ui.tsx", "utf8")) === false,
  `control: the window (${WINDOW_DAYS} days) is passed to the header rather than hard-coded in the view, so one constant governs every page`);

// ── CPR-PD-008 §4 / §5 — THE STATE MODEL, EXECUTED ──────────────────────────
// ⚠ §4's hard rule is the one assertion on this whole module that a reader would most want to trust:
// "missing, stale, conflicting or unreadable evidence MUST NOT resolve to Healthy." It is checked by
// CALLING the function with each shape of missing evidence, not by reading the branch.
const NO_OBJECTIVE = null;
ok("H1", healthStateFor(null, NO_OBJECTIVE).state === "unknown",
  "§4 hard rule: no evidence at all resolves to Unknown");

ok("H2", healthStateFor({ state: "absent", why: "x" }, NO_OBJECTIVE).state === "unknown"
      && healthStateFor({ state: "unknown", why: "x" }, NO_OBJECTIVE).state === "unknown",
  "§4 hard rule: absent and unreadable evidence both resolve to Unknown, never Healthy");

ok("H3", healthStateFor({ state: "value", value: 1 }, NO_OBJECTIVE).state === "unknown",
  "⚠ §4: a REAL measurement with no configured objective still resolves to Unknown — Healthy means evidence MEETING an objective, and inventing the threshold is what §5 forbids as an implicit Healthy substitution");

ok("H4", healthStateFor({ state: "value", value: 1 },
      { threshold: 2, unit: "x", judge: (v, t) => (v < t ? "healthy" : "degraded") }).state === "healthy",
  "control: WITH an objective a real measurement does resolve — H3 is a missing-objective rule, not a function that can never return Healthy");

const gatingUnknown = [
  { key: "a", label: "Availability", question: "", href: "", coverage: "absent", state: "unknown", evidence: null, evidenceLabel: null, why: "", gating: true },
  { key: "b", label: "AI", question: "", href: "", coverage: "measured", state: "healthy", evidence: null, evidenceLabel: null, why: "", gating: false },
] as Parameters<typeof overallHealth>[0];
ok("G1", overallHealth(gatingUnknown).state === "unknown",
  "§5: one unknown GATING domain makes the overall state Unknown even while a non-gating domain is Healthy — an average would have returned Healthy here");

const gatingCritical = gatingUnknown.map(d => (d.gating ? { ...d, state: "critical" as const } : d));
ok("G2", overallHealth(gatingCritical).state === "critical",
  "§5: a Critical gating domain makes the overall state Critical");

const allHealthy = gatingUnknown.map(d => ({ ...d, state: "healthy" as const }));
ok("G3", overallHealth(allHealthy).state === "healthy",
  "control: with every gating domain healthy the overall state IS Healthy — G1 and G2 discriminate rather than always returning Unknown");

// ── §5's gating domains are the two the spec names ──────────────────────────
ok("G4", /key: "availability"[\s\S]{0,400}?true\)/.test(loader) || /"availability"[\s\S]{0,600}?, true,/.test(loader),
  "availability is declared a gating domain");

// ── §6 — ONE journey list, imported by both surfaces ────────────────────────
ok("J1", CRITICAL_JOURNEYS.length === 8,
  `§6 names eight critical journeys and the constant holds ${CRITICAL_JOURNEYS.length} — an earlier draft invented nine`);

const wf = readFileSync("src/app/super-admin/pd/health/workflows/page.tsx", "utf8");
const overview = readFileSync("src/app/super-admin/pd/health/page.tsx", "utf8");
// ⚠ THE INVARIANT IS "NOBODY AUTHORS A JOURNEY LIST", NOT "EVERYBODY IMPORTS THIS CONSTANT".
//
// This pin originally required both surfaces to import CRITICAL_JOURNEYS, and it went red the day
// Workflow Health started reading journeys from mos_journey — from the DATABASE, which is a stronger
// source than the TypeScript mirror, not a weaker one. The pin had encoded the mechanism instead of the
// rule it was protecting. Loosening it to green would have been wrong; so would keeping it and forcing
// the page back onto the constant. What matters is that no surface types a journey name of its own,
// because §7's event contract keys on journey_name and two spellings can never be aggregated.
//
// Two sanctioned sources: the TypeScript mirror (which phase 2's B1b pins equal to the database), or the
// database itself. Anything else is a third list.
const authorsOwnList = (src: string) =>
  /const\s+JOURNEYS\s*=/.test(src) || /"Sign in to Practice"|"Save Encounter"|"Patient Booking"/.test(src);
const sanctionedSource = (src: string) =>
  src.includes("CRITICAL_JOURNEYS") || src.includes("loadJourneyHealth");

ok("J2", !authorsOwnList(wf) && !authorsOwnList(overview)
      && sanctionedSource(wf) && sanctionedSource(overview),
  "⚠ neither surface authors a journey list — each takes one from the TypeScript mirror or from the database, and §7's contract keys on journey_name so two spellings could never be aggregated");

ok("J3", CRITICAL_JOURNEYS.every(j => j.outcome.length > 20),
  "every journey carries §6's minimum measurable outcome, which is what a build would start from");

// ── §11 / §12 — the commentary is behind the drawer ─────────────────────────
const drawerAt = overview.indexOf("<CoverageDrawer>");
// ⚠ THE RENDER SITE, NOT THE IMPORT. A first version searched for the bare symbol and found it on the
// import line at the top of the file, so the pin compared the drawer against line 5 and failed while the
// page was correct. A position check must anchor on where a thing is DRAWN.
const headlineAt = overview.indexOf("{HEALTH_HEADLINE_BODY}");
ok("C1", drawerAt > 0 && headlineAt > drawerAt,
  "⚠ §12: the schema/allowlist commentary sits INSIDE the coverage drawer, not in the first viewport — the spec asked for the move by name and this is the check that it happened");

ok("C2", overview.indexOf("<OverallHealth") < drawerAt && overview.indexOf("<NeedsAttention") < drawerAt
      && overview.indexOf("<JourneyRail") < drawerAt,
  "§12: the first viewport answers its three questions — is Practice healthy, what needs attention, are the critical journeys working — before any commentary");

console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
