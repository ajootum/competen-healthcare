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
 * Requires `npx supabase login` first (the CLI authenticates via the Management API, so no database
 * password or psql install is needed).
 *
 *   npx tsx scripts/apply-migrations.ts --project-ref <STAGING_REF>
 *   npx tsx scripts/apply-migrations.ts --project-ref <REF> --from 200   resume after a failure
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

if (!target) {
  console.error("\nusage: npx tsx scripts/apply-migrations.ts --project-ref <STAGING_REF> [--from NNN]\n");
  process.exit(1);
}

// ── The production guard ──────────────────────────────────────────────────────────────────────────
const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const prodRef = prodUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
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

console.log(`\nApplying ${files.length} migration(s) to project ${target}`);
console.log(`(production is ${prodRef} — guard passed)\n`);

let applied = 0;
for (const f of files) {
  process.stdout.write(`  ${f} ... `);
  try {
    execFileSync("npx", ["supabase", "db", "query", "--project-ref", target, "--file", join(MIGRATIONS, f)],
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
    console.log(`\n      npx tsx scripts/apply-migrations.ts --project-ref ${target} --from ${f.slice(0, 3)}\n`);
    process.exit(1);
  }
}

console.log(`\n✓ All ${applied} migration(s) applied.`);
console.log(`\nNext: npx tsx scripts/fidelity-manifest.ts  (with FIDELITY_SUPABASE_URL and`);
console.log(`      FIDELITY_SERVICE_ROLE_KEY set to the staging project)\n`);
