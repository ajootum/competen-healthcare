/**
 * Practice patient-identity harness -- PEN-002 / DM-001 s6 exercised against the live database through
 * the same engine the API uses.
 *
 * WHAT IT PROVES:
 *   1. Registration enforces the CPR-005 minimum dataset, creates the patient, GENERATES an opaque
 *      Practice ID, and stores the primary contact.
 *   2. THE DUPLICATE DOCTRINE, all three branches: an exact identifier collision is REFUSED with the
 *      existing patient named; a same-name+same-dob registration returns CANDIDATES and is refused
 *      until confirmed; confirmNew registers the genuine namesake. And the database itself refuses a
 *      duplicate live identifier even if the engine's check is bypassed.
 *   3. Search finds the same patient by name, by phone, and by identifier, ranked with identifier first.
 *   4. Booking with patientId links the diary to the registry and carries the REGISTRY's name; a bogus
 *      patient id is refused by the Phase-2 foreign key even on a raw insert (the Phase-1 promise,
 *      proven).
 *   5. MERGE moves identifiers, contacts and appointments to the survivor, keeps the duplicate as a
 *      merged pointer, writes the merge record, and the merged record stops appearing in search.
 *      Merging a merged patient is refused.
 *   6. Workspace isolation non-vacuously; anon reads 0 rows from all four identity tables.
 *
 *   npx --yes tsx scripts/practice-patients-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient, searchPatients, mergePatients } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000c0d21";
const USER_B = "00000000-0000-4000-8000-0000000c0d22";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pat-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-pat",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-pat", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [USER_A, USER_B]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

async function main() {
  console.log("\nPractice patient-identity harness (PEN-002, DM-001 s6)\n");
  await cleanup();

  const wsA = await provision(USER_A, "HARNESS Identity A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Identity B (synthetic)", "b");
  const base = { actorId: USER_A, correlationId: "harness-pat" };

  // ── 1. Registration + minimum dataset + generated id ───────────────────────
  const missing = await registerPatient(admin, { workspaceId: wsA, displayName: "No Contact Person", birthDate: "1990-01-01", ...base });
  ok("registration without a contact is refused (CPR-005 minimum dataset)", !missing.ok && missing.code === "VALIDATION_ERROR", missing.ok ? "was allowed" : missing.code);

  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Amina Nakato", birthDate: "1988-04-12", sex: "female",
    phone: "0772 000 111", identifiers: [{ type: "national_id", value: "CM880412001" }], ...base,
  });
  ok("registration creates the patient", p1.ok, p1.ok ? "" : p1.message);
  ok("a Practice ID is generated (P-XXXXXX, unambiguous alphabet)", p1.ok && /^P-[2-9A-HJKMNP-Z]{6}$/.test(p1.data.practiceId), p1.ok ? p1.data.practiceId : "");

  // ── 2. Duplicate doctrine ──────────────────────────────────────────────────
  const dupId = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Different Name", birthDate: "1990-01-01",
    phone: "0700000000", identifiers: [{ type: "national_id", value: "CM 880412001" }], ...base,
  });
  ok("an exact identifier collision is refused with the owner named",
    !dupId.ok && dupId.code === "DUPLICATE_IDENTIFIER" && dupId.candidates?.[0]?.displayName === "Amina Nakato",
    dupId.ok ? "was allowed" : dupId.code);

  const nearDup = await registerPatient(admin, { workspaceId: wsA, displayName: "amina  nakato", birthDate: "1988-04-12", phone: "0414999999", ...base });
  ok("same name + same dob returns candidates and is refused until confirmed",
    !nearDup.ok && nearDup.code === "POSSIBLE_DUPLICATE" && (nearDup.candidates?.length ?? 0) > 0,
    nearDup.ok ? "was allowed" : nearDup.code);

  const namesake = await registerPatient(admin, { workspaceId: wsA, displayName: "Amina Nakato", birthDate: "1988-04-12", phone: "0414999999", confirmNew: true, ...base });
  ok("confirmNew registers the genuine namesake", namesake.ok, namesake.ok ? "" : namesake.message);

  const bypass = await admin.from("practice_patient_identifier").insert({
    workspace_id: wsA, patient_id: namesake.ok ? namesake.data.id : "", identifier_type: "national_id", value: "CM880412001",
  });
  ok("the database refuses a duplicate live identifier even when the engine is bypassed",
    !!bypass.error && /duplicate|unique/i.test(bypass.error.message), bypass.error?.message ?? "insert succeeded");

  // ── 3. Search, three ways, ranked ──────────────────────────────────────────
  const byName = await searchPatients(admin, wsA, "Amina Nakato");
  ok("search by name finds the patient", byName.results.some(r => p1.ok && r.id === p1.data.id));
  const byPhone = await searchPatients(admin, wsA, "0772000111");
  ok("search by phone finds the patient", byPhone.results.some(r => p1.ok && r.id === p1.data.id));
  const byIdent = await searchPatients(admin, wsA, "cm880412001");
  ok("search by identifier finds the patient, ranked first",
    byIdent.results[0] && p1.ok && byIdent.results[0].id === p1.data.id && byIdent.results[0].matchedBy.startsWith("identifier"),
    byIdent.results[0]?.matchedBy);

  // ── 4. Diary link + the Phase-1 FK promise ─────────────────────────────────
  const linked = await bookAppointment(admin, {
    workspaceId: wsA, patientId: p1.ok ? p1.data.id : undefined, patientName: "Wrong Spelling",
    appointmentType: "scheduled_followup", scheduledAt: "2026-09-02T10:00:00.000Z", ...base,
  });
  if (linked.ok) {
    const { data: appt } = await admin.from("practice_appointment").select("patient_id, patient_name").eq("id", linked.data.id).single();
    ok("a registry-linked booking carries the REGISTRY's name, not the caller's spelling",
      appt?.patient_id === (p1.ok ? p1.data.id : "") && appt?.patient_name === "Amina Nakato", JSON.stringify(appt));
  } else ok("a registry-linked booking succeeds", false, linked.message);

  const bogusFk = await admin.from("practice_appointment").insert({
    workspace_id: wsA, patient_id: "00000000-0000-4000-8000-00000000dead", patient_name: "Ghost",
    appointment_type: "new_consultation", scheduled_at: "2026-09-02T11:00:00.000Z",
  });
  ok("a bogus patient_id is refused by the foreign key (the Phase-1 promise, proven)",
    !!bogusFk.error && /foreign key|violates/i.test(bogusFk.error.message), bogusFk.error?.message ?? "insert succeeded");

  // ── 5. Merge ───────────────────────────────────────────────────────────────
  if (p1.ok && namesake.ok) {
    const merge = await mergePatients(admin, { workspaceId: wsA, survivingId: p1.data.id, duplicateId: namesake.data.id, ...base });
    ok("merge succeeds and reports what moved", merge.ok && merge.data.moved.identifiers >= 1, merge.ok ? JSON.stringify(merge.data.moved) : merge.message);

    const { data: mergedRow } = await admin.from("practice_patient").select("status, merged_into_patient_id").eq("id", namesake.data.id).single();
    ok("the duplicate stays as a merged pointer", mergedRow?.status === "merged" && mergedRow?.merged_into_patient_id === p1.data.id, JSON.stringify(mergedRow));

    const postMerge = await searchPatients(admin, wsA, "Amina Nakato");
    ok("the merged record no longer appears in search", !postMerge.results.some(r => r.id === namesake.data.id));

    const again = await mergePatients(admin, { workspaceId: wsA, survivingId: p1.data.id, duplicateId: namesake.data.id, ...base });
    ok("merging an already-merged patient is refused", !again.ok && again.code === "ILLEGAL_MERGE", again.ok ? "was allowed" : again.code);
  }

  // ── 6. Isolation + anon ────────────────────────────────────────────────────
  const inB = await searchPatients(admin, wsB, "Amina Nakato");
  ok("workspace B finds none of workspace A's patients (A has them, so not vacuous)", inB.results.length === 0, `${inB.results.length}`);

  let svcRows = false, leaked = 0;
  for (const t of ["practice_patient", "practice_patient_identifier", "practice_patient_contact", "practice_patient_merge"]) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows = true;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("the service role sees identity rows (denial test is not vacuous)", svcRows);
  ok("anon reads 0 rows from every identity table", leaked === 0, `${leaked} table(s) leaked`);

  await cleanup();
  const { count: left } = await admin.from("practice_patient").select("*", { count: "exact", head: true }).in("workspace_id", [wsA, wsB]);
  ok("synthetic data cleaned up (cascade)", (left ?? 0) === 0, `${left}`);

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
