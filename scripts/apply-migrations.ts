/**
 * Apply the numbered migration chain to a FRESH Supabase project, in order, stopping at the first
 * failure — COMP-ENG-002E §7.
 *
 * ⚠⚠ IT REFUSES TO RUN AGAINST PRODUCTION. The production project ref is read from .env.local and the
 * target is compared against it before anything executes. This script exists to build a clean staging
 * environment; pointed at production it would replay 329 migrations over a live estate. The guard is
 * not a convenience, it is the reason the script is safe to have in the repository at all.
 *
 * ⚠ IT STOPS AT THE FIRST FAILURE AND DOES NOT CONTINUE. §7: "If the clean build fails or produces
 * unexpected state, preserve and report the failure before remediation; failure is evidence." A runner
 * that skipped past errors would produce a half-built database that looks finished, which is precisely
 * the outcome the fidelity gate exists to prevent.
 *
 * PREFERRED ROUTE -- no access token, no CLI link, works on an IPv4-only network:
 *   $env:STAGING_DB_URL = "<session pooler connection string from Settings > Database>"
 *   npx tsx scripts/apply-migrations.ts
 *   npx tsx scripts/apply-migrations.ts --from 200      resume after a failure
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

loadEnvConfig(process.cwd());

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const target = arg("project-ref");
const from = Number(arg("from") ?? "0");

/**
 * ⚠ THE POOLER ROUTE, AND WHY IT IS PREFERRED.
 *
 * `--project-ref` needs `--linked`, and `supabase link` needs project-metadata read on the access
 * token plus a direct database connection — which Supabase serves over IPv6 only. On an IPv4-only
 * network that fails outright, and widening the token to fix it means granting a HIGH RISK
 * "Project Settings" scope purely so the CLI can read metadata it does not need to run SQL.
 *
 * STAGING_DB_URL avoids all of it: the pooler host is IPv4, the password authenticates the
 * connection, and no access token is involved. Fewer privileges, fewer moving parts.
 *
 * ⚠ IT IS READ FROM THE ENVIRONMENT, NEVER A FLAG. A connection string carries the database
 * password, and a flag would put it in shell history and in the process list.
 */
const dbUrl = process.env.STAGING_DB_URL ?? null;

if (!target && !dbUrl) {
  console.error("\nusage:");
  console.error("  $env:STAGING_DB_URL = '<session pooler connection string>'   # preferred");
  console.error("  npx tsx scripts/apply-migrations.ts [--from NNN]\n");
  console.error("  ...or, if the CLI is linked and the token can read project metadata:");
  console.error("  npx tsx scripts/apply-migrations.ts --project-ref <STAGING_REF> [--from NNN]\n");
  process.exit(1);
}

// ── The production guard ──────────────────────────────────────────────────────────────────────────
const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const prodRef = prodUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
// The guard covers BOTH routes: a connection string embeds the project ref too, so a pooler URL
// pointed at production is caught exactly like a --project-ref would be.
if (prodRef && dbUrl && dbUrl.includes(prodRef)) {
  console.error(`\n⛔ REFUSING TO RUN.\n`);
  console.error(`   STAGING_DB_URL contains the PRODUCTION project ref (${prodRef}).`);
  console.error(`   This script replays the whole migration chain and is only for a FRESH staging`);
  console.error(`   project.\n`);
  process.exit(1);
}
if (prodRef && target === prodRef) {
  console.error(`\n⛔ REFUSING TO RUN.\n`);
  console.error(`   --project-ref ${target} is the PRODUCTION project named in .env.local.`);
  console.error(`   This script replays the whole migration chain and is only for a FRESH staging`);
  console.error(`   project. Production migrations are applied by hand, one file at a time, by the`);
  console.error(`   repository owner.\n`);
  process.exit(1);
}
if (!prodRef) {
  console.error("\n⚠ Could not determine the production project ref from NEXT_PUBLIC_SUPABASE_URL, so the");
  console.error("  safety guard cannot run. Refusing rather than guessing.\n");
  process.exit(1);
}

const files = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith(".sql"))
  .sort()
  .filter(f => Number(f.slice(0, 3)) >= from);

const route = dbUrl
  ? ["--db-url", dbUrl]
  : ["--linked", "--project-ref", target!];

console.log(`\nApplying ${files.length} migration(s)`);
console.log(`route: ${dbUrl ? "STAGING_DB_URL (pooler)" : `--linked --project-ref ${target}`}`);
console.log(`(production is ${prodRef} — guard passed)\n`);

let applied = 0;
for (const f of files) {
  process.stdout.write(`  ${f} ... `);
  try {
    // ⚠ --linked IS REQUIRED ALONGSIDE --project-ref. The CLI refuses --project-ref on its own:
    // "only applies when targeting the linked project; use it with --linked". --linked selects the
    // Management API path (rather than --local or --db-url), and --project-ref says which project.
    execFileSync("npx", ["supabase", "db", "query", ...route, "--file", join(MIGRATIONS, f)],
      { cwd: ROOT, stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
    console.log("ok");
    applied++;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    console.log("FAILED\n");
    console.log("─".repeat(70));
    console.log(`STOPPED AT: ${f}`);
    console.log((e.stderr || e.stdout || String(err)).trim().slice(0, 2000));
    console.log("─".repeat(70));
    console.log(`\n${applied} migration(s) applied before this one.`);
    console.log(`\n⚠ DO NOT REPAIR THIS IN THE DASHBOARD (COMP-ENG-002E §7). The failure is the`);
    console.log(`  evidence the clean-build test exists to produce. Record it, fix the migration in`);
    console.log(`  the repository, then resume with:`);
    console.log(`\n      npx tsx scripts/apply-migrations.ts --from ${f.slice(0, 3)}\n`);
    process.exit(1);
  }
}

console.log(`\n✓ All ${applied} migration(s) applied.`);
console.log(`\nNext: npx tsx scripts/fidelity-manifest.ts  (with FIDELITY_SUPABASE_URL and`);
console.log(`      FIDELITY_SERVICE_ROLE_KEY set to the staging project)\n`);
