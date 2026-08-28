/**
 * DID THE MIGRATION ACTUALLY TAKE? — a post-apply check against the live database.
 *
 *   npx tsx scripts/migration-verify.ts supabase/migrations/360-close-anon-read-on-two-tables.sql
 *   npx tsx scripts/migration-verify.ts --recent 5
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * !! WHY THIS EXISTS. On 2026-08-27 two tables were found readable by the ANON key, serving a real
 * patient's diagnosis, medication and follow-up to anyone at all. Both migrations that created them --
 * 352 and 353 -- CONTAIN the correct `enable row level security` statement, target the right table,
 * and pass every house rule including the one that requires exactly that statement. Production had RLS
 * off anyway. The files were partially applied and nothing noticed for days.
 *
 * migration-house-rules.ts checks what a file SAYS before it is sent. This checks what the DATABASE DID
 * after it was applied. Those are different questions and only the second one is about production.
 *
 * !! A MIGRATION IN THE REPOSITORY IS NOT EVIDENCE OF A MIGRATION IN THE DATABASE. That sentence is the
 * whole reason for this file. Migrations here are applied BY HAND, in the SQL editor, by a person -- so
 * a half-paste, an editor that stops at an error, or a file edited after it was applied all produce a
 * repository that confidently disagrees with the database.
 *
 * !! WHAT IT CANNOT ANSWER, AND SAYS SO. An RLS claim is verified by asking the ANON key whether it can
 * read rows. For a table that HOLDS NO ROWS that returns the same empty answer whether RLS is on or
 * off -- so the check reports CANNOT VERIFY rather than a pass. Reporting those as verified would
 * quietly re-create the exact blind spot this file was written for.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from "node:module";
const require2 = createRequire(process.cwd() + "/");
const { loadEnvConfig } = require2("@next/env");
loadEnvConfig(process.cwd());

import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ⚠ --staging POINTS EVERY CHECK AT THE STAGING PROJECT, using the same STAGING_* variables the rest of
 * the estate's staging tooling reads. Added 2026-08-28, when staging turned out to be four migrations
 * behind and the gap had been masquerading as two separate product defects (both document harnesses were
 * reading through a select that names mig-357 columns staging lacks). This flag is both the measurement
 * that scoped that gap and the owner's post-apply verification once the files are run.
 *
 * ⚠ NO SILENT FALLBACK. If the staging variables are absent the run dies rather than quietly verifying
 * production while claiming to verify staging -- the same rule every staging-pointed script here follows.
 */
const STAGING_MODE = process.argv.includes("--staging");
const targetUrl = STAGING_MODE ? process.env.STAGING_SUPABASE_URL : process.env.NEXT_PUBLIC_SUPABASE_URL;
const targetSvcKey = STAGING_MODE ? process.env.STAGING_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetAnonKey = STAGING_MODE ? process.env.STAGING_ANON_KEY : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!targetUrl || !targetSvcKey || !targetAnonKey) {
  console.error(`\n  ${STAGING_MODE ? "STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE_KEY and STAGING_ANON_KEY" : "the Supabase variables"} must be set. Refusing to fall back.\n`);
  process.exit(1);
}

const svc = createClient(targetUrl, targetSvcKey, {
  auth: { persistSession: false },
});
const anon = createClient(targetUrl, targetAnonKey, {
  auth: { persistSession: false },
});

type Claim = { kind: "table" | "rls" | "column"; table: string; column?: string };

