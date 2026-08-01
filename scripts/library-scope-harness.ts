/**
 * Clinical Library search scope harness (migration 167).
 *
 * search_ckcm() runs through the SERVICE-ROLE client, which bypasses RLS, so its tenant filter is a
 * function argument rather than a database policy. That makes it exactly the kind of control that can be
 * removed by accident and stay green: the route still compiles, still returns 200, and simply starts
 * including other hospitals' governed content.
 *
 * WHAT THIS ASSERTS, AND WHY EACH ONE MATTERS:
 *
 *   1. p_hospital is MANDATORY. A 2-arg call must FAIL. If the old overload ever comes back, every caller
 *      that forgets the argument silently goes cross-tenant again; this is the only check that catches
 *      the regression at its source rather than at each call site.
 *   2. A tenant sees its own rows and shared rows, and NOT another tenant's.
 *   3. super_admin (explicit null) still sees everything — the fix must not break the landlord plane.
 *   4. A caller with NO hospital gets the nil uuid and sees shared content only, never everything. This is
 *      the case the original code got wrong twice: `hospitalId ?? null` reads as a safe default and means
 *      the opposite, because null is "unrestricted" in both search_ckcm and match_assets.
 *   5. The quality_object branch exists. Migration 019 added it and was never applied here, so library
 *      search silently returned no quality objects at all — a confident zero, which is the failure mode
 *      this codebase keeps hitting.
 *
 * VACUOUS ASSERTIONS ARE REPORTED AS VACUOUS. Three of the four tenant-owned tables are empty or entirely
 * shared today, so a cross-tenant check against them would pass without proving anything. The harness says
 * so per table instead of counting them as evidence — a green line with no data behind it is how an audit
 * reports clean while not looking.
 *
 *   npx --yes tsx scripts/library-scope-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const NONE = "00000000-0000-0000-0000-000000000000";
let pass = 0, fail = 0, vacuous = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const skip = (name: string, why: string) => { vacuous++; console.log(`  n/a   ${name} — ${why}`); };

const search = (q: string, pHospital: string | null, max = 50) =>
  admin.rpc("search_ckcm", { q, max_results: max, p_hospital: pHospital });

// The tenant-owned tables the function reads. The other three branches (cpu, competency, skill) read
// tables with no hospital_id and are shared master content by design, so they are not scoped.
const TENANT_TABLES: { type: string; table: string; titleCol: string }[] = [
  { type: "framework", table: "frameworks", titleCol: "name" },
  { type: "resource", table: "learning_resources", titleCol: "title" },
  { type: "policy", table: "policies", titleCol: "title" },
  { type: "quality_object", table: "quality_objects", titleCol: "title" },
];

const distinctiveWord = (title: string) =>
  String(title).split(/\s+/).filter(w => w.length > 3).sort((a, b) => b.length - a.length)[0];

async function main() {
  console.log("\nClinical Library search scope (migration 167)\n");

  // ── 1. The argument must be mandatory ────────────────────────────────────
  const legacy = await admin.rpc("search_ckcm", { q: "nursing", max_results: 5 });
  ok("2-arg search_ckcm is rejected (p_hospital is mandatory)", !!legacy.error,
    legacy.error ? "" : "the old unscoped overload still exists — every caller that omits p_hospital goes cross-tenant");

  const scopedCall = await search("nursing", null, 5);
  ok("3-arg search_ckcm resolves", !scopedCall.error, scopedCall.error?.message);
  if (scopedCall.error) { report(); return; }

  // ── 2/3/4. Tenant isolation, per table, with data behind it ──────────────
  const { data: hosp } = await admin.from("hospitals").select("id,name");
  const hospitals = (hosp ?? []) as any[];
  console.log(`\n  ${hospitals.length} hospital(s) on the platform\n`);

  for (const t of TENANT_TABLES) {
    const { data: rows, error } = await admin.from(t.table)
      .select(`id,${t.titleCol},hospital_id`).not("hospital_id", "is", null).limit(50);
    if (error) { skip(`${t.type}: tenant isolation`, `table unreadable (${error.message})`); continue; }

    const owned = (rows ?? []) as any[];
    if (!owned.length) { skip(`${t.type}: tenant isolation`, `no tenant-owned rows exist yet, so a cross-tenant check would prove nothing`); continue; }

    const target = owned.find(r => distinctiveWord(r[t.titleCol]));
    if (!target) { skip(`${t.type}: tenant isolation`, "no row with a searchable word in its title"); continue; }
    const word = distinctiveWord(target[t.titleCol]);
    const other = hospitals.find(h => h.id !== target.hospital_id);

    const mine = await search(word, target.hospital_id);
    ok(`${t.type}: owner sees its own row ("${word}")`,
      ((mine.data ?? []) as any[]).some(h => h.object_id === target.id));

    if (other) {
      const theirs = await search(word, other.id);
      ok(`${t.type}: another hospital does NOT see it`,
        !((theirs.data ?? []) as any[]).some(h => h.object_id === target.id),
        `"${target[t.titleCol]}" (owned by ${hospitals.find(h => h.id === target.hospital_id)?.name}) leaked to ${other.name}`);
    } else skip(`${t.type}: cross-tenant check`, "only one hospital on the platform");

    const nobody = await search(word, NONE);
    ok(`${t.type}: a caller with no hospital does NOT see it`,
      !((nobody.data ?? []) as any[]).some(h => h.object_id === target.id));

    const superUser = await search(word, null);
    ok(`${t.type}: super_admin (null) still sees it`,
      ((superUser.data ?? []) as any[]).some(h => h.object_id === target.id));
  }

  // ── Shared content must survive scoping ──────────────────────────────────
  const { data: sharedFw } = await admin.from("frameworks").select("id,name").is("hospital_id", null).eq("is_active", true).limit(1);
  const fw = (sharedFw ?? [])[0] as any;
  if (fw && distinctiveWord(fw.name)) {
    const w = distinctiveWord(fw.name);
    const asTenant = await search(w, hospitals[0]?.id ?? NONE);
    ok(`shared content is still returned to a scoped caller ("${w}")`,
      ((asTenant.data ?? []) as any[]).some(h => h.object_id === fw.id),
      "the tenant filter is excluding platform-shared rows, which would empty the library for everyone");
  } else skip("shared content is still returned", "no shared active framework with a searchable name");

  // ── 5. The branch migration 019 added and never applied ──────────────────
  const { data: qo } = await admin.from("quality_objects").select("id,title,hospital_id").neq("status", "retired").limit(50);
  const q1 = ((qo ?? []) as any[]).find(r => distinctiveWord(r.title));
  if (q1) {
    const res = await search(distinctiveWord(q1.title), q1.hospital_id ?? null);
    ok("quality_object branch exists (migration 019's redefinition is deployed)",
      ((res.data ?? []) as any[]).some(h => h.object_type === "quality_object"),
      "library search returns no quality objects at all — a confident zero, not an empty result");
  } else skip("quality_object branch exists", "no non-retired quality object with a searchable title");

  report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fail} failed, ${vacuous} not assertable on current data\n`);
  if (vacuous) console.log(`  The n/a lines are NOT passes. They are checks with no data behind them yet.\n`);
  if (fail) process.exit(1);
}

main();
