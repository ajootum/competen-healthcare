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

  const exposed: string[] = [], indeterminate: string[] = [];
  let blocked = 0;

  for (const t of tables) {
    const priv = await count(admin, t);
    if (priv.err || !priv.n) { indeterminate.push(t); continue; }   // nothing to leak, or unreadable even to us
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

  console.log(`  ${blocked} table(s) with data are correctly closed to anon`);
  console.log(`  ${indeterminate.length} table(s) hold no rows, so exposure cannot be tested (NOT a pass)`);
  console.log(`  ${exposed.length} table(s) EXPOSED\n`);
  if (exposed.length) process.exit(1);
}

main();
