/**
 * ESTATE HYGIENE -- DOES THE LIVE ESTATE CONTAIN ANYTHING THAT IS NOT A REAL PRACTICE?
 *
 * ⚠ WHY THIS EXISTS, AND IT IS NOT A TIDINESS CONCERN. On 2026-08-18 the Product Director's Mission
 * Control read "7 practices, 7 practitioners". One was real. The other six were harness fixtures left
 * behind by runs that were KILLED rather than failed -- a command timeout, an agent watchdog, a stopped
 * task -- accumulated across three separate dates. The landlord dashboard was overstating the estate
 * sevenfold, and nothing anywhere went red, because every harness was passing: each one tidies up after
 * ITSELF, and none of them could see the others' litter.
 *
 * That is the shape of the failure this file is aimed at: not a broken assertion, but a true statement
 * nobody was making. Every screen was correctly reporting a database that had quietly stopped
 * describing reality.
 *
 * ⚠ IT IS A DB HARNESS AND IT ASSERTS ABOUT THE LIVE ESTATE. That makes it unusual here and it is
 * deliberate: the defect lived in the DATA, so no amount of source scanning could have found it.
 *
 *   npx --yes tsx scripts/estate-hygiene-harness.ts
 *   npx --yes tsx scripts/estate-hygiene-harness.ts --purge   (sweep, then re-assert)
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { isFixtureOwner, purgeAbandonedFixtures } from "./_cleanup";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/**
 * ⚠ ARCHIVED FIXTURES ARE PERMITTED, AND THAT IS NOT A LOOPHOLE. A workspace that has moved through
 * lifecycle states cannot be deleted -- migration 247 makes practice_lifecycle_transition append-only --
 * so the estate's own answer is to ARCHIVE it. An archived workspace is excluded from every operating
 * count, which is the property this file actually cares about. Requiring deletion would demand something
 * the database refuses, and a harness that asks for the impossible gets disabled rather than obeyed.
 */
const OPERATING = ["PROVISIONING", "ONBOARDING", "ACTIVE", "SUSPENDED"];

async function main() {
  console.log("\nESTATE HYGIENE -- fixtures must not be counted as practices\n");

  if (process.argv.includes("--purge")) {
    console.log("sweeping abandoned fixtures first (--purge)...");
    const swept = await purgeAbandonedFixtures(admin);
    console.log(`  examined ${swept.examined} workspace(s)`);
    if (swept.purged) console.log(`  deleted ${swept.purged.deleted.length}, blocked ${swept.purged.blocked.length}`);
    for (const s of swept.skipped) console.log(`  skipped: ${s}`);
    console.log("");
  }

  const { data: ws, error } = await admin.from("practice_workspace")
    .select("id, name, status, owner_person_id");
  if (error) { console.error("estate unreadable:", error.message); process.exit(1); }
  const rows = (ws ?? []) as { id: string; name: string; status: string; owner_person_id: string }[];

  // ⚠ THE CONTROL FIRST. Everything below is a negative -- "no fixture is operating" -- and a negative
  // over an empty list passes. An unreadable or empty estate must not look like a clean one.
  ok("0-control the estate was read and holds at least one workspace",
    rows.length > 0, `${rows.length} workspace(s)`);

  const operatingFixtures = rows.filter(w => isFixtureOwner(w.owner_person_id) && OPERATING.includes(w.status));
  ok("1 no fixture-owned workspace is in an operating state",
    operatingFixtures.length === 0,
    operatingFixtures.map(w => `${w.name} (${w.status})`).join(", ")
      + " -- run with --purge, or archive what cannot be deleted");

  // A fixture holding real rows is a different and worse problem: a test wrote into something that
  // looks real, or a real practice was created under a fixture id. Either way it must not be swept.
  const fixtureWithData: string[] = [];
  for (const w of rows.filter(x => isFixtureOwner(x.owner_person_id))) {
    const { count: patients } = await admin.from("practice_patient")
      .select("id", { count: "exact", head: true }).eq("workspace_id", w.id);
    if ((patients ?? 0) > 0) fixtureWithData.push(`${w.name} holds ${patients} patient record(s)`);
  }
  ok("2 no fixture-owned workspace holds patient records",
    fixtureWithData.length === 0, fixtureWithData.join(", "));

  // The estate the landlord screens count. Reported, never pinned: this number SHOULD change as the
  // product grows, and pinning it would go red for the best possible reason.
  const operating = rows.filter(w => OPERATING.includes(w.status));
  console.log(`\n  measured (reported, never pinned): ${operating.length} operating practice(s) -- `
    + operating.map(w => `${w.name} (${w.status})`).join(", "));

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
  console.log("\n⚠ This proves the estate is clean NOW. It cannot stop a run being killed mid-flight --");
  console.log("  cleanupOnKill() in _cleanup.ts catches the polite signals, and nothing catches SIGKILL.");
  console.log("  Run this after a session that killed a harness.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
