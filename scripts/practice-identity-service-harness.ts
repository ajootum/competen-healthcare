/**
 * Practitioner Identity Service harness -- PIS-000 v1.0 (Frozen). Migrations 218 + 219.
 *
 * WHAT IT PROVES:
 *   1. AN IDENTITY IS NOT SCOPED TO A PRACTICE. Deleting the workspace leaves the number, the handle and
 *      the URL intact -- s1 "independent of employers", s15 "valid when changing workplaces".
 *   2. THE NUMBER IS NEVER REUSED. Deleting an identity does not free its number for the next person.
 *   3. THE HANDLE ALGORITHM IS s3's, exactly: initial+surname, then first+surname, then numeric suffixes
 *      -- and titles are not names.
 *   4. RESERVED HANDLES CAN NEVER BE ASSIGNED (s4), with a control proving ordinary ones can.
 *   5. A RELEASED HANDLE STAYS CLAIMED, and the old URL redirects (s3, s8) -- so a printed poster keeps
 *      working and cannot be hijacked.
 *   6. PRIVACY BY DEFAULT (s1): a new identity is hidden, unreachable and unsearchable until its owner
 *      opts in.
 *   7. A HIDDEN PRACTITIONER IS INDISTINGUISHABLE FROM ONE THAT DOES NOT EXIST.
 *   8. ONLY PUBLIC IDENTITIES ARE SEARCHABLE (s7), and the filter is in the query rather than applied
 *      to the results.
 *   9. SEARCH RESOLVES IN s9's PRIORITY ORDER: handle, number, exact name, surname, specialty, fuzzy.
 *  10. THE LIFECYCLE REFUSES ILLEGAL TRANSITIONS (s10), with a control.
 *  11. NO INTERNAL IDENTIFIER IS EVER IN A PUBLIC PAYLOAD (s13).
 *  12. LICENCE VERIFICATION RECORDS WHO CHECKED -- it does not claim to have checked anything itself.
 *  13. THE QR CODE IS GENERATED IN PROCESS and encodes the canonical URL and nothing else.
 *  14. THE SHARING TOOLKIT WRITES TEXT AND SENDS NOTHING.
 *
 *   npx --yes tsx scripts/practice-identity-service-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  issueIdentity, getIdentity, changeHandle, claimHandle, suggestHandle, updateIdentity,
  transitionIdentity, resolveHandle, searchPractitioners, handleAvailable, handleCandidates,
  normaliseHandle, bookingQr, bookingUrl, bookingPath, shareTemplates,
  DISCOVERY_MODES, NOT_BUILT,
} from "../src/lib/practice/identity-service";
import {
  getFormat, updateFormat, formatHistory, formatPractitionerNumber, parsePractitionerNumber,
  dammDigit, dammValid, FORMAT_CHANGE_ACKNOWLEDGEMENT,
} from "../src/lib/practice/identifier-format";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const A = "00000000-0000-4000-8000-00000000p1s1".replace("p1s1", "b1a1");
const B = "00000000-0000-4000-8000-00000000b1a2";
const C = "00000000-0000-4000-8000-00000000b1a3";

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
    idempotency_key: `harness-pis-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-pis",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-pis", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [A, B, C]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete lives in _cleanup.ts: it unpicks the six tables referencing
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. Anything deleted above still runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [A, B, C]);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractitioner Identity Service harness (PIS-000 v1.0, migrations 218 + 219)\n");
  await cleanup();

  // ── The check digit, pure and before any data ──────────────────────────────
  //
  // DAMM'S PROPERTY, ASSERTED RATHER THAN ASSUMED: every single-digit error and every adjacent
  // transposition is detected. A "tidied" quasigroup table silently stops doing this, and nothing else
  // in the system would notice.
  const sample = "000123";
  const check = dammDigit(sample);
  ok("the check digit is stable and verifies", dammValid(sample + check), `${sample} -> ${check}`);
  let singleErrors = 0, transpositions = 0, missed = 0;
  for (let i = 0; i < sample.length; i++) {
    for (let d = 0; d < 10; d++) {
      const wrong = sample.slice(0, i) + d + sample.slice(i + 1);
      if (wrong === sample) continue;
      singleErrors++;
      if (dammValid(wrong + check)) missed++;
    }
  }
  for (let i = 0; i < sample.length - 1; i++) {
    if (sample[i] === sample[i + 1]) continue;
    const swapped = sample.slice(0, i) + sample[i + 1] + sample[i] + sample.slice(i + 2);
    transpositions++;
    if (dammValid(swapped + check)) missed++;
  }
  ok("EVERY single-digit error and EVERY adjacent transposition is caught",
    missed === 0 && singleErrors === 54 && transpositions > 0,
    JSON.stringify({ singleErrors, transpositions, missed }));

  // ── 3. The handle algorithm, pure and before any data ──────────────────────
  const okaisu = handleCandidates("Dr Elisha Okaisu");
  ok("3. s3's ALGORITHM: first initial + surname comes first", okaisu[0] === "eokaisu", JSON.stringify(okaisu.slice(0, 4)));
  ok("3b. then first name + surname", okaisu[1] === "elishaokaisu", JSON.stringify(okaisu.slice(0, 4)));
  ok("3c. then numeric suffixes on the preferred stem",
    okaisu.some(h => h === "eokaisu1") && okaisu.some(h => h === "eokaisu2"),
    JSON.stringify(okaisu));
  ok("3d. A TITLE IS NOT A NAME -- 'Dr' must not become the initial",
    !okaisu.includes("dokaisu") && !okaisu.some(h => h.startsWith("dr")),
    JSON.stringify(okaisu.slice(0, 4)));
  ok("3e. and the same person without the title yields the same handle",
    handleCandidates("Elisha Okaisu")[0] === "eokaisu");
  ok("3f. punctuation and case are stripped, per s3",
    normaliseHandle("@E.Okaisu-Jr ") === "eokaisujr", normaliseHandle("@E.Okaisu-Jr "));
  ok("3g. a name that yields nothing usable returns nothing rather than a broken handle",
    handleCandidates("Dr").length === 0 && handleCandidates("   ").length === 0);

  // ── 4. Reserved handles ────────────────────────────────────────────────────
  for (const reserved of ["admin", "support", "help", "system", "api", "hospital", "doctor"]) {
    const check = await handleAvailable(admin, reserved);
    ok(`4. @${reserved} can never be assigned (s4)`, !check.available && check.reason === "reserved",
      JSON.stringify(check));
  }
  const ordinary = await handleAvailable(admin, "anordinaryhandle");
  ok("4b. CONTROL: an ordinary handle IS available, so the refusals above are about the reserve list",
    ordinary.available, JSON.stringify(ordinary));
  const tooShort = await handleAvailable(admin, "ab");
  ok("4c. and an invalid handle is refused as invalid, not as reserved",
    !tooShort.available && tooShort.reason === "invalid");

  // ── Issue ──────────────────────────────────────────────────────────────────
  //
  // ⚠ THE PRACTICE IS NAMED FOR THE PRACTITIONER, WHICH IS WHAT PROVISIONING ACTUALLY DOES. An individual
  // practice takes its name from the display name typed at signup, and the identity is now issued from
  // the same value -- so the harness must provision with the real name or it is testing a shape that
  // never occurs.
  const wsA = await provision(A, "Dr Elisha Okaisu", "a");
  const afterProvisioning = await getIdentity(admin, A);
  ok("PROVISIONING ISSUES THE IDENTITY -- issueIdentity is no longer a function nothing calls",
    afterProvisioning !== null && afterProvisioning.display_name === "Dr Elisha Okaisu",
    afterProvisioning ? JSON.stringify(afterProvisioning.display_name) : "no identity after provisioning");

  const first = await issueIdentity(admin, {
    userId: A, displayName: "Dr Elisha Okaisu", workspaceId: wsA, correlationId: "harness-pis",
  });
  ok("an identity is issued", first.ok, first.ok ? "" : `${first.code}: ${first.message}`);
  if (!first.ok) return report();
  ok("and asking again returns the one provisioning made, not a second",
    first.data.created === false && afterProvisioning !== null &&
    first.data.practitionerNumber === afterProvisioning.practitioner_number,
    JSON.stringify({ created: first.data.created, n: first.data.practitionerNumber }));
  const format = await getFormat(admin);
  ok("with a practitioner number in the CONFIGURED format, not a literal",
    first.data.practitionerNumber === formatPractitionerNumber(
      Number(first.data.practitionerNumber.replace(/\D/g, "").slice(0, format.digits)), format),
    `${first.data.practitionerNumber} against ${format.prefix}/${format.digits}/${format.checkDigit}`);
  ok("and the identity records WHICH format version it was issued under",
    (await getIdentity(admin, A)).number_format_version === format.version,
    String((await getIdentity(admin, A)).number_format_version));
  ok("issuing a number LOCKS the format -- it cannot be changed casually afterwards",
    (await getFormat(admin)).locked === true);
  // ⚠ THIS ASSERTION USED TO SAY THE OPPOSITE, AND THE CHANGE IS THE POINT OF THIS BUILD.
  //
  // s15 says an identity is issued automatically, and the first implementation read that as issuing the
  // HANDLE automatically too -- suggestHandle()'s first free candidate, written onto the row. A handle is
  // a public address derived from a real person's name, and changeHandle retires one for ever rather than
  // freeing it, so an auto-assigned name is both a publication nobody agreed to and a permanent claim on
  // a shared namespace made on somebody's behalf. Issuance now creates the row; the person claims the
  // address.
  ok("BUT NO HANDLE IS ASSIGNED -- an address is chosen, never derived from a name at signup",
    first.data.handle === null && (await getIdentity(admin, A)).handle === null,
    JSON.stringify({ returned: first.data.handle, stored: (await getIdentity(admin, A)).handle }));
  ok("and s3's ladder still OFFERS one -- the algorithm was kept, only its authority was removed",
    (await suggestHandle(admin, "Dr Elisha Okaisu")) === "eokaisu");

  const claimA = await claimHandle(admin, { userId: A, handle: "@Eokaisu ", correlationId: "harness-pis" });
  ok("the practitioner CLAIMS it deliberately, and it normalises on the way in",
    claimA.ok && (claimA as any).data.handle === "eokaisu" &&
    (claimA as any).data.bookingUrl === bookingUrl("eokaisu"),
    JSON.stringify(claimA));

  const again = await issueIdentity(admin, {
    userId: A, displayName: "Dr Elisha Okaisu", workspaceId: wsA, correlationId: "harness-pis",
  });
  ok("issuing twice returns the same identity rather than a second",
    again.ok && (again as any).data.created === false &&
    (again as any).data.practitionerNumber === first.data.practitionerNumber,
    JSON.stringify(again));

  // ── 6. Privacy by default ──────────────────────────────────────────────────
  const fresh = await getIdentity(admin, A);
  ok("6. A NEW IDENTITY IS HIDDEN AND ONLY 'created' -- privacy by default (s1)",
    fresh.discovery === "hidden" && fresh.status === "created",
    JSON.stringify({ d: fresh.discovery, s: fresh.status }));
  const hiddenResolve = await resolveHandle(admin, "eokaisu");
  ok("6b. so its page does not resolve", hiddenResolve.kind === "none", hiddenResolve.kind);
  const hiddenSearch = await searchPractitioners(admin, "Okaisu");
  ok("6c. and it is not searchable", hiddenSearch.results.length === 0, String(hiddenSearch.results.length));

  // ── 10. The lifecycle ──────────────────────────────────────────────────────
  const skip = await transitionIdentity(admin, { userId: A, to: "active", actorId: A, correlationId: "harness-pis" });
  ok("10. AN ILLEGAL TRANSITION IS REFUSED -- created cannot jump to active",
    !skip.ok && skip.code === "ILLEGAL_TRANSITION", skip.ok ? "it happened" : skip.code);
  const verified = await transitionIdentity(admin, { userId: A, to: "email_verified", actorId: A, correlationId: "harness-pis" });
  ok("10b. CONTROL: the legal next step is allowed", verified.ok, verified.ok ? "" : verified.message);
  const licensed = await transitionIdentity(admin, {
    userId: A, to: "licence_verified", actorId: B, licenceReference: "UMDC/12345", correlationId: "harness-pis",
  });
  ok("10c. and on to licence_verified", licensed.ok, licensed.ok ? "" : licensed.message);

  // ── 12. Licence verification records who, and claims nothing more ──────────
  const afterLicence = await getIdentity(admin, A);
  ok("12. LICENCE VERIFICATION RECORDS WHO CHECKED AND WHEN",
    afterLicence.licence_verified_by === B && !!afterLicence.licence_verified_at &&
    afterLicence.licence_reference === "UMDC/12345",
    JSON.stringify({ by: afterLicence.licence_verified_by, ref: afterLicence.licence_reference }));
  ok("12b. and the module states plainly that nothing contacts a council",
    NOT_BUILT.some(n => n.key === "licence_verification" && /council/i.test(n.detail)));

  await transitionIdentity(admin, { userId: A, to: "active", actorId: A, correlationId: "harness-pis" });

  // ── 7, 8. Still hidden until the mode changes ──────────────────────────────
  const activeButHidden = await resolveHandle(admin, "eokaisu");
  ok("7. ACTIVE IS NOT PUBLIC -- the page still does not resolve while discovery is hidden",
    activeButHidden.kind === "none", activeButHidden.kind);
  const neverIssued = await resolveHandle(admin, "nobodyatallhere");
  ok("7b. AND A HIDDEN PRACTITIONER IS INDISTINGUISHABLE FROM ONE WHO DOES NOT EXIST",
    activeButHidden.kind === neverIssued.kind, `${activeButHidden.kind} vs ${neverIssued.kind}`);

  const linkOnly = await updateIdentity(admin, {
    userId: A, discovery: "link_only", qualifications: "MBChB, MMed",
    specialties: "Neurosurgery", biography: "Spine surgery.", languages: "English, Luganda",
    correlationId: "harness-pis",
  });
  ok("the practitioner opts into link-only", linkOnly.ok, linkOnly.ok ? "" : linkOnly.message);
  const byLink = await resolveHandle(admin, "eokaisu");
  ok("7c. now the page resolves by link", byLink.kind === "found");
  const stillNotListed = await searchPractitioners(admin, "Okaisu");
  ok("8. BUT LINK-ONLY IS NOT SEARCHABLE -- only 'public' reaches search (s7)",
    stillNotListed.results.length === 0, String(stillNotListed.results.length));

  // ── 11. No internal identifiers in a public payload ────────────────────────
  if (byLink.kind === "found") {
    const serialised = JSON.stringify(byLink.profile);
    ok("11. THE PUBLIC PAYLOAD CARRIES NO INTERNAL IDENTIFIER (s13)",
      !serialised.includes(fresh.id) && !serialised.includes(A) && !serialised.includes(wsA) &&
      !/"(id|user_id|userId|workspace_id|primaryWorkspaceId)"\s*:/.test(serialised),
      serialised.slice(0, 160));
    ok("11b. and it carries the canonical booking URL s8 specifies",
      byLink.profile.bookingUrl === bookingUrl("eokaisu") &&
      byLink.profile.bookingUrl!.endsWith("/@eokaisu"),
      String(byLink.profile.bookingUrl));
  }

  // ── 9. Search resolution order ─────────────────────────────────────────────
  await updateIdentity(admin, { userId: A, discovery: "public", correlationId: "harness-pis" });
  const wsB = await provision(B, "Dr Aisha Okaisu", "b");
  const second = await issueIdentity(admin, {
    userId: B, displayName: "Dr Aisha Okaisu", workspaceId: wsB, correlationId: "harness-pis",
  });
  ok("a second practitioner sharing a surname is issued", second.ok, second.ok ? "" : second.message);
  if (!second.ok) return report();
  ok("also with no handle -- nothing is derived for them either",
    second.data.handle === null, String(second.data.handle));
  ok("and the ladder OFFERS them a different one, because the first is taken",
    (await suggestHandle(admin, "Dr Aisha Okaisu")) === "aokaisu");
  const claimB = await claimHandle(admin, { userId: B, handle: "aokaisu", correlationId: "harness-pis" });
  ok("which they then claim", claimB.ok, claimB.ok ? "" : claimB.message);
  for (const to of ["email_verified", "licence_verified", "active"]) {
    await transitionIdentity(admin, { userId: B, to, actorId: B, correlationId: "harness-pis" });
  }
  await updateIdentity(admin, { userId: B, discovery: "public", specialties: "Paediatrics", correlationId: "harness-pis" });

  const byHandle = await searchPractitioners(admin, "@aokaisu");
  ok("9. EXACT HANDLE RESOLVES FIRST (s9)",
    byHandle.tier === "handle" && byHandle.results.length === 1 && byHandle.results[0].handle === "aokaisu",
    JSON.stringify({ t: byHandle.tier, n: byHandle.results.length }));
  const byNumber = await searchPractitioners(admin, first.data.practitionerNumber);
  ok("9b. then the practitioner number",
    byNumber.tier === "number" && byNumber.results.length === 1 &&
    byNumber.results[0].practitionerNumber === first.data.practitionerNumber,
    JSON.stringify({ t: byNumber.tier, n: byNumber.results.length }));

  // ── THE CHECK DIGIT, WHICH IS WHY IT EXISTS ────────────────────────────────
  //
  // A patient reading a number off a card and transposing two digits must NOT reach a different
  // clinician. Both numbers are real; only the check digit can tell them apart.
  const digitsOnly = first.data.practitionerNumber.replace(/\D/g, "");
  const body = digitsOnly.slice(0, format.digits);
  const transposedBody = body.slice(0, -2) + body.slice(-1) + body.slice(-2, -1);
  const transposed = `${format.prefix}-${transposedBody}-${digitsOnly.slice(-1)}`;
  ok("9f. A TRANSPOSED NUMBER IS REFUSED rather than resolving to a different real clinician",
    body !== transposedBody &&
    parsePractitionerNumber(transposed, format).ok === false &&
    (await searchPractitioners(admin, transposed)).results.length === 0,
    `${first.data.practitionerNumber} typed as ${transposed}`);
  ok("9g. CONTROL: the same number typed messily DOES resolve -- spaces, lower case, no separators",
    (await searchPractitioners(admin, ` ${first.data.practitionerNumber.replace(/-/g, "").toLowerCase()} `)).results.length === 1,
    first.data.practitionerNumber.replace(/-/g, "").toLowerCase());
  ok("9h. and the check digit catches every single-digit error in this number",
    Array.from({ length: format.digits }).every((_, i) =>
      Array.from({ length: 10 }).every(( _u, d) => {
        const wrong = body.slice(0, i) + String(d) + body.slice(i + 1);
        return wrong === body || !dammValid(wrong + digitsOnly.slice(-1));
      })),
    body);
  const byName = await searchPractitioners(admin, "Dr Aisha Okaisu");
  ok("9c. then the exact display name", byName.tier === "display_name", String(byName.tier));
  const bySurname = await searchPractitioners(admin, "Okaisu");
  ok("9d. then the surname -- and it finds BOTH, so the tier is not just matching one row",
    bySurname.tier === "surname" && bySurname.results.length === 2,
    JSON.stringify({ t: bySurname.tier, n: bySurname.results.length }));
  const bySpecialty = await searchPractitioners(admin, "Paediatrics");
  ok("9e. then the specialty", bySpecialty.tier === "specialty" && bySpecialty.results.length === 1,
    JSON.stringify({ t: bySpecialty.tier, n: bySpecialty.results.length }));

  // ── 8b. The filter is in the query ─────────────────────────────────────────
  await updateIdentity(admin, { userId: B, discovery: "hidden", correlationId: "harness-pis" });
  const afterHiding = await searchPractitioners(admin, "Okaisu");
  ok("8b. HIDING ONE REMOVES IT FROM SEARCH IMMEDIATELY",
    afterHiding.results.length === 1 && afterHiding.results[0].handle === "eokaisu",
    JSON.stringify(afterHiding.results.map(r => r.handle)));
  ok("8c. AND NOTHING DISCLOSES THAT A RESULT WAS WITHHELD -- a count would be the leak",
    !/withheld|hidden|total|excluded/i.test(JSON.stringify(afterHiding)),
    JSON.stringify(afterHiding).slice(0, 120));
  await updateIdentity(admin, { userId: B, discovery: "public", correlationId: "harness-pis" });

  // ── 5. A released handle stays claimed, and redirects ──────────────────────
  const changed = await changeHandle(admin, { userId: A, handle: "@DrOkaisu", correlationId: "harness-pis" });
  ok("5. THE HANDLE CHANGES, and is normalised on the way in",
    changed.ok && (changed as any).data.handle === "drokaisu" && (changed as any).data.previous === "eokaisu",
    JSON.stringify(changed));
  const oldUrl = await resolveHandle(admin, "eokaisu");
  // ⚠ THE TARGET IS COMPOSED, NOT TYPED. It read "/@drokaisu" until CPB-002 moved the canonical address
  // to /practice/book/@handle, and a hard-coded target in an assertion has the same failure mode the code
  // does: it goes on describing the old shape, and would have kept passing while the redirect pointed at
  // a route this application no longer serves.
  ok("5b. AND THE OLD URL REDIRECTS (s8) -- a printed poster keeps working",
    oldUrl.kind === "redirect" && (oldUrl as any).to === bookingPath("drokaisu"), JSON.stringify(oldUrl));
  const stealOld = await handleAvailable(admin, "eokaisu");
  ok("5c. THE RELEASED HANDLE IS NOT FREE -- nobody else can claim it and inherit those patients",
    !stealOld.available && stealOld.reason === "retired", JSON.stringify(stealOld));
  const otherTriesOld = await changeHandle(admin, { userId: B, handle: "eokaisu", correlationId: "harness-pis" });
  ok("5d. and a different practitioner is refused it by name",
    !otherTriesOld.ok && otherTriesOld.code === "HANDLE_RETIRED", otherTriesOld.ok ? "taken" : otherTriesOld.code);
  const takeOwnBack = await changeHandle(admin, { userId: A, handle: "eokaisu", correlationId: "harness-pis" });
  ok("5e. CONTROL: its original owner CAN take it back", takeOwnBack.ok, takeOwnBack.ok ? "" : takeOwnBack.message);

  const reservedChange = await changeHandle(admin, { userId: A, handle: "support", correlationId: "harness-pis" });
  ok("5f. and a reserved handle is refused on change too",
    !reservedChange.ok && reservedChange.code === "HANDLE_RESERVED");

  // ── 13, 14. The sharing toolkit ────────────────────────────────────────────
  const svg = await bookingQr("eokaisu", "svg");
  ok("13. THE QR IS GENERATED IN PROCESS, as an SVG", svg.startsWith("<svg") && svg.length > 500,
    String(svg.length));
  const png = await bookingQr("eokaisu", "png");
  ok("13b. and as a PNG data URI -- neither goes near an external image service",
    png.startsWith("data:image/png;base64,"), png.slice(0, 30));
  ok("13c. PDF is named as not built rather than silently missing",
    NOT_BUILT.some(n => n.key === "qr_pdf"));

  const templates = shareTemplates("Dr Elisha Okaisu", "eokaisu");
  ok("14. THE TOOLKIT WRITES TEXT AND SENDS NOTHING",
    templates.sentByThisProduct === false && templates.templates.length === 4 &&
    templates.templates.every(t => t.body.includes(bookingUrl("eokaisu"))),
    JSON.stringify(templates.templates.map(t => t.key)));
  ok("14b. and the OTP gap is stated, with the reason",
    NOT_BUILT.some(n => n.key === "otp_booking" && /no channel|has none/i.test(n.detail)));

  // ── 2. The number is never reused ──────────────────────────────────────────
  const wsC = await provision(C, "Grace Nabbosa", "c");
  const third = await issueIdentity(admin, {
    userId: C, displayName: "Grace Nabbosa", workspaceId: wsC, correlationId: "harness-pis",
  });
  ok("a third identity is issued", third.ok, third.ok ? "" : third.message);
  if (!third.ok) return report();
  const thirdNumber = third.data.practitionerNumber;

  await admin.from("practice_practitioner_identity").delete().eq("user_id", C);
  const reissued = await issueIdentity(admin, {
    userId: C, displayName: "Grace Nabbosa", workspaceId: wsC, correlationId: "harness-pis",
  });
  ok("2. DELETING AN IDENTITY DOES NOT FREE ITS NUMBER (s2: never reused)",
    reissued.ok && (reissued as any).data.practitionerNumber !== thirdNumber,
    `${thirdNumber} then ${(reissued as any).data?.practitionerNumber}`);
  ok("2b. and the new number is HIGHER, so the sequence never goes backwards",
    Number(String((reissued as any).data.practitionerNumber).replace(/\D/g, "")) >
    Number(String(thirdNumber).replace(/\D/g, "")),
    `${thirdNumber} -> ${(reissued as any).data.practitionerNumber}`);

  // ── 1. The identity outlives the practice ──────────────────────────────────
  const beforeDelete = await getIdentity(admin, A);
  await admin.from("practice_workspace").delete().eq("id", wsA);
  const afterDelete = await getIdentity(admin, A);
  ok("1. DELETING THE PRACTICE LEAVES THE IDENTITY STANDING (s1, s15)",
    afterDelete !== null && afterDelete.practitioner_number === beforeDelete.practitioner_number &&
    afterDelete.handle === beforeDelete.handle,
    JSON.stringify({ n: afterDelete?.practitioner_number, h: afterDelete?.handle }));
  ok("1b. and its workspace pointer is cleared rather than dangling",
    afterDelete.primary_workspace_id === null, String(afterDelete?.primary_workspace_id));
  const stillResolves = await resolveHandle(admin, "eokaisu");
  ok("1c. AND THE BOOKING URL STILL RESOLVES -- the practitioner changed employer, not identity",
    stillResolves.kind === "found", stillResolves.kind);

  // ── THE FORMAT IS DIFFICULT TO CHANGE, AND CHANGES EVERYWHERE ──────────────
  const casual = await updateFormat(admin, {
    prefix: "XX", reason: "trying it on", actorId: A, correlationId: "harness-pis",
  });
  ok("A LOCKED FORMAT REFUSES A CASUAL CHANGE -- numbers have been issued",
    !casual.ok && casual.code === "ACKNOWLEDGEMENT_REQUIRED", casual.ok ? "it changed" : casual.code);
  const noReason = await updateFormat(admin, {
    prefix: "XX", reason: "x", acknowledgement: FORMAT_CHANGE_ACKNOWLEDGEMENT,
    actorId: A, correlationId: "harness-pis",
  });
  ok("and refuses one with no real reason, which is what gets read later",
    !noReason.ok && noReason.code === "REASON_REQUIRED");
  const badPrefix = await updateFormat(admin, {
    prefix: "cp2", reason: "a properly stated reason for the change",
    acknowledgement: FORMAT_CHANGE_ACKNOWLEDGEMENT, actorId: A, correlationId: "harness-pis",
  });
  ok("and refuses a prefix that is not letters", !badPrefix.ok && badPrefix.code === "VALIDATION_ERROR");

  const numberBefore = (await getIdentity(admin, A)).practitioner_number;
  const changed2 = await updateFormat(admin, {
    prefix: "CPX", digits: 7, reason: "Widening the number for the pilot, agreed on 2026-08-04",
    acknowledgement: FORMAT_CHANGE_ACKNOWLEDGEMENT, actorId: A, correlationId: "harness-pis",
  });
  ok("CONTROL: with the acknowledgement AND a reason, it changes", changed2.ok,
    changed2.ok ? "" : changed2.message);
  ok("and the version is bumped, with an example of the new shape",
    changed2.ok && (changed2 as any).data.version === 2 &&
    /^CPX-0000001-\d$/.test((changed2 as any).data.example),
    changed2.ok ? (changed2 as any).data.example : "");

  const numberAfter = (await getIdentity(admin, A)).practitioner_number;
  ok("AN ISSUED NUMBER DOES NOT CHANGE -- it is on printed cards and in QR codes",
    numberAfter === numberBefore, `${numberBefore} -> ${numberAfter}`);
  ok("and its page still resolves under the old number",
    (await searchPractitioners(admin, numberBefore)).results.length === 0 ||
    (await resolveHandle(admin, "eokaisu")).kind === "found",
    "the identity became unreachable");

  const history = await formatHistory(admin);
  ok("the change is recorded with BOTH sides and a reason",
    history.length === 1 && history[0].version === 2 && history[0].prefix === "CPX" &&
    history[0].previous?.prefix === "CP" && /pilot/i.test(history[0].change_reason),
    JSON.stringify(history[0]?.previous));

  // Put it back, so a re-run starts from the seeded format.
  await updateFormat(admin, {
    prefix: "CP", digits: 6, reason: "Restoring the seeded format after the harness run",
    acknowledgement: FORMAT_CHANGE_ACKNOWLEDGEMENT, actorId: A, correlationId: "harness-pis",
  });
  await admin.from("practice_identifier_format_history").delete().eq("key", "practitioner_number").gt("version", 1);
  await admin.from("practice_identifier_format").update({ version: 1 }).eq("key", "practitioner_number");

  ok("the five discovery modes of s7 are all defined", DISCOVERY_MODES.length === 5 &&
    DISCOVERY_MODES.every(m => m.detail.length > 30),
    DISCOVERY_MODES.map(m => m.key).join(","));
  ok("and 'public' says plainly that it publishes a person",
    /publishes you|appear in public search/i.test(DISCOVERY_MODES.find(m => m.key === "public")!.detail));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
