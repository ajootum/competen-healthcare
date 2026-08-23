// Verifies migration 348 (booking pages adopt the claimed handle).
//
// "Success. No rows returned" is what the SQL editor prints for an UPDATE that matched FIFTY rows and for
// one that matched NONE -- identically. A backfill is exactly the migration where that ambiguity matters,
// because a no-op looks like a success and the symptom it was meant to cure is invisible from the editor.
// So this reconstructs what 348 SHOULD have done and compares it to what is there.
// Run: node scripts/verify-handle-backfill.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let bad = 0;
const ok = (s) => console.log(`  OK    ${s}`);
const fail = (s, why) => { bad++; console.log(`  FAIL  ${s}\n        ${why}`); };

console.log("MIGRATION 348 - booking pages adopt the claimed handle\n");

const pages = await db.from("practice_booking_access").select("workspace_id, handle");
const ids = await db.from("practice_practitioner_identity").select("primary_workspace_id, handle");
if (pages.error) { fail("read booking pages", pages.error.message); process.exit(1); }
if (ids.error) { fail("read identities", ids.error.message); process.exit(1); }

// Claimed handles per workspace -- the same rule the migration and handleForWorkspace both apply.
const claimed = new Map();
for (const i of ids.data ?? []) {
  if (!i.primary_workspace_id || !i.handle) continue;
  claimed.set(i.primary_workspace_id, [...(claimed.get(i.primary_workspace_id) ?? []), i.handle]);
}

const rows = pages.data ?? [];
console.log(`  ${rows.length} booking page(s), ${claimed.size} workspace(s) with at least one claimed handle\n`);

const single = rows.filter(p => (claimed.get(p.workspace_id) ?? []).length === 1);
const shared = rows.filter(p => (claimed.get(p.workspace_id) ?? []).length > 1);
const none   = rows.filter(p => (claimed.get(p.workspace_id) ?? []).length === 0);

// 1. THE BACKFILL ITSELF.
const missed = single.filter(p => p.handle !== claimed.get(p.workspace_id)[0]);
if (single.length === 0) console.log("  n/a   no page has a workspace with exactly one claimed handle - nothing for 348 to do here");
else if (missed.length) fail(`${single.length} unambiguous page(s) carry their claimed handle`, `${missed.length} did not adopt it - the UPDATE matched fewer rows than it should have`);
else ok(`all ${single.length} unambiguous page(s) carry their claimed handle`);

// 2. THE DELIBERATE ABSTENTION -- the count(*)=1 subquery is the whole judgement call in this migration.
const wrongly = shared.filter(p => p.handle !== null);
if (shared.length === 0) console.log("  n/a   no workspace has two claimed handles, so the abstention rule is untested by live data");
else if (wrongly.length) fail("shared workspaces left null", `${wrongly.length} page(s) on a shared workspace carry a handle - one clinician's address on a shared practice`);
else ok(`all ${shared.length} shared-workspace page(s) correctly left null for a person to decide`);

// 3. Pages with no claim at all must be untouched.
const invented = none.filter(p => p.handle !== null);
invented.length
  ? fail("pages with no claimed handle stay null", `${invented.length} carry a handle nobody claimed`)
  : ok(`all ${none.length} page(s) with no claim remain null`);

// 4. THE POINT OF THE MIGRATION: HANDLE_CLAIMED is now satisfiable through the product.
const withHandle = rows.filter(p => p.handle).length;
withHandle > 0
  ? ok(`${withHandle} page(s) now satisfy the HANDLE_CLAIMED publish blocker`)
  : console.log("  n/a   no page carries a handle yet - expected only if nobody has claimed one");

console.log(bad === 0 ? "\nALL CLEAR - 348 is applied and consistent.\n" : `\n${bad} PROBLEM(S)\n`);
process.exit(bad === 0 ? 0 : 1);
