/**
 * Read-scope audit — which API reads could return another tenant's rows.
 *
 * WHY THIS IS NOT COVERED BY RLS. Row-level security protects the ANON/authenticated client. These routes
 * use the SERVICE-ROLE client (createAdminClient / c.admin), which bypasses RLS entirely by design — so
 * tenant scoping has to be explicit in the query. A missing `.eq("hospital_id", …)` is invisible: the route
 * compiles, returns 200, and quietly includes rows from every hospital.
 *
 * The tenant-scoping audit that ran earlier covered WRITE paths (subject-vs-caller hospital_id). This is the
 * read side of the same class.
 *
 * IT REPORTS CANDIDATES, NOT VERDICTS. Several categories are correctly unscoped and are separated out
 * rather than counted as findings:
 *   - the LANDLORD plane (platform operators legitimately see across tenants)
 *   - shared master data (frameworks, the competency library, design tokens)
 *   - personal data scoped by user_id instead of hospital_id — that IS scoping, just a different axis
 *
 * WHAT IT FOUND. /api/library ran the clinical-library full-text search through the service role with no
 * tenant argument at all, so any authenticated user of any hospital could search every other hospital's
 * governed content — including the first 300 characters of policy text — and the same call was used to
 * GROUND AI ANSWERS in /api/ai/assistant. Fixed by migration 167; regression-tested by
 * scripts/library-scope-harness.ts.
 *
 * THE TWO IT STILL REPORTS HAVE BEEN LOOKED AT AND ARE FINE. They stay reported rather than being
 * auto-explained, because the verdict belongs to the file's CURRENT contents: absolving them by pattern
 * would keep them silent after someone adds a tenant-table read to them.
 *   - /api/content/cpus/[cpuId]/config  staff-gated; reads assessment_blueprints + blueprint_methods,
 *                                       neither of which has a hospital_id (shared authored content).
 *   - /api/super-admin/users/hospitals  admin-gated; the hospitals id->name map, used for labels.
 *
 *   npx --yes tsx scripts/read-scope-audit.ts
 *   npx --yes tsx scripts/read-scope-audit.ts --all   include the explained categories
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const API = join(ROOT, "src/app/api");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/route\.ts$/.test(p)) out.push(p);
  }
  return out;
};

type Row = { path: string; reason: string };

function main() {
  const showAll = process.argv.includes("--all");
  const unscoped: Row[] = [];
  const explained: Row[] = [];
  let scanned = 0, reads = 0;

  for (const f of walk(API)) {
    scanned++;
    const src = readFileSync(f, "utf8");
    const path = "/" + relative(join(ROOT, "src/app"), f).replace(/\\/g, "/").replace(/\/route\.ts$/, "");

    if (!/export async function GET\b/.test(src)) continue;
    reads++;

    // Does it read through the service-role client at all?
    const usesAdmin = /createAdminClient|c\.admin|\badmin\s*\.from\(/.test(src);
    if (!usesAdmin) { explained.push({ path, reason: "no service-role read (RLS applies)" }); continue; }

    // Scoping, on any recognised axis.
    // Not just the column name: a route can scope by passing the tenant INTO a database function
    // (`p_hospital`) or by reading it off the caller (`c.hospitalId`). Matching only the snake_case column
    // re-flagged /api/library immediately after that route was fixed — the audit's own finding, reported
    // again as if nothing had happened.
    const byHospital = /hospital_id|p_hospital|hospitalId/.test(src);
    // User scoping is often a HELPER CALL, not an inline filter: `loadMyShift(c.admin, c.userId)` scopes
    // just as firmly as `.eq("user_id", …)`. Matching only the inline form reported four personal-data
    // routes as unscoped when the caller's own id is the first thing they pass.
    const byUser = /\.eq\(\s*["']user_id["']|\.eq\(\s*["']id["']\s*,\s*user\.id|auth\.uid|\b(?:c\.userId|user\.id)\b/.test(src);
    const landlord = /getLandlordCaller|landlordCan/.test(src);
    const superOnly = /isSuper\s*\(|["']super_admin["']/.test(src);

    // api-auth's assert* helpers ARE the scoping on routes that take an id from the caller — they resolve
    // the subject's hospital and reject out-of-scope before any read. Not knowing about them made the audit
    // report the cycle routes, which are among the most carefully scoped in the codebase.
    if (/assertRowScope|assertProfileScope|assertCycleScope|assertFrameworkScope|assertCompetencyScope|inScope\s*\(/.test(src)) {
      explained.push({ path, reason: "scoped via an api-auth assert* helper" }); continue;
    }
    // Machine callers. Cron routes authenticate with a shared secret and run FOR every tenant — being
    // cross-tenant is the job, not an oversight. The permission matrix already classifies these as the
    // `service` gate kind; this keeps the two tools agreeing.
    if (/CRON_SECRET|x-vercel-cron/i.test(src)) { explained.push({ path, reason: "machine-authenticated cron — cross-tenant by design" }); continue; }
    if (landlord) { explained.push({ path, reason: "landlord plane — cross-tenant by design" }); continue; }
    if (byHospital) { explained.push({ path, reason: "filters on hospital_id" }); continue; }
    if (byUser) { explained.push({ path, reason: "scoped by user, not tenant" }); continue; }
    if (superOnly && !/hasRole|isAdmin|isStaff|isEducator/.test(src)) {
      explained.push({ path, reason: "super-admin only" }); continue;
    }
    unscoped.push({ path, reason: "service-role read with no hospital_id, user or landlord scope" });
  }

  console.log(`\nAPI read-scope audit\n`);
  console.log(`  ${scanned} route file(s), ${reads} with a GET`);
  console.log(`  ${explained.length} explained, ${unscoped.length} to look at\n`);

  if (unscoped.length === 0) console.log(`  every service-role read is scoped, or explained.\n`);
  else {
    console.log(`  These read through the SERVICE-ROLE client with no tenant filter. Each needs a human`);
    console.log(`  decision: shared master data is fine, a tenant table is not.\n`);
    for (const r of unscoped) console.log(`    ${r.path}`);
    console.log();
  }

  if (showAll) {
    const byReason = new Map<string, number>();
    for (const e of explained) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
    console.log(`  Explained:`);
    for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${reason}`);
    console.log();
  }
}

main();
