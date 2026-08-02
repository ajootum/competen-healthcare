/**
 * Clinical Library search scope harness (migrations 167, 169 and 186).
 *
 * Covers BOTH halves of hybrid search -- search_ckcm (keyword) and match_assets (semantic) -- because
 * they share one inverted convention: p_hospital = null means UNRESTRICTED. Scoping one and not the
 * other is how a single result set came to mix a scoped and an unscoped source.
 *
 * search_ckcm() runs through the SERVICE-ROLE client, which bypasses RLS, so its tenant filter is a
 * function argument rather than a database policy. That makes it exactly the kind of control that can be
 * removed by accident and stay green: the route still compiles, still returns 200, and simply starts
 * including other hospitals' governed content.
 *
 * WHAT THIS ASSERTS, AND WHY EACH ONE MATTERS:
 *
 *   1. p_hospital is MANDATORY, in BOTH functions. A call that omits it must FAIL. If a permissive
 *      overload ever comes back, every caller that forgets the argument silently goes cross-tenant
 *      again; this is the only check that catches the regression at its source rather than at each call
 *      site. match_assets kept `default null` until migration 186 and was the last live instance.
 *   2. A tenant sees its own rows and shared rows, and NOT another tenant's.
 *   3. super_admin (explicit null) still sees everything — the fix must not break the landlord plane.
 *   4. A caller with NO hospital gets the nil uuid and sees shared content only, never everything. This is
 *      the case the original code got wrong twice: `hospitalId ?? null` reads as a safe default and means
 *      the opposite, because null is "unrestricted" in both search_ckcm and match_assets.
 *   5. The quality_object branch exists. Migration 019 added it and was never applied here, so library
 *      search silently returned no quality objects at all — a confident zero, which is the failure mode
 *      this codebase keeps hitting.
 *   6. Unapproved content stays out. Migration 058 filters drafts and retired assets out of the results
 *      because they feed the AI grounding context. Migration 167 rebased the body onto migration 019 —
 *      four revisions stale — and silently reverted every one of those filters plus two whole branches.
 *      Migration 169 restored them. That regression passed tsc, eslint, and this harness as it then
 *      stood, which is the argument for asserting it behaviourally rather than trusting a migration
 *      header. scripts/function-drift-audit.ts is the other half: it compares the deployed body against
 *      the last definition in the repo, and is what found the mistake.
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
  console.log("\nClinical Library search scope (migrations 167, 169, 186)\n");

  // ── 1. The argument must be mandatory ────────────────────────────────────
  const legacy = await admin.rpc("search_ckcm", { q: "nursing", max_results: 5 });
  ok("2-arg search_ckcm is rejected (p_hospital is mandatory)", !!legacy.error,
    legacy.error ? "" : "the old unscoped overload still exists — every caller that omits p_hospital goes cross-tenant");

  const scopedCall = await search("nursing", null, 5);
  ok("3-arg search_ckcm resolves", !scopedCall.error, scopedCall.error?.message);
  if (scopedCall.error) { report(); return; }

  // ── 1b. THE SAME RULE FOR match_assets (migration 186) ───────────────────
  //
  // The other half of hybrid search. It shares search_ckcm's inverted convention -- p_hospital = null
  // means UNRESTRICTED -- and until 186 it kept `default null`, so it was the last place a caller could
  // omit the tenant argument and quietly get every hospital. Semantic hits feed the AI grounding context
  // exactly as keyword hits do, so the blast radius was the same.
  //
  // A dummy embedding is enough: this asserts which OVERLOAD resolves, not what comes back. Anything
  // other than "function not found" means the permissive signature is still callable.
  const DUMMY = JSON.stringify(new Array(1536).fill(0));
  const looseAssets = await admin.rpc("match_assets", { query_embedding: DUMMY, match_count: 1 });
  ok("2-arg match_assets is rejected (p_hospital is mandatory)", !!looseAssets.error,
    looseAssets.error ? "" : "the permissive overload still exists -- a caller that omits p_hospital goes cross-tenant");

  const scopedAssets = await admin.rpc("match_assets", { query_embedding: DUMMY, p_hospital: NONE, match_count: 1 });
  ok("3-arg match_assets resolves", !scopedAssets.error, scopedAssets.error?.message);

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

  // ── 6. Approval filters (migration 058, reverted by 167, restored by 169) ─
  // Tenant scope is not the only thing this function has to get right. 058 exists to keep DRAFT and
  // RETIRED assets out of the results, because they feed the AI grounding context. Migration 167 rebased
  // the body onto the wrong parent and silently dropped every one of those filters; nothing behavioural
  // caught it, which is why it is asserted here and not just described in a migration header.
  const { data: draftCpu } = await admin.from("clinical_practice_units")
    .select("id,name,pub_status").neq("pub_status", "published").limit(1);
  const dc = (draftCpu ?? [])[0] as any;
  if (dc && distinctiveWord(dc.name)) {
    const w = distinctiveWord(dc.name);
    const res = await search(w, null);
    ok(`approval filter: a ${dc.pub_status} CPU is NOT returned ("${w}")`,
      !((res.data ?? []) as any[]).some(h => h.object_id === dc.id),
      "unapproved content is reaching search results and the AI grounding context");
  } else skip("approval filter: unapproved CPU excluded", "no non-published CPU with a searchable name");

  for (const [label, table, col, approved] of [
    ["skill", "competency_skills", "is_active", true],
    ["quality_object", "quality_objects", "status", "active"],
    ["resource", "learning_resources", "is_active", true],
  ] as const) {
    const { data } = await admin.from(table).select("id").neq(col, approved as any).limit(1);
    if (!(data ?? []).length) skip(`approval filter: unapproved ${label} excluded`, `every row is approved, so the filter cannot be exercised`);
  }

  // ── 5. The branch migration 019 added and never applied ──────────────────
  const { data: qo } = await admin.from("quality_objects").select("id,title,hospital_id").eq("status", "active").limit(50);
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