/** Strip `--` comments so prose describing a statement is never read as one. */
function codeOf(sql: string): string {
  return sql.split(/\r?\n/)
    .map(l => { const at = l.indexOf("--"); return at >= 0 && ((l.slice(0, at).match(/'/g) ?? []).length) % 2 === 0 ? l.slice(0, at) : l; })
    .join("\n");
}

function claimsOf(sql: string): Claim[] {
  const code = codeOf(sql);
  const out: Claim[] = [];
  const norm = (t: string) => t.replace(/^public\./, "").replace(/"/g, "").toLowerCase();
  for (const m of code.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi))
    out.push({ kind: "table", table: norm(m[1]) });
  for (const m of code.matchAll(/alter\s+table\s+([a-z0-9_."]+)\s+enable\s+row\s+level\s+security/gi))
    out.push({ kind: "rls", table: norm(m[1]) });
  for (const m of code.matchAll(/alter\s+table\s+([a-z0-9_."]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi))
    out.push({ kind: "column", table: norm(m[1]), column: m[2].toLowerCase() });
  return out;
}

let verified = 0, failed = 0, unknown = 0;
const problems: string[] = [];
const line = (state: string, what: string, detail = "") =>
  console.log(`  ${state.padEnd(14)} ${what.padEnd(52)} ${detail}`);

async function check(c: Claim) {
  if (c.kind === "table") {
    /**
     * ⚠ NEVER TEST EXISTENCE WITH head:true -- IT VERIFIED SIX MISSING TABLES (2026-08-28).
     *
     * An HTTP HEAD response carries no body, so when PostgREST refuses a request for a table that does
     * not exist, supabase-js has no error payload to parse and returns { count: null, error: null }.
     * This check read "no error" as "table exists" and reported `verified table practice_document_fact`
     * against a staging project whose own pg_catalog registry does not contain the table -- then the
     * RLS check below saw count null, called the table "empty", and printed CANNOT VERIFY for all six.
     * A verification tool inventing the very confidence it exists to test.
     *
     * A ranged select with limit(0) costs the same and carries a real error body.
     */
    const { error } = await svc.from(c.table).select("*").limit(0);
    if (error) { line("NOT APPLIED", `table ${c.table}`, error.message.slice(0, 40)); failed++; problems.push(`table ${c.table} does not exist`); }
    else { line("verified", `table ${c.table}`); verified++; }
    return;
  }

  if (c.kind === "column") {
    const { error } = await svc.from(c.table).select(c.column!).limit(1);
    if (error) { line("NOT APPLIED", `${c.table}.${c.column}`, error.message.slice(0, 40)); failed++; problems.push(`${c.table}.${c.column} is missing`); }
    else { line("verified", `${c.table}.${c.column}`); verified++; }
    return;
  }

  // RLS. The only observable through PostgREST is whether the anon key can read rows the service role
  // can see. That is a real test when rows exist and no test at all when they do not.
  // ⚠ Existence FIRST, with a body-carrying request -- the head-only version called six missing tables
  // "empty" (see the table check above). head:true is only trusted once the table is known to exist.
  const exists = await svc.from(c.table).select("*").limit(0);
  if (exists.error) { line("NOT APPLIED", `RLS on ${c.table}`, "table missing"); failed++; problems.push(`${c.table} does not exist`); return; }
  const s = await svc.from(c.table).select("*", { count: "exact", head: true });
  if (s.error) { line("NOT APPLIED", `RLS on ${c.table}`, "table missing"); failed++; problems.push(`${c.table} does not exist`); return; }
  if (!s.count) { line("CANNOT VERIFY", `RLS on ${c.table}`, "table is empty -- on and off look identical"); unknown++; return; }

  const a = await anon.from(c.table).select("*", { count: "exact", head: true });
  if (!a.error && (a.count ?? 0) > 0) {
    line("!! EXPOSED", `RLS on ${c.table}`, `anon reads ${a.count} of ${s.count} rows`);
    failed++;
    problems.push(`${c.table}: the migration says RLS is enabled and the anon key can read ${a.count} rows. It is NOT in force.`);
  } else {
    line("verified", `RLS on ${c.table}`, `anon reads 0 of ${s.count}`);
    verified++;
  }
}

async function main() {
  const recentIdx = process.argv.indexOf("--recent");
  const files = recentIdx >= 0
    ? readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort()
        .slice(-(Number(process.argv[recentIdx + 1]) || 5)).map(f => `supabase/migrations/${f}`)
    : process.argv.slice(2).filter(a => a.endsWith(".sql"));

  if (!files.length) {
    console.log("\n  usage: migration-verify.ts <file.sql> [...]   |   --recent <n>\n");
    process.exitCode = 1; return;
  }

  // The banner names the target, because a verification that does not say WHICH database it asked is a
  // verification of whichever one the reader assumes.
  console.log(`\nMigration verification against ${STAGING_MODE ? "STAGING" : "the DEFAULT (production)"} project ${new URL(targetUrl!).host.split(".")[0]}\n`);
  for (const f of files) {
    const claims = claimsOf(readFileSync(f, "utf8"));
    console.log(`  ${f.split(/[\\/]/).pop()}  (${claims.length} checkable claim${claims.length === 1 ? "" : "s"})`);
    for (const c of claims) await check(c);
    console.log("");
  }

  console.log(`  verified ${verified} | NOT APPLIED or EXPOSED ${failed} | cannot verify ${unknown}`);
  if (unknown) console.log(`  !! "cannot verify" is not a pass. An empty table reads the same with RLS on or off.`);
  if (problems.length) { console.log(""); problems.forEach((p, i) => console.log(`   ${i + 1}. ${p}`)); }
  console.log("");
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
