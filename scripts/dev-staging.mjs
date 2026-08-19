/**
 * Run the Next dev server against STAGING — COMP-ENG-002G §4.
 *
 * ⚠ WHY THIS EXISTS. `.env.local` names the PRODUCTION project in NEXT_PUBLIC_SUPABASE_URL, because
 * that is what ordinary development points at. The synthetic practitioner exists only in staging, so an
 * authenticated smoke run against the ordinary dev server would try to sign in to production — where
 * the account does not exist, must not exist, and where the standing instruction on this project is
 * that authenticated smoke never connects at all.
 *
 * ⚠ IT REMAPS, IT DOES NOT DUPLICATE. The staging values live once, under their own STAGING_* names.
 * Keeping a second copy under the NEXT_PUBLIC_* names in some other file is how the two drift and how
 * somebody eventually runs the "staging" server against production without noticing.
 *
 * §4 "Staging URL/client key — staging environment contract only". Nothing here reads a production
 * value; the production names are OVERWRITTEN in the child process, never merged.
 *
 *   npm run dev:staging          then, from a second shell:  npx playwright test e2e/smoke --workers=1
 *
 * The smoke helper's own production guard reads NEXT_PUBLIC_SUPABASE_URL, so run Playwright from a
 * shell where the same remapping applies — or simply from the repo root, where it reads .env.local and
 * would see production and REFUSE, which is the safe direction to fail.
 */
// @next/env is CommonJS, so a named import fails under .mjs — default-import and destructure.
import nextEnv from "@next/env";
import { spawn } from "node:child_process";

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
  console.error(`\n⛔ Cannot start a staging dev server — missing: ${missing.join(", ")}\n`);
  console.error(`   Add them to .env.local, which is gitignored:\n`);
  console.error(`     STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co`);
  console.error(`     STAGING_ANON_KEY=<the STAGING anon / publishable key>`);
  console.error(`     STAGING_SERVICE_ROLE_KEY=<the STAGING service_role key>\n`);
  console.error(`   The anon key is the PUBLIC one — Settings, API Keys, the row marked anon or`);
  console.error(`   publishable. It is shipped to browsers by design and is not the service_role key.\n`);
  process.exit(1);
}

const prodRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
const stagingRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
if (!stagingRef) {
  console.error(`\n⛔ STAGING_SUPABASE_URL is not a project URL: ${url}\n   want: https://<ref>.supabase.co\n`);
  process.exit(1);
}
if (prodRef && stagingRef === prodRef) {
  console.error(`\n⛔ STAGING_SUPABASE_URL resolves to the PRODUCTION project (${prodRef}). Refusing.\n`);
  process.exit(1);
}

console.log(`\nStarting the dev server against STAGING (${stagingRef}).`);
console.log(`Production is ${prodRef ?? "unknown"} and is not used by this process.\n`);

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
  },
});
child.on("exit", code => process.exit(code ?? 0));
