/**
 * Blanket-policy harness: the latent tenant leak.
 *
 * WHAT THIS IS ABOUT. A few tables carry a SELECT policy whose whole predicate is
 * `auth.role() = 'authenticated'` -- any logged-in user on the platform reads every row. That was left in
 * place deliberately: `hospitals` is the signup and facility picker, `frameworks` and `framework_domains`
 * are the competency library, and narrowing them risks breaking flows that have to work before a user has
 * a tenant at all. Policies are OR'd, so a blanket one also makes every scoped policy beside it redundant
 * -- `hospitals` has three admin policies that currently decide nothing.
 *
 * THAT DECISION IS SAFE ONLY WHILE THOSE TABLES HOLD NO TENANT-OWNED ROWS, and nothing enforced it.
 * `frameworks` HAS a hospital_id column; every row in it today is shared master content, so the blanket
 * read gives away nothing. The moment a hospital authors its own framework, that row becomes readable by
 * every authenticated user on the platform -- a competitor's competency model, visible to anyone with a
 * login. Nothing would error. No test would fail. The leak switches itself on.
 *
 * So this asserts the CONDITION the decision rests on, rather than pretending the policy is fine or
 * rewriting flows that work. If it ever fails, the answer is not to delete this check: it is to scope the
 * policy, which by then is worth the risk because there is finally something behind it to protect.
 *
 * WHY IT CHECKS REACHABILITY TOO. A policy only matters on a table the USER client actually touches --
 * everything else goes through the service role, which bypasses RLS entirely. scripts/client-usage-audit.ts
 * found eleven such tables; all three tables here are among them, so these policies are live, not dead
 * config.
 *
 *   npx --yes tsx scripts/blanket-policy-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

// A predicate that grants every logged-in user every row. Matched on the normalised text Postgres stores,
// which is why the cast is included -- pg_get_expr renders it as ('authenticated'::text).
const BLANKET = /^\(?auth\.role\(\) = 'authenticated'::text\)?$/;

async function main() {
  console.log("\nBlanket-policy harness -- tables any logged-in user can read in full\n");

  const { data: reg, error } = await admin.rpc("plat_rls_registry");
  if (error) { console.error(`  plat_rls_registry unavailable: ${error.message} (migration 172 applied?)`); process.exit(1); }

  const rows = (reg ?? []) as { tbl: string; policy_name: string | null; cmd: string; qual: string | null }[];
  const blanket = [...new Set(
    rows.filter(r => r.policy_name && r.cmd === "SELECT" && BLANKET.test(String(r.qual ?? "").trim())).map(r => r.tbl),
  )].sort();

  // Not a fixed list: a blanket policy added to a new table is picked up automatically, which is the point.
  ok("the registry is readable and returned policies", rows.length > 0, `${rows.length} rows`);

  // CONTROL. Every table below currently answers "zero tenant-owned rows", and a check that can only ever
  // say zero is worth nothing -- a confident zero from a broken query is the exact failure this codebase
  // keeps hitting. So the same count is run against a table known to hold tenant rows. If the filter
  // syntax breaks or the column name changes, this goes to zero and says so, instead of every table
  // quietly passing.
  const { count: control, error: cErr } = await admin
    .from("departments").select("hospital_id", { count: "exact", head: true }).not("hospital_id", "is", null);
  ok("control: the tenant-row count returns non-zero where rows exist (departments)",
    !cErr && (control ?? 0) > 0,
    cErr ? cErr.message : `counted ${control} -- if this is 0 the check below proves nothing`);

  console.log(`\n  ${blanket.length} table(s) with a blanket authenticated SELECT: ${blanket.join(", ") || "(none)"}\n`);

  for (const tbl of blanket) {
    // Does it even have a tenant column? If not, there is nothing tenant-owned to leak.
    const probe = await admin.from(tbl).select("hospital_id").limit(1);
    if (probe.error) {
      // 42703 = undefined column. Anything else is a real problem worth seeing.
      const noColumn = /column .* does not exist|42703/i.test(probe.error.message);
      if (noColumn) { console.log(`  n/a   ${tbl}: no hospital_id column, nothing tenant-owned to expose`); continue; }
      ok(`${tbl}: probe succeeded`, false, probe.error.message);
      continue;
    }

    const { count, error: cErr } = await admin
      .from(tbl).select("hospital_id", { count: "exact", head: true }).not("hospital_id", "is", null);
    if (cErr) { ok(`${tbl}: tenant-owned row count`, false, cErr.message); continue; }

    ok(`${tbl}: holds no tenant-owned rows, so the blanket read gives nothing away`, (count ?? 0) === 0,
      `${count} row(s) carry a hospital_id and are readable by EVERY authenticated user on the platform -- `
      + `scope this policy now`);
  }

  // The redundancy is worth stating out loud: someone reading the migrations sees three scoped admin
  // policies on hospitals and reasonably concludes hospitals is scoped. It is not.
  const shadowed = rows.filter(r => r.tbl === "hospitals" && r.policy_name && r.cmd === "SELECT").length - 1;
  if (shadowed > 0) {
    console.log(`\n  NOTE  hospitals has ${shadowed} scoped SELECT policy(ies) that decide nothing while the`);
    console.log(`        blanket one stands -- policies are OR'd. They are not a second line of defence.`);
  }

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
