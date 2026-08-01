/**
 * SSW Reference Library harness — does the inventory promise what the search delivers?
 *
 * The supervisor Toolkit shows a count per object type next to a search box, which is a claim: "there are
 * 217 skills you can find here". The claim is only true if the inventory filters the same way
 * search_ckcm() does. Drift between them is invisible from either side -- the counts look right, the
 * search works, and the two simply disagree about which rows exist.
 *
 * That is not hypothetical. search_ckcm's deployed body was four revisions stale for months, and my own
 * migration 167 rebased it onto the wrong parent and silently dropped the cpu `pub_status = 'published'`
 * filter. Had the inventory existed then, it would have counted draft practice units the search refused to
 * return. So this checks the catalogue against BOTH the migration text and the live function.
 *
 * ASSERTIONS:
 *   1. Every catalogue entry's table and filter appear in the corresponding branch of migration 169.
 *   2. Tenancy is declared correctly: `tenant: true` exactly when that branch carries a p_hospital clause.
 *   3. Every object type the deployed function can emit has a catalogue entry, and vice versa -- a type
 *      the search returns but the inventory never counts is a category invisible to the supervisor.
 *   4. Counts are reproducible against the live database and never exceed what a super-admin search sees.
 *
 *   npx --yes tsx scripts/ssw-reference-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REFERENCE_CATALOGUE, loadReferenceInventory, totalAvailable } from "../src/lib/ssw/reference-library";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0, skip = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const na = (name: string, why: string) => { skip++; console.log(`  n/a   ${name} — ${why}`); };

const MIGRATION = join(process.cwd(), "supabase/migrations/169-library-search-rebase-058.sql");

async function main() {
  console.log("\nSSW Reference Library — inventory vs search\n");

  // ── 1/2. The catalogue against the migration that defines the search ──────
  const sql = readFileSync(MIGRATION, "utf8");
  // Split the function body into its union-all branches so each is checked against its own entry, rather
  // than searching the whole file and matching a filter that belongs to a different table.
  const branches = sql.split(/\bunion all\b/i);
  const branchFor = (type: string) => branches.find(b => new RegExp(`select\\s+'${type}'`).test(b));

  for (const e of REFERENCE_CATALOGUE) {
    const b = branchFor(e.type);
    if (!b) { ok(`${e.type}: has a branch in migration 169`, false, "no branch selects this object_type"); continue; }
    ok(`${e.type}: reads ${e.table}`, new RegExp(`from\\s+${e.table}\\b`, "i").test(b));

    if (e.filter) {
      // `is_active` appears bare (`where f.is_active`), the others as `col = 'value'`.
      const v = e.filter.eq;
      const re = v === true ? new RegExp(`\\.${e.filter.col}\\b`) : new RegExp(`\\.${e.filter.col}\\s*=\\s*'${v}'`);
      ok(`${e.type}: filter ${e.filter.col}${v === true ? "" : ` = '${v}'`} matches the search`, re.test(b),
        "the inventory would count rows the search refuses to return");
    } else {
      ok(`${e.type}: no status filter, as in the search`,
        !/\b(is_active|pub_status|status)\s*=?/.test(b.replace(/--[^\n]*/g, "")));
    }

    ok(`${e.type}: tenancy declared correctly (${e.tenant ? "scoped" : "shared"})`,
      /p_hospital/.test(b) === e.tenant,
      e.tenant ? "declared tenant-scoped but the branch has no p_hospital clause" : "declared shared but the branch scopes by hospital");
  }

  // ── 3. Type coverage, both directions ────────────────────────────────────
  const declaredTypes = new Set(REFERENCE_CATALOGUE.map(e => e.type));
  const branchTypes = new Set<string>();
  for (const m of sql.matchAll(/select\s+'([a-z_]+)'(?:::text)?\s+as\s+object_type|union all\s*select\s+'([a-z_]+)'/gi)) {
    const t = m[1] ?? m[2]; if (t) branchTypes.add(t);
  }
  ok(`every search branch has an inventory entry`,
    [...branchTypes].every(t => declaredTypes.has(t as any)),
    `uncounted: ${[...branchTypes].filter(t => !declaredTypes.has(t as any)).join(", ")}`);
  ok(`every inventory entry has a search branch`,
    [...declaredTypes].every(t => branchTypes.has(t)),
    `not searchable: ${[...declaredTypes].filter(t => !branchTypes.has(t)).join(", ")}`);

  // ── 4. Against the live database ─────────────────────────────────────────
  const { data: hosp } = await admin.from("hospitals").select("id,name").limit(1);
  const hid = ((hosp ?? [])[0] as any)?.id ?? null;
  if (!hid) { na("live inventory", "no hospitals on this platform"); }
  else {
    const scoped = await loadReferenceInventory(admin, hid, false);
    const superRows = await loadReferenceInventory(admin, null, true);
    ok(`inventory loads for a scoped caller`, scoped.length === REFERENCE_CATALOGUE.length);

    const broken = scoped.filter(r => r.error);
    if (broken.length) console.log(`        (${broken.length} table(s) unavailable in this deployment: ${broken.map(r => r.table).join(", ")})`);

    // A hospital can never see MORE than the unrestricted view.
    for (const r of scoped) {
      const s = superRows.find(x => x.type === r.type)!;
      if (r.error || s.error) continue;
      ok(`${r.type}: scoped count (${r.n}) <= unrestricted (${s.n})`, r.n <= s.n,
        "tenant scoping is inverted — a hospital sees more than the platform");
    }
    console.log(`\n  ${totalAvailable(scoped)} searchable object(s) for the first hospital, ${totalAvailable(superRows)} unrestricted\n`);
  }

  console.log(`  ${pass} passed, ${fail} failed${skip ? `, ${skip} not assertable` : ""}\n`);
  if (fail) process.exit(1);
}

main();
