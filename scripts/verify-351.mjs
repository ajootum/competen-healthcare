// Verifies migration 351 on PRODUCTION, behaviourally, on a fixture this script owns.
//
// There is no direct SQL connection to production, so the catalog cannot be read. Instead: create a
// workspace, give it a lifecycle transition, and delete the workspace. Before 351 that is the deadlock
// (FK refuses the parent, trigger refuses the child, nothing can clear it). After 351 the cascade
// succeeds and the transition goes with it.
//
// ⚠ THIS IS THE ONE CASE WHERE A DELETE AGAINST PRODUCTION IS JUSTIFIED: it deletes only a row this
// script created seconds earlier, the row exists for no purpose but this test, and the alternative is
// trusting "No rows returned" -- which prints identically for a file that half-applied. §11 forbids
// ROUTINE destructive tests; this is a one-shot verification of a named migration on a synthetic row.
//
// And it checks the OTHER half: a direct DELETE and UPDATE on the transition must still be refused.
// A migration that made deletion work by making the trail mutable would pass the first check and
// defeat the whole of CPR-DEL-001.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = { ...process.env };
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0];

let bad = 0;
const ok = (s) => console.log(`  OK    ${s}`);
const fail = (s, why) => { bad++; console.log(`  FAIL  ${s}\n        ${why}`); };

console.log(`\nMIGRATION 351 - practice_lifecycle_transition cascade-safe  (project ${ref})\n`);

const wsId = randomUUID();
const MARK = `verify-351-${wsId.slice(0, 8)}`;
const w = await db.from("practice_workspace").insert({ id: wsId, name: `ZZ ${MARK}`, status: "ACTIVE", owner_person_id: randomUUID(), country: "UG", timezone: "Africa/Kampala" }).select("id").maybeSingle();
if (w.error) { fail("create fixture workspace", w.error.message); process.exit(1); }

const t = await db.from("practice_lifecycle_transition").insert({ workspace_id: wsId, from_status: "ACTIVE", to_status: "ARCHIVED", reason: MARK }).select("id").maybeSingle();
if (t.error) { fail("create fixture transition", t.error.message); await db.from("practice_workspace").delete().eq("id", wsId); process.exit(1); }
const trId = t.data.id;
ok("fixture built: one workspace, one lifecycle transition");

// 1. IMMUTABILITY SURVIVES -- direct DELETE and UPDATE on the trail are still refused.
const dd = await db.from("practice_lifecycle_transition").delete().eq("id", trId).select("id");
dd.error || !dd.data?.length
  ? ok("direct DELETE on the transition is still refused")
  : fail("direct DELETE still refused", "IT WAS PERMITTED - the trail is no longer append only");

const du = await db.from("practice_lifecycle_transition").update({ reason: "tamper" }).eq("id", trId).select("id");
du.error || !du.data?.length
  ? ok("direct UPDATE on the transition is still refused")
  : fail("direct UPDATE still refused", "IT WAS PERMITTED - the trail is no longer append only");

// 2. THE CASCADE WORKS -- deleting the workspace takes the transition with it.
const del = await db.from("practice_workspace").delete().eq("id", wsId).select("id");
if (del.error) {
  fail("workspace delete cascades through the transition", `${del.error.message} -- 351 did NOT land, or landed partially`);
} else {
  const left = await db.from("practice_lifecycle_transition").select("id", { count: "exact", head: true }).eq("workspace_id", wsId);
  left.count === 0
    ? ok("workspace deleted and its transition went with it -- the cascade is live")
    : fail("transition removed by cascade", `${left.count} transition(s) survived a deleted workspace`);
}

// 3. NOTHING LEFT BEHIND. If the delete failed the fixture is stranded -- say so, do not hide it.
const orphan = await db.from("practice_workspace").select("id").eq("id", wsId).maybeSingle();
orphan.data
  ? fail("fixture cleaned up", `workspace ${wsId} is STRANDED on production. Remove it once 351 is confirmed applied.`)
  : ok("fixture cleaned up");

console.log(bad === 0 ? "\nALL CLEAR - 351 is applied and behaves as specified.\n" : `\n${bad} PROBLEM(S)\n`);
process.exit(bad === 0 ? 0 : 1);
