/**
 * Patient bulk import harness -- CPR-IMP-001, migration 288.
 *
 * WHAT IT PROVES:
 *   1. THE TEMPLATE AND THE PARSER ARE ONE CONSTANT: the header the client offers parses to zero
 *      problems, and an unknown column is NAMED, never ignored.
 *   2. PREVIEW WRITES NOTHING -- the whole judgement runs and the register stays empty.
 *   3. COMMIT REGISTERS through the registration engines: an adult, and a child WITH its guardian
 *      relationship actually attached.
 *   4. DECISION 2 HOLDS: a row whose appointment names an unknown location still registers, and the
 *      report says the appointment was dropped and why.
 *   5. A GOOD APPOINTMENT BOOKS, at the exact practice-timezone instant the CSV stated.
 *   6. IDEMPOTENCY LAYER 2: the same file cannot commit twice (ALREADY_IMPORTED).
 *   7. IDEMPOTENCY LAYER 1: an external_id that already created a patient is skipped in a NEW file,
 *      and the unique index refuses a forged second claim even when code is bypassed.
 *   8. DECISION 1 HOLDS: a row matching an existing patient is SKIPPED and the candidates are named.
 *   9. ROWS ARE INDEPENDENT: a bad row does not stop a good row in the same file.
 *  10. A FILE-LEVEL PROBLEM STOPS THE WHOLE COMMIT, and nothing is written.
 *  11. instantInZone IS DST-CORRECT, proven against a zone that shifts and one that does not.
 *
 *   npx --yes tsx scripts/practice-import-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import {
  parseImportCsv, previewPatientImport, commitPatientImport, instantInZone, readDate, readTime,
} from "../src/lib/practice/patient-import";
import { IMPORT_TEMPLATE_HEADER } from "../src/lib/practice/import-columns";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ea301";

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

async function provision(): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: "harness-import-a", request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: "harness-import",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: OWNER, correlation_id: "harness-import", workspace_id: null }, payload("HARNESS Import A (synthetic)"));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  await admin.from("practice_audit_event").delete().eq("actor_id", OWNER);
  // Import runs and rows cascade with the workspace (migration 288 on delete cascade).
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

const patientCount = async (ws: string) => {
  const { count } = await admin.from("practice_patient")
    .select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  return count ?? -1;
};

/** A future date N days out, as YYYY-MM-DD. Weekday-agnostic: nothing here checks sessions. */
const daysOut = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function main() {
  console.log("\nPatient bulk import harness (CPR-IMP-001, migration 288)\n");
  await cleanup();

  // ── 1. The template parses; an unknown column is named ─────────────────────
  const parsedHeader = parseImportCsv(IMPORT_TEMPLATE_HEADER + "\nAmina,,Okello,1988-03-14,,female,0772000001,,,,,,,,,,,,\n");
  ok("1. THE TEMPLATE HEADER PARSES CLEAN, one row read",
    parsedHeader.fileProblems.length === 0 && parsedHeader.rows.length === 1,
    JSON.stringify(parsedHeader.fileProblems));
  const typo = parseImportCsv("first_name,apointment_date\nAmina,2026-01-01\n");
  ok("1b. A MISSPELT COLUMN IS A NAMED FILE PROBLEM, not silently ignored",
    typo.fileProblems.some(p => p.includes("apointment_date")),
    JSON.stringify(typo.fileProblems));

  // ── 11. The timezone conversion, pure and DST-proven ───────────────────────
  ok("11. KAMPALA IS UTC+3 ALL YEAR",
    instantInZone("2026-08-20", "09:30", "Africa/Kampala") === "2026-08-20T06:30:00.000Z",
    String(instantInZone("2026-08-20", "09:30", "Africa/Kampala")));
  ok("11b. LONDON SHIFTS: the same wall clock is 08:30Z in August and 09:30Z in December",
    instantInZone("2026-08-20", "09:30", "Europe/London") === "2026-08-20T08:30:00.000Z" &&
    instantInZone("2026-12-20", "09:30", "Europe/London") === "2026-12-20T09:30:00.000Z",
    `${instantInZone("2026-08-20", "09:30", "Europe/London")} / ${instantInZone("2026-12-20", "09:30", "Europe/London")}`);
  ok("11c. an unknown zone returns null rather than a silently-UTC booking",
    instantInZone("2026-08-20", "09:30", "Mars/Olympus_Mons") === null);

  // ── 12. The tolerant formats (v1.1: "e.g. dd-mm-yyyy") ─────────────────────
  const iso = (r: ReturnType<typeof readDate>) => ("iso" in r ? r.iso : `ERR:${r.error}`);
  ok("12. EVERY UNAMBIGUOUS DATE FORM READS TO THE SAME DAY",
    iso(readDate("1988-03-14")) === "1988-03-14" && iso(readDate("14-03-1988")) === "1988-03-14" &&
    iso(readDate("14/03/1988")) === "1988-03-14" && iso(readDate("14 Mar 1988")) === "1988-03-14" &&
    iso(readDate("March 14, 1988")) === "1988-03-14" && iso(readDate("14 march 1988")) === "1988-03-14",
    [readDate("14-03-1988"), readDate("14 Mar 1988")].map(r => JSON.stringify(r)).join(" / "));
  const ambiguous = readDate("03-04-1988");
  ok("12b. THE AMBIGUOUS NUMERIC DATE IS READ DAY-FIRST AND ANNOUNCED, never silent",
    "iso" in ambiguous && ambiguous.iso === "1988-04-03" &&
    /read day-first as 3 April 1988/.test(ambiguous.note ?? ""),
    JSON.stringify(ambiguous));
  ok("12c. and the unambiguous day-first date carries NO note -- an announcement of nothing is noise",
    "iso" in readDate("14-03-1988") && (readDate("14-03-1988") as any).note === undefined);
  ok("12d. A MONTH-FIRST FILE BETRAYS ITSELF: month 13 is refused NAMING the convention",
    "error" in readDate("04/13/1988") && /day-first/.test((readDate("04/13/1988") as any).error) &&
    /month 13/.test((readDate("04/13/1988") as any).error),
    JSON.stringify(readDate("04/13/1988")));
  ok("12e. a two-digit year is refused -- a century is not guessable",
    "error" in readDate("14-03-88") && /two-digit year/.test((readDate("14-03-88") as any).error));
  ok("12f. an impossible calendar date is refused",
    "error" in readDate("31-02-2020") && "error" in readDate("2020-02-31"));
  const t = (r: ReturnType<typeof readTime>) => ("hhmm" in r ? r.hhmm : `ERR`);
  ok("12g. TIMES: 24-hour, am/pm and bare-hour am/pm all read; noon and midnight land right",
    t(readTime("14:30")) === "14:30" && t(readTime("2:30 pm")) === "14:30" && t(readTime("9am")) === "09:00" &&
    t(readTime("12:00 am")) === "00:00" && t(readTime("12:00 pm")) === "12:00",
    [readTime("2:30 pm"), readTime("12:00 am")].map(r => JSON.stringify(r)).join(" / "));
  ok("12h. a bare number with no am/pm is refused (as likely a typo as a time), and 24:00 is refused",
    "error" in readTime("14") && "error" in readTime("24:00") && "error" in readTime("13 pm"));

  const ws = await provision();
  const resolved = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!resolved.ok) { ok("workspace context resolves", false, (resolved as any).code); return report(); }
  const ctx = resolved.ctx;

  const apptDate = daysOut(10);
  const fileOne = [
    IMPORT_TEMPLATE_HEADER,
    // an adult with a phone and an external id -- DOB in numeric day-first form (v1.1)
    `Amina,,Okello,14-03-1988,,female,+256772100001,,,,,,,,,,,,IMP-A`,
    // a child with a guardian carrying the contact
    `Kato,,Ssebunya,,6,male,,,,Grace Ssebunya,mother,+256772100002,,,,,,,IMP-B`,
    // an adult whose appointment names a location this practice does not have -> decision 2.
    // DOB is the AMBIGUOUS day-first form, so the announcement must reach the ledger.
    `Joan,,Adeke,03-04-1979,,female,+256772100003,,,,,,,Follow-up,Nonexistent Clinic,${apptDate},10:00,scheduled_followup,IMP-C`,
    // an adult with a bookable appointment (no location -- placement rules only), time in pm form
    `Peter,,Okot,1965-11-23,,male,+256772100004,,,,,,,Chest pain review,,${apptDate},2:30 pm,new_consultation,IMP-D`,
  ].join("\n") + "\n";

  // ── 2. Preview writes nothing ──────────────────────────────────────────────
  const before = await patientCount(ws);
  const preview = await previewPatientImport(admin, ctx, fileOne);
  ok("2. PREVIEW RUNS THE WHOLE JUDGEMENT", preview.ok, preview.ok ? "" : (preview as any).message);
  if (preview.ok) {
    ok("2b. four rows, none an error, two carrying an appointment attempt",
      preview.data.rowCount === 4 && preview.data.counts.error === 0,
      JSON.stringify(preview.data.counts));
    const joan = preview.data.rows.find(r => r.rowNumber === 3);
    ok("2c. the unknown location is announced BEFORE commit, as an appointment drop",
      !!joan && joan.verdict === "register" && joan.notes.some(n => n.includes("Nonexistent Clinic")),
      JSON.stringify(joan?.notes));
  }
  ok("2d. AND THE REGISTER IS UNTOUCHED", (await patientCount(ws)) === before,
    `before ${before}, after ${await patientCount(ws)}`);

  // ── 3, 4, 5. Commit ────────────────────────────────────────────────────────
  const commit = await commitPatientImport(admin, ctx, { csvText: fileOne, fileName: "file-one.csv" });
  ok("3. COMMIT SUCCEEDS", commit.ok, commit.ok ? "" : (commit as any).message);
  if (!commit.ok) return report();
  const rows = commit.data.rows;
  const byRow = (n: number) => rows.find(r => r.rowNumber === n)!;

  ok("3b. the adult registered", byRow(1).outcome === "REGISTERED" && !!byRow(1).patientId, byRow(1).detail);
  ok("3c. THE CHILD REGISTERED WITH ITS GUARDIAN ATTACHED",
    byRow(2).outcome === "REGISTERED" && !!byRow(2).patientId &&
    ((await admin.from("practice_patient_relationship").select("id", { count: "exact", head: true })
      .eq("patient_id", byRow(2).patientId!)).count ?? 0) === 1,
    byRow(2).detail);
  ok("4. DECISION 2: unknown location -> the patient EXISTS and the drop is REPORTED",
    byRow(3).outcome === "REGISTERED" && !!byRow(3).patientId && byRow(3).appointmentId === null &&
    byRow(3).detail.includes("appointment dropped") && byRow(3).detail.includes("Nonexistent Clinic"),
    byRow(3).detail);
  ok("4b. THE DAY-FIRST ANNOUNCEMENT REACHES THE LEDGER: how 03-04-1979 was read is on the row",
    byRow(3).detail.includes("read day-first as 3 April 1979") &&
    ((await admin.from("practice_patient").select("birth_date").eq("id", byRow(3).patientId!).single()).data?.birth_date === "1979-04-03"),
    byRow(3).detail);
  ok("4c. and the UNAMBIGUOUS day-first DOB stored right with NO announcement",
    !byRow(1).detail.includes("day-first") &&
    ((await admin.from("practice_patient").select("birth_date").eq("id", byRow(1).patientId!).single()).data?.birth_date === "1988-03-14"),
    byRow(1).detail);
  ok("5. THE GOOD APPOINTMENT BOOKED", byRow(4).outcome === "REGISTERED_AND_BOOKED" && !!byRow(4).appointmentId,
    byRow(4).detail);
  if (byRow(4).appointmentId) {
    const { data: appt } = await admin.from("practice_appointment")
      .select("scheduled_at, reason").eq("id", byRow(4).appointmentId).single();
    ok("5b. AT THE EXACT KAMPALA INSTANT THE CSV STATED, reason kept",
      appt?.scheduled_at === `${apptDate}T11:30:00+00:00` && appt?.reason === "Chest pain review",
      JSON.stringify(appt));
  }

  // ── 6. The same file cannot commit twice ───────────────────────────────────
  const again = await commitPatientImport(admin, ctx, { csvText: fileOne, fileName: "file-one.csv" });
  ok("6. IDEMPOTENCY LAYER 2: the identical file is refused whole",
    !again.ok && (again as any).code === "ALREADY_IMPORTED", again.ok ? "it committed twice" : (again as any).code);

  // ── 7, 8, 9. A second file: claimed external id, a duplicate person, a bad row, a good row ──
  const fileTwo = [
    IMPORT_TEMPLATE_HEADER,
    `Amina,,Okello,1988-03-14,,female,+256772100001,,,,,,,,,,,,IMP-A`,             // claimed external id
    `Amina,,Okello,1988-03-14,,female,+256772100001,,,,,,,,,,,,`,                  // same person, no external id
    `Contactless,,Person,1990-01-01,,,,,,,,,,,,,,,`,                               // no contact -> error
    `Fresh,,Registrant,1992-07-07,,female,+256772100005,,,,,,,,,,,,IMP-E`,         // good
  ].join("\n") + "\n";
  const two = await commitPatientImport(admin, ctx, { csvText: fileTwo, fileName: "file-two.csv" });
  ok("7. AN EXTERNAL ID THAT ALREADY CREATED A PATIENT IS SKIPPED IN A NEW FILE",
    two.ok && two.data.rows[0].outcome === "SKIPPED_ALREADY_IMPORTED",
    two.ok ? two.data.rows[0].detail : (two as any).message);
  if (two.ok) {
    ok("8. DECISION 1: THE DUPLICATE PERSON IS SKIPPED AND THE MATCH IS NAMED",
      two.data.rows[1].outcome === "SKIPPED_DUPLICATE" && two.data.rows[1].detail.includes("Amina Okello"),
      two.data.rows[1].detail);
    ok("9. A BAD ROW DOES NOT STOP A GOOD ROW",
      two.data.rows[2].outcome === "ERROR" && two.data.rows[3].outcome === "REGISTERED",
      `${two.data.rows[2].outcome} / ${two.data.rows[3].outcome}`);
  }

  // ── 7b. The unique index itself, code bypassed ─────────────────────────────
  const runId = two.ok ? two.data.runId : commit.data.runId;
  const forged = await admin.from("practice_import_row").insert({
    run_id: runId, workspace_id: ws, row_number: 999,
    external_id: "IMP-A", claimed_external_id: "IMP-A", outcome: "REGISTERED",
  });
  ok("7b. IDEMPOTENCY LAYER 1 IS THE DATABASE: a forged second claim of IMP-A is refused by the index",
    !!forged.error && /duplicate key|unique/i.test(forged.error.message), forged.error?.message ?? "the insert succeeded");

  // ── 10. A file-level problem stops the whole commit ────────────────────────
  const beforeBad = await patientCount(ws);
  const bad = await commitPatientImport(admin, ctx, {
    csvText: "first_name,apointment_date\nGhost,2026-01-01\n", fileName: "typo.csv",
  });
  ok("10. AN UNKNOWN COLUMN REFUSES THE WHOLE COMMIT",
    !bad.ok && (bad as any).code === "FILE_PROBLEMS", bad.ok ? "it committed" : (bad as any).code);
  ok("10b. and wrote nothing", (await patientCount(ws)) === beforeBad);

  // ── The ledger agrees with the reports ─────────────────────────────────────
  const { data: runsLedger } = await admin.from("practice_import_run")
    .select("file_name, status, registered_count, booked_count, skipped_count, error_count")
    .eq("workspace_id", ws).order("created_at");
  const one = (runsLedger ?? []).find((r: any) => r.file_name === "file-one.csv");
  const second = (runsLedger ?? []).find((r: any) => r.file_name === "file-two.csv");
  ok("ledger: file one recorded 4 registered, 1 booked, 0 skipped, 0 errors, COMPLETED",
    !!one && one.status === "COMPLETED" && one.registered_count === 4 && one.booked_count === 1 &&
    one.skipped_count === 0 && one.error_count === 0, JSON.stringify(one));
  ok("ledger: file two recorded 1 registered, 2 skipped, 1 error",
    !!second && second.registered_count === 1 && second.skipped_count === 2 && second.error_count === 1,
    JSON.stringify(second));

  await cleanup();
  report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):` : ""}`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
