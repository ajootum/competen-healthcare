// Removes practice workspaces created by HARNESSES from the live database.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS. Harnesses that create and delete their own rows are the right design; these are the
// leftovers from ones that did not finish. Seven of eight practice workspaces are harness residue, which
// matters twice for a pilot: a practitioner could meet a workspace called "HARNESS ASK (synthetic)", and
// every adoption figure computed over practice_workspace is wrong until they are gone.
//
// ⚠ IT IS DRY-RUN UNLESS YOU PASS --delete. Deleting a workspace CASCADES across the practice_* schema,
// and there is no rollback on this database.
//
// THREE INDEPENDENT GUARDS, because a name is not provenance:
//   1. an explicit KEEP list by id -- the real practice can never be a candidate, whatever it is called
//   2. every candidate name must map to a harness FILE that creates it, checked at run time
//   3. anything that fails either test is REPORTED and skipped, never guessed at
//
// Run:  node scripts/prune-synthetic-workspaces.mjs            (report only)
//       node scripts/prune-synthetic-workspaces.mjs --delete   (act)
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";

const env = { ...process.env };
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DELETE = process.argv.includes("--delete");

// GUARD 1. The live pilot practice. Named by id, not by name, so renaming it cannot expose it.
const KEEP = new Set(["b7c5dbc1-22e1-4c53-900c-c2c0f0e7135b"]);

// GUARD 2. A workspace is a candidate only if some harness file contains its exact name.
const harnessText = readdirSync("scripts").filter(f => f.endsWith(".ts") || f.endsWith(".mjs"))
  .map(f => ({ f, text: readFileSync(`scripts/${f}`, "utf8") }));
const createdByHarness = (name) => harnessText.find(h => h.text.includes(name))?.f ?? null;

const COUNTED = ["practice_membership", "practice_patient", "practice_encounter", "practice_message",
  "practice_checkout", "practice_booking_access", "practice_audit_event", "practice_entitlement"];

const ws = (await db.from("practice_workspace").select("id,name,status,created_at").order("created_at")).data ?? [];
console.log(`\n${ws.length} practice workspace(s)\n`);

const doomed = [];
for (const w of ws) {
  const rows = {};
  for (const t of COUNTED) {
    const r = await db.from(t).select("id", { count: "exact", head: true }).eq("workspace_id", w.id);
    rows[t] = r.error ? "?" : r.count;
  }
  const total = Object.values(rows).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  const harness = createdByHarness(w.name);

  if (KEEP.has(w.id)) { console.log(`  KEEP     ${w.name}  (${total} rows)  -- the live pilot practice, guarded by id`); continue; }
  if (!harness)       { console.log(`  SKIP     ${w.name}  (${total} rows)  -- no harness file creates this name; not provably synthetic`); continue; }

  console.log(`  PRUNE    ${w.name}  (${total} rows across ${COUNTED.length} tables)  <- ${harness}`);
  for (const [t, n] of Object.entries(rows)) if (n) console.log(`             ${String(n).padStart(4)}  ${t}`);
  doomed.push(w);
}

if (!doomed.length) { console.log("\nNothing to prune.\n"); process.exit(0); }

if (!DELETE) {
  console.log(`\nDRY RUN. ${doomed.length} workspace(s) would be deleted, cascading.`);
  console.log("Re-run with --delete to act.\n");
  process.exit(0);
}

console.log(`\nDeleting ${doomed.length}...`);
let failed = 0;
for (const w of doomed) {
  const { error } = await db.from("practice_workspace").delete().eq("id", w.id);
  if (error) { failed++; console.log(`  FAILED  ${w.name}: ${error.message}`); }
  else console.log(`  deleted ${w.name}`);
}

// VERIFY rather than assume: re-read, and confirm the keeper is untouched.
const after = (await db.from("practice_workspace").select("id,name")).data ?? [];
const keeper = after.find(w => KEEP.has(w.id));
const keptPatients = keeper ? (await db.from("practice_patient").select("id", { count: "exact", head: true }).eq("workspace_id", keeper.id)).count : null;
console.log(`\n${after.length} workspace(s) remain: ${after.map(w => w.name).join(", ")}`);
console.log(keeper ? `Live practice intact: ${keeper.name}, ${keptPatients} patient(s).` : "!! THE KEEPER IS GONE -- investigate immediately.");
process.exit(failed || !keeper ? 1 : 0);
