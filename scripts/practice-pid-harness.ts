/**
 * CP Patient Numbering harness -- CPR-PID-001 v1.0 (FROZEN), migration 289.
 *
 * WHAT IT PROVES (the spec's own acceptance criteria, s16):
 *   1. A committed registration receives exactly one number in YY-NNNNNN form, and the first patient
 *      in a fresh practice/year is 000001.
 *   2. Numbers are SEQUENTIAL within the workspace and year.
 *   3. CONCURRENT registrations cannot share a number -- five at once, five distinct.
 *   4. TWO WORKSPACES each legitimately hold sequence 000001 (the uniqueness boundary).
 *   5. IMMUTABLE: a direct update of an assigned number is refused BY THE DATABASE.
 *   6. UNCHANGED by demographic edits.
 *   7. SEARCH resolves canonical and normalised forms: 26-000184, 26000184, 26 000184, 26-184.
 *   8. MERGE keeps the survivor's number canonical, and the RETIRED number of the merged record still
 *      resolves -- to the survivor, with matchedBy saying it arrived through a retired number.
 *   9. The counter table agrees with the maximum assigned sequence.
 *
 *   npx --yes tsx scripts/practice-pid-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { registerPatient, mergePatients, canonicalPatientNumber, formatPatientNumber } from "../src/lib/practice/patients";
import { universalSearch } from "../src/lib/practice/patient-workspace";
import { practiceToday } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ea401";
const OWNER_B = "00000000-0000-4000-8000-0000000ea402";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(suffix: string, owner: string = OWNER): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pid-${suffix}`, request_type: "pilot",
    actor_user_id: owner, target_user_id: owner, payload_hash: "harness", correlation_id: "harness-pid",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: owner, correlation_id: "harness-pid", workspace_id: null }, payload(`HARNESS PID ${suffix} (synthetic)`));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await admin.from("practice_practitioner_identity").delete().in("user_id", [OWNER, OWNER_B]);
  await admin.from("provisioning_request").delete().in("target_user_id", [OWNER, OWNER_B]);
  await admin.from("practice_audit_event").delete().in("actor_id", [OWNER, OWNER_B]);
  // The counter rows cascade with the workspace (migration 289 on delete cascade).
  await purgeWorkspacesOwnedBy(admin, [OWNER, OWNER_B]);
}

async function main() {
  console.log("\nCP Patient Numbering harness (CPR-PID-001, migration 289)\n");
  await cleanup();

  // ── 0. The pure pieces ─────────────────────────────────────────────────────
  ok("0. THE FORMATTER IS THE SPEC'S EXAMPLE", formatPatientNumber(2026, 184) === "26-000184");
  ok("0b. EVERY NORMALISED SEARCH FORM CANONICALISES (s10)",
    canonicalPatientNumber("26-000184") === "26-000184" &&
    canonicalPatientNumber("26000184") === "26-000184" &&
    canonicalPatientNumber("26 000184") === "26-000184" &&
    canonicalPatientNumber("26-184") === "26-000184",
    JSON.stringify([canonicalPatientNumber("26000184"), canonicalPatientNumber("26-184")]));
  ok("0c. and a non-number is not treated as one",
    canonicalPatientNumber("Amina") === null && canonicalPatientNumber("P-GB856U") === null &&
    canonicalPatientNumber("26-0001849") === null);

  const wsA = await provision("a");
  const resolved = await resolveWorkspaceContext(admin, OWNER, wsA);
  if (!resolved.ok) { ok("workspace context resolves", false, (resolved as any).code); return report(); }
  const ctx = resolved.ctx;
  const yy = String(Number(practiceToday("Africa/Kampala").slice(0, 4)) % 100).padStart(2, "0");
  const base = { workspaceId: wsA, actorId: OWNER, correlationId: "harness-pid" };

  // ── 1, 2. First is 000001, then sequential ─────────────────────────────────
  const p1 = await registerPatient(admin, { ...base, displayName: "First Person", birthDate: "1980-01-01", phone: "+256772400001" });
  ok("1. THE FIRST PATIENT IN A FRESH PRACTICE IS 000001, in YY-NNNNNN form",
    p1.ok && p1.data.patientNumber === `${yy}-000001`, p1.ok ? p1.data.patientNumber : p1.message);
  const p2 = await registerPatient(admin, { ...base, displayName: "Second Person", birthDate: "1981-02-02", phone: "+256772400002" });
  if (!p1.ok || !p2.ok) { ok("both seed registrations succeeded", false, "cannot continue"); return report(); }
  ok("2. THE SECOND IS 000002 -- sequential, not random",
    p2.data.patientNumber === `${yy}-000002`, p2.data.patientNumber);

  // ── 3. Concurrency: five at once, five distinct ───────────────────────────
  const five = await Promise.all([3, 4, 5, 6, 7].map(n => registerPatient(admin, {
    ...base, displayName: `Concurrent Person ${n}`, birthDate: "1990-03-03", phone: `+25677240000${n}`, confirmNew: true,
  })));
  const numbers = five.map(r => (r.ok ? r.data.patientNumber : `FAILED:${(r as any).code}`));
  ok("3. FIVE CONCURRENT REGISTRATIONS GET FIVE DISTINCT NUMBERS (spec s16)",
    five.every(r => r.ok) && new Set(numbers).size === 5 &&
    numbers.every(n => new RegExp(`^${yy}-\\d{6}$`).test(n)),
    JSON.stringify(numbers));

  // ── 4. Two workspaces each hold 000001 ─────────────────────────────────────
  // ⚠ A SECOND OWNER, NOT A SECOND CALL. Provisioning is idempotent per practitioner, so a second
  // request for the same owner returns the SAME workspace -- the first run of this harness proved it
  // by handing workspace A back as "B" and failing 4 and 9 together.
  const wsB = await provision("b", OWNER_B);
  ok("4-control. workspace B really is a different workspace", wsB !== wsA, "provisioning returned the same id");
  const q1 = await registerPatient(admin, {
    workspaceId: wsB, actorId: OWNER, correlationId: "harness-pid",
    displayName: "Other Practice First", birthDate: "1985-05-05", phone: "+256772400011",
  });
  ok("4. A SECOND WORKSPACE LEGITIMATELY STARTS AT 000001 -- the boundary is workspace + year",
    q1.ok && q1.data.patientNumber === `${yy}-000001`, q1.ok ? q1.data.patientNumber : q1.message);

  // ── 5. Immutability, enforced by the database ──────────────────────────────
  const forged = await admin.from("practice_patient")
    .update({ patient_number: `${yy}-999999` }).eq("id", p1.data.id).select("id");
  ok("5. AN ASSIGNED NUMBER REFUSES TO CHANGE, whoever asks (trigger, not code manners)",
    !!forged.error && /immutable/i.test(forged.error.message), forged.error?.message ?? "the update succeeded");

  // ── 6. Unchanged by a demographic edit ─────────────────────────────────────
  await admin.from("practice_patient").update({ display_name: "First Person Renamed" }).eq("id", p1.data.id);
  const { data: after } = await admin.from("practice_patient").select("patient_number, display_name").eq("id", p1.data.id).single();
  ok("6. THE NUMBER SURVIVES A NAME CHANGE, and the name change itself landed",
    after?.patient_number === `${yy}-000001` && after?.display_name === "First Person Renamed",
    JSON.stringify(after));

  // ── 7. Search resolves every stated form ───────────────────────────────────
  const forms = [`${yy}-000002`, `${yy}000002`, `${yy} 000002`, `${yy}-2`];
  for (const f of forms) {
    const found = await universalSearch(admin, ctx, f, { correlationId: "harness-pid" });
    ok(`7. search resolves "${f}"`,
      found.results.some(r => r.patientId === p2.data.id && r.matchedBy === "patient_number"),
      JSON.stringify(found.results.map(r => `${r.displayName}:${r.matchedBy}`)));
  }

  // ── 8. Merge: survivor canonical, retired number resolves to the survivor ──
  const dupe = await registerPatient(admin, {
    ...base, displayName: "Second Person", birthDate: "1981-02-02", phone: "+256772400002", confirmNew: true,
  });
  if (!dupe.ok) { ok("the deliberate duplicate registered (confirmNew)", false, dupe.message); return report(); }
  const merged = await mergePatients(admin, {
    workspaceId: wsA, survivingId: p2.data.id, duplicateId: dupe.data.id,
    reason: "harness duplicate", actorId: OWNER, correlationId: "harness-pid",
  });
  ok("8. the merge itself succeeded", merged.ok, merged.ok ? "" : (merged as any).message);
  const { data: survivor } = await admin.from("practice_patient").select("patient_number").eq("id", p2.data.id).single();
  ok("8b. THE SURVIVOR KEEPS ITS OWN NUMBER as canonical (s13)",
    survivor?.patient_number === `${yy}-000002`, JSON.stringify(survivor));
  const retired = await universalSearch(admin, ctx, dupe.data.patientNumber, { correlationId: "harness-pid" });
  ok("8c. THE RETIRED NUMBER STILL RESOLVES -- to the survivor, saying how it arrived",
    retired.results.length === 1 && retired.results[0].patientId === p2.data.id &&
    retired.results[0].matchedBy === "patient_number:retired_on_merged_record",
    JSON.stringify(retired.results.map(r => `${r.displayName}:${r.matchedBy}`)));

  // ── 9. The counter agrees with the maximum assigned ────────────────────────
  const { data: counter } = await admin.from("practice_patient_number_counter")
    .select("registration_year, last_sequence").eq("workspace_id", wsA);
  const thisYear = (counter ?? []).find((c: any) => String(c.registration_year % 100).padStart(2, "0") === yy);
  ok("9. THE COUNTER HOLDS THE HIGH-WATER MARK -- 8 allocations in workspace A",
    thisYear?.last_sequence === 8, JSON.stringify(counter));

  await cleanup();
  report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):` : ""}`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
