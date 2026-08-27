/**
 * Anon exposure harness — can a browser with no login read your tables?
 *
 * This is the end of the chain the other audits only reason about. read-scope-audit.ts reads code,
 * rls-drift-audit.ts compares the repo to pg_policy; this one asks the actual question, the way an actual
 * attacker would: it takes the PUBLIC anon key -- the one shipped in every page of the app -- and tries to
 * read every table in the public schema.
 *
 * It exists because reasoning was not enough. Thirteen tables were declared with RLS in the repo, and were
 * serving 838 rows of operational data to anyone who asked, for as long as migrations 108 and 109 had been
 * truncated. No code was wrong. No test failed. The declaration was simply never applied.
 *
 * NO ERROR DOES NOT MEAN EXPOSED. A table with RLS on and no policies answers an anon request with 0 rows
 * and no error, which looks identical to an empty table. So every verdict is a COMPARISON: the same count
 * is taken through the service role, and a table only counts as exposed when the service role sees rows
 * AND anon sees them too. Where the service role sees nothing, the check cannot conclude anything and says
 * so instead of passing.
 *
 *   npx --yes tsx scripts/anon-exposure-harness.ts
 *   npx --yes tsx scripts/anon-exposure-harness.ts --verbose   list every table checked
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { pagedRpc, capWarning } from "./_registry";
loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

const count = async (c: any, t: string): Promise<{ n: number | null; err: string | null }> => {
  const { count: n, error } = await c.from(t).select("*", { count: "exact", head: true });
  return { n: n ?? null, err: error ? (error.code || error.message) : null };
};

async function main() {
  const verbose = process.argv.includes("--verbose");
  console.log(`\nAnon exposure harness\n`);

  // PAGED. A single .rpc() returns at most 1000 rows and says nothing when it truncates. This registry
  // sits at 494 and is one large migration from the cap -- at which point this harness would quietly stop
  // probing the tables past it and still print a clean bill of health for the ones it reached. A security
  // check that silently narrows its own scope is worse than none, so the boundary case fails loudly.
  const reg = await pagedRpc<{ tbl: string; rls_enabled: boolean }>(admin, "plat_rls_registry", ["tbl", "policy_name"]);
  if (reg.error) { console.error(`  plat_rls_registry() unavailable (${reg.error}). Apply migration 172.\n`); process.exit(1); }
  if (reg.suspicious) { console.error(`  ABORTING -- ${capWarning(reg.rows.length)}\n`); process.exit(1); }
  const tables = [...new Set(reg.rows.map(r => r.tbl))].sort();
  const rlsOn = new Map<string, boolean>();
  for (const r of reg.rows) rlsOn.set(r.tbl, r.rls_enabled);

  console.log(`  ${tables.length} table(s) in the public schema, probed with the PUBLIC anon key\n`);

  const exposed: string[] = [];
  // ⚠ THE ANSWER WAS ALREADY IN HAND AND WAS BEING THROWN AWAY -- 2026-08-27.
  //
  // Every empty table used to land in one bucket, `indeterminate`, reported as "exposure cannot be tested
  // (NOT a pass)". That was honest about the PROBE -- anon and the service role both see zero rows whether
  // RLS is on or off -- and it was 364 of 671 tables, by far the largest blind spot in the estate.
  //
  // But plat_rls_registry was ALREADY being fetched, three lines up, into `rlsOn`, and its rls_enabled
  // column is the ground truth the probe cannot reach. It was used only to decorate an exposed table's
  // output line. The check reported "cannot verify" 364 times while holding the verification.
  //
  // !! AND THE TWO HALVES OF THAT BUCKET HAVE OPPOSITE SEVERITIES. An empty table with RLS ON is
  // protected -- deny-all to anon, service role bypassing, the posture CLAUDE.md records as load-bearing.
  // An empty table with RLS OFF is a table whose FIRST ROW is the exposure, which is exactly the argument
  // migration 360 made for re-asserting RLS on practice_checkout and practice_subscription: they are empty
  // only because no payment has completed, and the first real transaction would be the discovery.
  // Averaging those two into one word was the reporting failure.
  const emptyProtected: string[] = [], emptyUnprotected: string[] = [], unreadable: string[] = [];
  let blocked = 0;

  for (const t of tables) {
    const priv = await count(admin, t);
    if (priv.err) { unreadable.push(`${t} (${priv.err})`); continue; }  // unreadable even to us
    if (!priv.n) { (rlsOn.get(t) ? emptyProtected : emptyUnprotected).push(t); continue; }
    const pub = await count(anon, t);
    if (pub.err == null && (pub.n ?? 0) > 0) {
      exposed.push(`${t}  ${pub.n} of ${priv.n} row(s) readable, RLS ${rlsOn.get(t) ? "on" : "OFF"}`);
    } else {
      blocked++;
      if (verbose) console.log(`    ok   ${t.padEnd(34)} ${priv.n} row(s), anon ${pub.err ? `refused (${pub.err})` : "sees 0"}`);
    }
  }

  if (verbose) console.log();
  if (exposed.length) {
    console.log(`  EXPOSED — readable with no login at all (${exposed.length})`);
    console.log(`    these rows are served to anyone holding the anon key, which is in the browser bundle\n`);
    for (const e of exposed) console.log(`    ${e}`);
    console.log();
  }

  if (emptyUnprotected.length) {
    console.log(`  LATENT — empty, and RLS is OFF (${emptyUnprotected.length})`);
    console.log(`    nothing leaks today only because there is nothing in them. The first row written to`);
    console.log(`    any of these is readable by anyone holding the anon key.\n`);
    for (const t of emptyUnprotected) console.log(`    ${t}`);
    console.log();
  }

  // ⚠ THE CONTROL FOR THE REGISTRY LOOKUP. If plat_rls_registry ever returned rows without rls_enabled,
  // every table would read as unprotected -- loud, and correct to be loud. The opposite failure is the
  // dangerous one: a lookup that returns true for everything would silently mark all 671 verified. So the
  // counts are printed as a partition that must sum to the table total, which a broken lookup cannot fake.
  const accounted = blocked + emptyProtected.length + emptyUnprotected.length + unreadable.length + exposed.length;
  console.log(`  ${blocked} table(s) with data are correctly closed to anon`);
  console.log(`  ${emptyProtected.length} table(s) hold no rows, and RLS is ON -- protected by declaration, not by emptiness`);
  console.log(`  ${emptyUnprotected.length} table(s) hold no rows and RLS is OFF -- LATENT EXPOSURE`);
  if (unreadable.length) console.log(`  ${unreadable.length} table(s) unreadable even to the service role: ${unreadable.join(", ")}`);
  console.log(`  ${exposed.length} table(s) EXPOSED`);
  console.log(`  ${accounted} of ${tables.length} accounted for${accounted === tables.length ? "" : "  !! PARTITION DOES NOT SUM -- a table was counted twice or not at all"}\n`);
  if (exposed.length || emptyUnprotected.length || accounted !== tables.length) process.exit(1);
}

main();
