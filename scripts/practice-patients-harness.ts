/**
 * Practice patient-identity harness -- PEN-002 / DM-001 s6 exercised against the live database through
 * the same engine the API uses.
 *
 * WHAT IT PROVES:
 *   1. Registration enforces the CPR-V2-005 minimum dataset, creates the patient, GENERATES an opaque
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient, searchPatients, mergePatients } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

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
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

async function main() {
  console.log("\nPractice patient-identity harness (PEN-002, DM-001 s6)\n");
  await cleanup();

  const wsA = await provision(USER_A, "HARNESS Identity A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Identity B (synthetic)", "b");
  const base = { actorId: USER_A, correlationId: "harness-pat" };

  // ── 1. Registration + minimum dataset + generated id ───────────────────────
  const missing = await registerPatient(admin, { workspaceId: wsA, displayName: "No Contact Person", birthDate: "1990-01-01", ...base });
  ok("registration without a contact is refused (CPR-V2-005 minimum dataset)", !missing.ok && missing.code === "VALIDATION_ERROR", missing.ok ? "was allowed" : missing.code);

  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Amina Nakato", birthDate: "1988-04-12", sex: "female",
    phone: "0772 000 111", identifiers: [{ type: "national_id", value: "CM880412001" }], ...base,
  });
  ok("registration creates the patient", p1.ok, p1.ok ? "" : p1.message);
  // CPR-PID-001 (2026-08-12): the generated P-XXXXXX retired; the CP Patient Number replaced it.
  ok("a CP Patient Number is allocated (YY-NNNNNN, CPR-PID-001)", p1.ok && /^\d{2}-\d{6}$/.test(p1.data.patientNumber), p1.ok ? p1.data.patientNumber : "");

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

  // The hospital number exists so the merge below has an identifier to MOVE -- registrations stopped
  // minting a P-XXXXXX (CPR-PID-001 retired it), so a bare patient now has zero identifier rows.
  const namesake = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Amina Nakato", birthDate: "1988-04-12", phone: "0414999999",
    identifiers: [{ type: "hospital_mrn", value: "MRG-HN-77" }], confirmNew: true, ...base,
  });
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

  // ── A SEARCH THAT COULD NOT LOOK IS NOT A SEARCH THAT FOUND NOBODY ──────────────────────────────
  //
  // ⚠ ALL FIVE PROBES IN searchPatients DISCARDED THEIR ERRORS. A refused identifier read returned "no
  // patient found" for an ID sitting in the table -- and the next thing that happens at a desk is the
  // patient being registered again. That is not a cosmetic failure, it is a SPLIT CLINICAL RECORD, and
  // search is where preventing it is supposed to begin.
  //
  // ⚠ ADDING THE FIELD WAS NOT ENOUGH, AND THIS IS THE PART WORTH REMEMBERING. searchPatients already
  // returned an OBJECT, so widening it to {results, complete, detail} broke NOTHING at compile time --
  // tsc stayed at zero errors and every caller kept reading `.results` exactly as before. The
  // listFollowUps fix worked because array -> object forced the compiler to find all 28 call sites; here
  // the same trick was unavailable and every consumer had to be found by hand. A FLAG ADDED TO AN
  // EXISTING OBJECT IS A FLAG NOBODY IS MADE TO READ.
  const failingIdentifierProbe = {
    from: (table: string) => {
      if (table !== "practice_patient_identifier") return admin.from(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order"]) chain[m] = () => chain;
      chain.limit = async () => ({ data: null, error: { message: "simulated identifier probe failure" } });
      return chain;
    },
  };
  const blindSearch = await searchPatients(failingIdentifierProbe as never, wsA, "Amina Nakato");
  ok("search-1. ⚠ a search whose identifier probe FAILED reports itself incomplete",
    blindSearch.complete === false && /simulated identifier probe failure/.test(blindSearch.detail ?? ""),
    JSON.stringify(blindSearch));
  ok("search-2. ⚠ and it is incomplete EVEN WHEN IT RETURNED HITS -- results on screen read as success",
    blindSearch.results.length > 0 && blindSearch.complete === false,
    `${blindSearch.results.length} hits, complete=${blindSearch.complete}`);

  // CONTROL. Without it, search-1 and search-2 pass just as well if searchPatients reported EVERY
  // search incomplete, which is what this fix looks like when the flag is set unconditionally.
  const goodSearch = await searchPatients(admin, wsA, "Amina Nakato");
  ok("search-control. the same query through the real client is COMPLETE, with no detail",
    goodSearch.complete === true && goodSearch.detail === null && goodSearch.results.length > 0,
    JSON.stringify({ n: goodSearch.results.length, complete: goodSearch.complete, detail: goodSearch.detail }));

  // ── THE PRACTICE ID THE DESK ACTUALLY MATCHES ON ────────────────────────────────────────────────
  //
  // ⚠ practiceIdsFor DISCARDED ITS ERROR AND RETURNED AN EMPTY MAP, and it survived two previous passes
  // over this exact bug class in this exact file because it is PRIVATE -- a search for exported engines
  // never saw it. A failed read blanked the practice id for every result and every duplicate CANDIDATE,
  // and a blank there is indistinguishable from a patient who has none. On the registration screen that
  // is the field somebody decides "same patient or not" on, so the failure made a real match look like a
  // stranger and the next click created the second record.
  // ⚠ A SECOND STUB, BECAUSE THE FIRST ONE CANNOT BREAK THIS READ. failingIdentifierProbe terminates on
  // `.limit()`, and practiceIdsFor has no `.limit()` -- it awaits the chain after `.is()`. Awaiting a
  // plain object resolves to the object, so `error` came back undefined and the probe "succeeded". The
  // assertions below were right and the fixture was wrong, which is the harder of the two to notice: a
  // fixture that cannot produce the failure makes a real assertion look satisfied.
  const failIdentifierRead = { data: null, error: { message: "simulated identifier table outage" } };
  const failingPracticeId = {
    from: (table: string) => {
      if (table !== "practice_patient_identifier") return admin.from(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order"]) chain[m] = () => chain;
      chain.limit = async () => failIdentifierRead;
      // The terminal for a chain nobody calls .limit() on.
      chain.then = (resolve: (v: unknown) => unknown) => resolve(failIdentifierRead);
      return chain;
    },
  };
  const blindPid = await searchPatients(failingPracticeId as never, wsA, "Amina Nakato");

  ok("pid-1. ⚠ a failed practice-id read makes the search INCOMPLETE and says so by name",
    blindPid.complete === false && /practice-id: /.test(blindPid.detail ?? ""),
    blindPid.detail ?? "(no detail)");

  ok("pid-2. ⚠ and every result is marked practiceIdUnknown -- a blank id is not evidence of anything "
    + "when the read that would have filled it failed",
    blindPid.results.length > 0 && blindPid.results.every(r => r.practiceIdUnknown === true),
    `${blindPid.results.length} results, unknown=${blindPid.results.filter(r => r.practiceIdUnknown).length}`);

  ok("pid-control. the same query through the real client marks NOTHING unknown",
    goodSearch.results.length > 0 && goodSearch.results.every(r => r.practiceIdUnknown === false),
    `${goodSearch.results.filter(r => r.practiceIdUnknown).length} of ${goodSearch.results.length} flagged`);

  // ⚠ `detail` WAS COMPUTED BEFORE TWO PROBES HAD RUN. It was frozen at the fifth probe while `complete`
  // kept counting -- so a failed HYDRATE produced complete:false with detail:null, an incomplete answer
  // that could not say why. Found while wiring the practice-id probe, not by anything that was watching.
  const failingHydrate = {
    from: (table: string) => {
      if (table !== "practice_patient") return admin.from(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order", "ilike", "neq"]) chain[m] = () => chain;
      chain.limit = async () => ({ data: null, error: { message: "simulated hydrate failure" } });
      chain.then = undefined;
      return chain;
    },
  };
  const blindHydrate = await searchPatients(failingHydrate as never, wsA, "cm880412001");
  ok("detail-1. ⚠ a failure in a LATE probe reaches `detail` -- it used to be frozen before the last two "
    + "ran, so an incomplete answer could not say what broke",
    blindHydrate.complete === false && (blindHydrate.detail ?? "").length > 0,
    JSON.stringify({ complete: blindHydrate.complete, detail: blindHydrate.detail }));

  // The tenant filter that was missing on the hydrate read. Not a leak before -- the ids came from
  // workspace-scoped probes -- but it was the only read in the function keyed on ids alone, and "safe
  // because of where the ids came from" is a property of the caller, not of the query.
  const srcPatients = readFileSync(join(process.cwd(), "src", "lib", "practice", "patients.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const hydrateReads = [...srcPatients.matchAll(/from\("practice_patient"\)\s*\n?\s*\.select\([^)]*\)([\s\S]{0,200}?);/g)]
    .map(m => m[1]);
  ok("search-3. every practice_patient read in patients.ts carries its own workspace filter",
    hydrateReads.length > 0 && hydrateReads.every(r => /workspace_id/.test(r) || /\.eq\("id"/.test(r)),
    JSON.stringify(hydrateReads.filter(r => !/workspace_id/.test(r) && !/\.eq\("id"/.test(r))));

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
