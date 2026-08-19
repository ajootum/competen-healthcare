/**
 * Run the Playwright smoke suite against a STAGING-pointed app — COMP-ENG-002G §4/§5.
 *
 * ⚠ WHY THIS IS NOT JUST `npx playwright test`. The smoke helper's production guard reads
 * NEXT_PUBLIC_SUPABASE_URL, and from a plain shell that resolves out of .env.local — which names
 * PRODUCTION. So the suite correctly REFUSES, and the only way to run it was to remap three variables
 * by hand in the shell first. A control that is right but tedious to satisfy gets satisfied wrongly:
 * somebody eventually exports the production values because that is what makes the red go away.
 *
 * This applies the SAME remapping scripts/dev-staging.mjs applies to the server, so the browser, the
 * server and the guard all agree about which project is under test.
 *
 * ⚠ IT DOES NOT START A SERVER. Run `npm run dev:staging` in another shell first. Starting one here
 * would hide which project the server is pointed at behind a script the reader did not watch, and the
 * whole point of these two files is that the answer is never hidden.
 *
 *   npm run dev:staging          (shell 1)
 *   npm run smoke:staging        (shell 2)  -- extra args are passed through
 */
import nextEnv from "@next/env";
import { spawn } from "node:child_process";
import { join } from "node:path";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.STAGING_SUPABASE_URL;
const anon = process.env.STAGING_ANON_KEY;
const service = process.env.STAGING_SERVICE_ROLE_KEY;

const missing = [
  !url && "STAGING_SUPABASE_URL",
  !anon && "STAGING_ANON_KEY",
  !service && "STAGING_SERVICE_ROLE_KEY",
].filter(Boolean);

if (missing.length) {
  console.error(`\n⛔ Cannot run staging smoke — missing: ${missing.join(", ")}\n`);
  console.error(`   Add them to .env.local, which is gitignored. STAGING_ANON_KEY is the PUBLIC key:`);
  console.error(`   Settings, API Keys, the row marked anon or publishable.\n`);
  process.exit(1);
}

const prodRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
const stagingRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
if (!stagingRef) { console.error(`\n⛔ STAGING_SUPABASE_URL is not a project URL: ${url}\n`); process.exit(1); }
if (prodRef && stagingRef === prodRef) {
  console.error(`\n⛔ STAGING_SUPABASE_URL resolves to PRODUCTION (${prodRef}). Refusing.\n`);
  process.exit(1);
}

const passthrough = process.argv.slice(2);
// Same reason as dev-staging.mjs: Node refuses to spawn npx.cmd without a shell (EINVAL), and
// shell: true would put credential-adjacent arguments back through shell quoting. The local CLI is a
// plain JS file, so it runs under this Node directly.
const playwrightCli = join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
const args = [playwrightCli, "test", ...(passthrough.length ? passthrough : ["e2e/smoke"]), "--workers=1"];

console.log(`\nSmoke against STAGING (${stagingRef}). Production is ${prodRef ?? "unknown"} and is not used.\n`);

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    // Pinned to the staging server dev-staging.mjs starts. Defaulting to 3000 pointed the suite at the
    // ordinary production-facing dev server whenever staging had fallen back to another port.
    PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
  },
});
child.on("exit", code => process.exit(code ?? 0));
