/**
 * Apply the numbered migration chain to a FRESH Supabase project, in order, stopping at the first
 * failure — COMP-ENG-002E §7.
 *
 * ⚠⚠ IT REFUSES TO RUN AGAINST PRODUCTION. The production project ref is read from .env.local and the
 * target connection string is checked against it before anything executes. This script replays 332
 * migrations; pointed at production that would be catastrophic. The guard is why it is safe to keep in
 * the repository at all.
 *
 * ⚠ IT STOPS AT THE FIRST FAILURE. COMP-ENG-002E §7: "preserve and report the failure before
 * remediation; failure is evidence." A runner that continued past an error would leave a half-built
 * database that looks finished — the outcome the whole fidelity gate exists to prevent.
 *
 * ⚠⚠ IT USES node-postgres DIRECTLY, NOT `supabase db query`, AND THAT IS NOT A PREFERENCE.
 *
 * The CLI sends a --file as a PREPARED statement, and Postgres refuses multi-statement input there:
 * "cannot insert multiple commands into a prepared statement". Every migration in this repo is many
 * statements, so the CLI route cannot work for any of them, in any pooler mode.
 *
 * The obvious workaround — split each file on `;` and send the pieces — is WRONG here and this
 * codebase already knows why: `scripts/migration-house-rules.ts` exists partly because a
 * semicolon-splitting runner cuts a plpgsql function body in half. Files carrying `$$ ... ; ... $$`
 * would be silently mangled. node-postgres's simple query protocol (a `query(text)` with no parameter
 * values) sends the file whole and lets Postgres parse it, which is exactly what the SQL editor does.
 *
 * SETUP — no access token, no CLI link, no IPv6:
 *   Put the SESSION pooler string (port 5432) in .env.local as STAGING_DB_URL, then:
 *     npx tsx scripts/apply-migrations.ts
 *     npx tsx scripts/apply-migrations.ts --from 200      resume after a failure
 */
import { loadEnvConfig } from "@next/env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

loadEnvConfig(process.cwd());

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const fromArg = process.argv.indexOf("--from");
const from = fromArg >= 0 ? Number(process.argv[fromArg + 1] ?? "0") : 0;

const dbUrl = process.env.STAGING_DB_URL ?? null;

if (!dbUrl) {
  console.error("\nSTAGING_DB_URL is not set.\n");
  console.error("  Add the SESSION pooler connection string (port 5432) to .env.local as one line:");
  console.error("    STAGING_DB_URL=postgresql://postgres.<ref>:<password>@<host>.pooler.supabase.com:5432/postgres\n");
  process.exit(1);
}

/**
 * ⚠ A STALE SHELL VARIABLE BEATS .env.local. loadEnvConfig does not overwrite a value already in the
 * environment, so a mistyped `$env:STAGING_DB_URL` silently overrides the file for the life of that
 * terminal — and the only symptom is a parse error against the FIRST migration, which reads like a
 * problem with that migration and is not one.
 */
if (!/^postgres(ql)?:\/\/\S+@\S+\/\S+/.test(dbUrl)) {
  console.error(`\n⛔ STAGING_DB_URL is not a Postgres connection string.\n`);
  console.error(`   got: ${dbUrl.replace(/:[^:@]*@/, ":****@").slice(0, 80)}\n`);
  console.error(`   ⚠ A SHELL VARIABLE OVERRIDES .env.local. If you set one earlier in this window:`);
  console.error(`       Remove-Item Env:STAGING_DB_URL -ErrorAction SilentlyContinue\n`);
  process.exit(1);
}

// ── The production guard ─────────────────────────────────────────────────────────────────────────
const prodRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  .match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
if (!prodRef) {
  console.error("\n⚠ Could not read the production ref from NEXT_PUBLIC_SUPABASE_URL, so the safety");
  console.error("  guard cannot run. Refusing rather than guessing.\n");
  process.exit(1);
}
if (dbUrl.includes(prodRef)) {
  console.error(`\n⛔ REFUSING TO RUN — STAGING_DB_URL points at PRODUCTION (${prodRef}).\n`);
  process.exit(1);
}

if (/:6543\//.test(dbUrl)) {
  console.error(`\n⛔ That is the TRANSACTION pooler (port 6543), which cannot run multi-statement SQL.`);
  console.error(`   Use the SESSION pooler — same host, port 5432.\n`);
  process.exit(1);
}

const files = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith(".sql"))
  .sort()
  .filter(f => Number(f.slice(0, 3)) >= from);

async function main() {
  const client = new Client({ connectionString: dbUrl!, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log(`\nApplying ${files.length} migration(s) via node-postgres`);
  console.log(`(production is ${prodRef} — guard passed)\n`);

  let applied = 0;
  for (const f of files) {
    process.stdout.write(`  ${f} ... `);
    try {
      // Simple query protocol: no parameter values, so the whole file is parsed by Postgres exactly
      // as the SQL editor would parse it. Function bodies survive intact.
      await client.query(readFileSync(join(MIGRATIONS, f), "utf8"));
      console.log("ok");
      applied++;
    } catch (err) {
      const e = err as { message?: string; position?: string; hint?: string };
      console.log("FAILED\n");
      console.log("─".repeat(70));
      console.log(`STOPPED AT: ${f}`);
      console.log(e.message ?? String(err));
      if (e.hint) console.log(`HINT: ${e.hint}`);
      console.log("─".repeat(70));
      console.log(`\n${applied} migration(s) applied before this one.`);
      console.log(`\n⚠ DO NOT REPAIR THIS IN THE DASHBOARD (COMP-ENG-002E §7). The failure is the`);
      console.log(`  evidence the clean-build test exists to produce. Record it, fix the migration in`);
      console.log(`  the repository, then resume with:`);
      console.log(`\n      npx tsx scripts/apply-migrations.ts --from ${f.slice(0, 3)}\n`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\n✓ All ${applied} migration(s) applied.`);
  console.log(`\nNext: run the fidelity manifest with the staging URL and service-role key:`);
  console.log(`  $env:FIDELITY_SUPABASE_URL = "https://<staging-ref>.supabase.co"`);
  console.log(`  $env:FIDELITY_SERVICE_ROLE_KEY = "<staging service_role key>"`);
  console.log(`  npx tsx scripts/fidelity-manifest.ts\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
