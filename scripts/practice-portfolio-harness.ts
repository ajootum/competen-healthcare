/**
 * Professional Portfolio harness -- CPR-240. Migration 217.
 *
 * WHY THIS ONE IS STRICTER THAN THE OTHERS: a portfolio goes to an appraiser, a regulator or a
 * credentialing committee, under the practitioner's name. An invented figure here does not merely
 * mislead a user -- it travels, and the clinician is the one who signed it.
 *
 * WHAT IT PROVES:
 *   1. THE COVERAGE WINDOW IS COMPUTED FROM THE RECORD, not configured, so it cannot be set to a
 *      flattering date -- and it appears on the portfolio AND as the first field of the export.
 *   2. AN EMPTY PRACTICE SAYS SO rather than reporting zeroes that read as a quiet career.
 *   3. NOTHING IS "VERIFIED", and every figure carries its provenance: recorded here, or declared.
 *   4. NO SCORE ANYWHERE, asserted structurally over the whole serialised portfolio and export.
 *   5. THE COUNTS ARE REAL AND DISCRIMINATE -- people are counted as people, not as visits.
 *   6. ONLY THE CALLER'S OWN WORK COUNTS. A colleague's procedures do not inflate this portfolio.
 *   7. EXPIRY IS DERIVED, NEVER STORED, with a control proving a live certificate is not flagged.
 *   8. A CERTIFICATE THAT EXPIRES BEFORE IT WAS AWARDED IS REFUSED.
 *   9. REFLECTIONS ARE COUNTED, NEVER QUOTED -- their text does not reach the portfolio or the export.
 *  10. DECLARED ENTRIES BELONG TO THEIR AUTHOR; a colleague cannot remove one.
 *  11. THE EXPORT CARRIES ITS CAVEATS AS FIELDS, and says it was not sent anywhere.
 *  12. Cross-PERSON isolation, non-vacuously.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * AND SINCE MIGRATION 270 (CPR-IDENT-SURVEY-001, D1-D4) FOUR MORE, EACH WITH A CONTROL:
 *
 *  13. AN ENTRY IS STILL READABLE BY ITS AUTHOR AFTER THE PRACTICE IT WAS TYPED IN IS ARCHIVED.
 *      CONTROL: the practice really is shut -- resolveWorkspaceContext refuses it -- so the assertion is
 *      about person-scoping and not about an archive that did not happen.
 *  14. A SELF-DECLARED REGISTRATION NUMBER IS DISTINGUISHABLE FROM A VERIFIED LICENCE AT THE DATABASE
 *      LEVEL: the column name carries the provenance, the bare name does not exist, and a licence check
 *      with nobody behind it is REFUSED BY POSTGRES. CONTROL: with a verifier it is accepted.
 *  15. THE EXPORT CARRIES THE PROFESSIONAL RECORD -- both the practice export (the entries typed there)
 *      and a person-scoped export that takes NO WORKSPACE AT ALL. CONTROL: somebody else's export
 *      carries none of it.
 *  16. THE WRITE-TIME WARNING IS PRESENT ON ALL THREE FREE-TEXT FIELDS, in the engine and rendered by
 *      the form. CONTROL: the source scan strips comments first, and proves it stripped them.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   npx --yes tsx scripts/practice-portfolio-harness.ts
 */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { recordProcedure } from "../src/lib/practice/procedures";
import { recordActivity, setPortfolio } from "../src/lib/practice/clinical-activity";
import { writeReflection } from "../src/lib/practice/reflection";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";
import {
  buildPortfolio, exportPortfolio, saveProfile, getProfile, addEntry, removeEntry,
  buildProfessionalRecord, exportProfessionalRecord,
  PORTFOLIO_LIMITS, PROVENANCE, PORTABLE_ENTRY_NOTICE, PORTABLE_FIELDS,
} from "../src/lib/practice/portfolio";
import { EXPORT_SECTIONS, exportPractice, PERSON_SCOPED_EXPORT_PATH } from "../src/lib/practice/lifecycle";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000c240a";
const OTHER = "00000000-0000-4000-8000-0000000c240b";

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
    idempotency_key: `harness-pf-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-pf",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-pf", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
  // ⚠ NEW SINCE MIGRATION 270, AND FOR THE REASON THIS WHOLE BUILD EXISTS: a portfolio entry and a
  // practitioner identity now OUTLIVE the workspace, so purging the workspace no longer removes them.
  // Left behind they would accumulate across runs and every count in section 5 would drift upwards --
  // which would read as an engine bug rather than as a teardown that stopped being complete.
  for (const table of ["practice_portfolio_entry", "practice_practitioner_identity"] as const) {
    const { error } = await admin.from(table).delete().in("user_id", [OWNER, OTHER]);
    if (error) console.log(`  cleanup: ${table} -- ${error.message}`);
  }
}

const base = { actorId: OWNER, correlationId: "harness-pf" };
const day = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10);
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ⚠ IS MIGRATION 270 APPLIED?
 *
 * Asked first, and REPORTED rather than acted on. Nothing below is skipped when the answer is no: a
 * skipped assertion is a vacuous one, and a harness that goes quiet on an unapplied migration is exactly
 * how a schema and an engine drift apart. What this buys is that the wall of red says "apply 270" instead
 * of reading as a defect in the engine.
 */
async function preflight() {
  const declared = await admin.from("practice_practitioner_identity")
    .select("self_declared_registration_number").limit(1);
  const retired = await admin.from("practice_practitioner_profile").select("id").limit(1);
  const applied = !declared.error && !!retired.error;
  if (!applied) {
    console.log("  ────────────────────────────────────────────────────────────────────────────");
    console.log("  MIGRATION 270 IS NOT APPLIED. Everything below runs anyway and nothing is");
    console.log("  skipped, so the failures are real -- but the cause is the schema, not the engine.");
    console.log(`    self_declared_* columns present: ${!declared.error}${declared.error ? ` (${declared.error.message})` : ""}`);
    console.log(`    practice_practitioner_profile retired: ${!!retired.error}`);
    console.log("  ────────────────────────────────────────────────────────────────────────────\n");
  }
  return applied;
}

async function main() {
  console.log("\nProfessional Portfolio harness (CPR-240, migrations 217 and 270)\n");
  const applied = await preflight();
  ok("0. MIGRATION 270 IS APPLIED -- the professional record is person-scoped in the schema", applied,
    "apply migration 270 (its DDL is in the header of src/lib/practice/portfolio.ts)");
  await cleanup();

  // ── 3, 11. The stated position, before any data ────────────────────────────
  ok("3. THE TWO PROVENANCES ARE DEFINED, and neither is called 'verified'",
    PROVENANCE.sourceLinked.key === "source_linked" && PROVENANCE.selfDeclared.key === "self_declared" &&
    !/verif/i.test(PROVENANCE.sourceLinked.label + PROVENANCE.selfDeclared.label),
    `${PROVENANCE.sourceLinked.label} / ${PROVENANCE.selfDeclared.label}`);
  ok("3b. and the self-declared one says plainly that nothing was checked",
    /nothing here checked it/i.test(PROVENANCE.selfDeclared.detail));
  ok("11. THE LIMITS NAME THE TWO AN APPRAISER WOULD OTHERWISE ASSUME -- coverage and verification",
    PORTFOLIO_LIMITS.some(l => l.key === "coverage" && /not a complete record|not your career/i.test(l.label + l.detail)) &&
    PORTFOLIO_LIMITS.some(l => l.key === "verification") &&
    PORTFOLIO_LIMITS.some(l => l.key === "score") &&
    PORTFOLIO_LIMITS.every(l => l.detail.length > 80),
    PORTFOLIO_LIMITS.map(l => l.key).join(","));

  const wsA = await provision(OWNER, "HARNESS Portfolio A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Portfolio B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── 2. An empty practice says so ───────────────────────────────────────────
  const empty = await buildPortfolio(admin, a.ctx);
  ok("2. AN EMPTY PRACTICE REPORTS NO COVERAGE AT ALL, rather than a window it cannot support",
    empty.coverage.from === null && /Nothing has been recorded/i.test(empty.coverage.statement),
    JSON.stringify(empty.coverage));
  ok("2b. and the statement STILL says it is not a career record",
    /not a (complete )?record of this practitioner's career/i.test(empty.coverage.statement),
    empty.coverage.statement);
  ok("2c. with every count at zero rather than absent",
    empty.recorded.consultations === 0 && empty.recorded.patients === 0 &&
    empty.recorded.procedures === 0 && empty.declared.total === 0);

  // ── The fixture ────────────────────────────────────────────────────────────
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Ssemakula John", sex: "male", birthDate: "1971-04-04",
    phone: "0772 240 001", ...base,
  });
  const p2 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Namuli Rose", sex: "female", birthDate: "1990-11-11",
    phone: "0772 240 002", ...base,
  });
  if (!p1.ok || !p2.ok) { ok("fixture patients register", false); return report(); }
  ok("fixture patients register", true);

  // THREE CONSULTATIONS ACROSS TWO PEOPLE, so "people seen" and "consultations" must differ.
  const encounters: string[] = [];
  for (const [i, pid] of [p1.data.id, p1.data.id, p2.data.id].entries()) {
    const e = await launchEncounter(admin, {
      workspaceId: wsA, patientId: pid, pathway: "new_walk_in", reasonForVisit: `Visit ${i}`, ...base,
    });
    if (!e.ok) continue;
    encounters.push(e.data.id);
    await transitionEncounter(admin, { workspaceId: wsA, encounterId: e.data.id, to: "ACTIVE", ...base });
    await transitionEncounter(admin, { workspaceId: wsA, encounterId: e.data.id, to: "COMPLETED", ...base });
  }
  ok("three consultations across two people exist", encounters.length === 3, String(encounters.length));

  // THE PROCEDURE GOES IN BEFORE THE SIGNATURE. Migration 194's trigger makes a signed encounter
  // immutable, and a fixture that writes afterwards gets a refusal that reads later as a bug in the
  // engine -- the same trap the CPR-200 fixture hit.
  const proc = await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encounters[0], label: "Joint injection",
    consentStatus: "obtained", status: "PERFORMED", ...base,
  });
  ok("a procedure is recorded", proc.ok, proc.ok ? "" : proc.message);
  for (const id of encounters) {
    await transitionEncounter(admin, { workspaceId: wsA, encounterId: id, to: "SIGNED", ...base });
  }
  // CPD MINUTES ARE SET SEPARATELY, by CPR-150's setPortfolio -- recording a procedure does not claim
  // CPD for it, because whether a routine procedure counts towards development is the clinician's call.
  const claimed = proc.ok ? await setPortfolio(admin, {
    workspaceId: wsA, subject: "procedure", id: proc.data.id, portfolio: true, cpdMinutes: 30,
    actorId: OWNER, correlationId: "harness-pf",
  }) : null;
  ok("and CPD minutes are claimed against it", !!claimed?.ok, claimed && !claimed.ok ? claimed.message : "");
  const teaching = await recordActivity(admin, {
    workspaceId: wsA, kind: "teaching", title: "Registrar teaching -- shoulder examination",
    occurredAt: new Date().toISOString(), durationMinutes: 60, cpdMinutes: 60, portfolio: true, ...base,
  });
  ok("a teaching activity is recorded", teaching.ok, teaching.ok ? "" : teaching.message);
  const refl = await writeReflection(admin, a.ctx, {
    encounterId: encounters[0], category: "professional_growth",
    learned: "SUPERSECRETREFLECTIONTEXT -- the injection approach that worked here.",
    correlationId: "harness-pf",
  });
  ok("a reflection is written", refl.ok, refl.ok ? "" : refl.message);

  // ── 1. The coverage window ─────────────────────────────────────────────────
  const p = await buildPortfolio(admin, a.ctx);
  ok("1. THE COVERAGE WINDOW IS NOW A REAL DATE, taken from the earliest thing recorded",
    p.coverage.from === new Date().toISOString().slice(0, 10),
    JSON.stringify(p.coverage));
  ok("1b. and the statement names that date and disclaims a career",
    p.coverage.statement.includes(p.coverage.from!) &&
    /not a complete record/i.test(p.coverage.statement),
    p.coverage.statement);
  ok("1c. THERE IS NO WAY TO SET IT -- the engine exposes no coverage parameter",
    !("setCoverage" in (await import("../src/lib/practice/portfolio"))),
    "a setter exists");

  // ── 5. Counts are real and discriminate ────────────────────────────────────
  ok("5. PEOPLE ARE COUNTED AS PEOPLE, NOT AS VISITS -- three consultations, two people",
    p.recorded.consultations === 3 && p.recorded.patients === 2,
    JSON.stringify({ c: p.recorded.consultations, pt: p.recorded.patients }));
  ok("5b. procedures and teaching are counted from where they actually live",
    p.recorded.procedures === 1 && p.recorded.teachingSessions === 1 && p.recorded.activities === 1,
    JSON.stringify({ pr: p.recorded.procedures, t: p.recorded.teachingSessions }));
  ok("5c. CPD minutes are summed across procedures AND activities",
    p.recorded.cpdMinutes === 90, String(p.recorded.cpdMinutes));
  ok("5d. and the procedure breakdown names what was done",
    p.recorded.procedureTypes.length === 1 && p.recorded.procedureTypes[0].label === "Joint injection",
    JSON.stringify(p.recorded.procedureTypes));

  // ── 9. Reflections counted, never quoted ───────────────────────────────────
  ok("9. REFLECTIONS ARE COUNTED", p.recorded.reflections === 1, String(p.recorded.reflections));
  ok("9b. AND THEIR TEXT IS NOWHERE IN THE PORTFOLIO -- a reflection is private, an export is not",
    !JSON.stringify(p).includes("SUPERSECRETREFLECTIONTEXT"),
    "the reflection text leaked into the portfolio");

  // ── 6. Only the caller's own work ──────────────────────────────────────────
  const { data: om, error: memberError } = await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: OTHER, role_code: "practitioner", status: "active",
  }).select("id").single();
  ok("a colleague joins the practice", memberError === null && !!om, memberError?.message ?? "");
  if (!om) return report();
  const { error: capError } = await admin.from("practice_role_assignment").insert(
    ["practice.home.view", "encounter.list", "encounter.create", "encounter.edit", "procedure.record", "patient.view", "patient.list"].map(c => ({
      membership_id: om.id, capability_code: c, source: "explicit_grant", created_by: OWNER,
    })),
  );
  ok("and holds the capabilities to do clinical work", capError === null, capError?.message ?? "");
  const colleague = await resolveWorkspaceContext(admin, OTHER, wsA);
  if (!colleague.ok) { ok("colleague context resolves", false); return report(); }

  const theirEncounter = await launchEncounter(admin, {
    workspaceId: wsA, patientId: p2.data.id, pathway: "new_walk_in", reasonForVisit: "Their own patient",
    actorId: OTHER, correlationId: "harness-pf",
  });
  ok("the colleague records a consultation of their own", theirEncounter.ok,
    theirEncounter.ok ? "" : theirEncounter.message);
  if (theirEncounter.ok) {
    const theirProc = await recordProcedure(admin, {
      workspaceId: wsA, encounterId: theirEncounter.data.id, label: "Their procedure",
      consentStatus: "obtained", status: "PERFORMED",
      actorId: OTHER, correlationId: "harness-pf",
    });
    const theirClaim = theirProc.ok ? await setPortfolio(admin, {
      workspaceId: wsA, subject: "procedure", id: theirProc.data.id, portfolio: true, cpdMinutes: 500,
      actorId: OTHER, correlationId: "harness-pf",
    }) : null;
    // CHECKED, because the control below depends on it. An unchecked fixture write that failed would
    // make "their work appears in their portfolio" look like a bug in the composer.
    ok("the colleague's procedure and CPD claim both land",
      theirProc.ok && !!theirClaim?.ok,
      [theirProc.ok ? "" : theirProc.message, theirClaim && !theirClaim.ok ? theirClaim.message : ""].join(" | "));
  }

  const mineAfter = await buildPortfolio(admin, a.ctx);
  ok("6. A COLLEAGUE'S WORK DOES NOT INFLATE THIS PORTFOLIO",
    mineAfter.recorded.consultations === 3 && mineAfter.recorded.procedures === 1 &&
    mineAfter.recorded.cpdMinutes === 90,
    JSON.stringify({ c: mineAfter.recorded.consultations, p: mineAfter.recorded.procedures, cpd: mineAfter.recorded.cpdMinutes }));
  // CONTROL: their work DID land, so the assertion above is about scoping and not about a failed write.
  const theirs = await buildPortfolio(admin, colleague.ctx);
  ok("6b. CONTROL: and it does appear in THEIR portfolio",
    theirs.recorded.consultations === 1 && theirs.recorded.procedures === 1 && theirs.recorded.cpdMinutes === 500,
    JSON.stringify({ c: theirs.recorded.consultations, p: theirs.recorded.procedures, cpd: theirs.recorded.cpdMinutes }));

  // ── 7, 8. Declared entries and derived expiry ──────────────────────────────
  const lapsed = await addEntry(admin, a.ctx, {
    kind: "certification", title: "Advanced life support", organisation: "Resuscitation Council",
    occurredOn: day(-1000), expiresOn: day(-10), correlationId: "harness-pf",
  });
  const live = await addEntry(admin, a.ctx, {
    kind: "certification", title: "Basic life support", organisation: "Resuscitation Council",
    occurredOn: day(-100), expiresOn: day(400), correlationId: "harness-pf",
  });
  const soon = await addEntry(admin, a.ctx, {
    kind: "certification", title: "Radiation safety", occurredOn: day(-700), expiresOn: day(30),
    correlationId: "harness-pf",
  });
  const paper = await addEntry(admin, a.ctx, {
    kind: "publication", title: "Outcomes after joint injection in a rural clinic",
    reference: "doi:10.0000/example", occurredOn: day(-200), correlationId: "harness-pf",
  });
  ok("four declared entries are added", lapsed.ok && live.ok && soon.ok && paper.ok,
    [lapsed, live, soon, paper].map(r => r.ok ? "ok" : r.message).join(" | "));

  const backwards = await addEntry(admin, a.ctx, {
    kind: "certification", title: "Impossible certificate",
    occurredOn: day(-10), expiresOn: day(-100), correlationId: "harness-pf",
  });
  ok("8. A CERTIFICATE THAT EXPIRES BEFORE IT WAS AWARDED IS REFUSED",
    !backwards.ok && backwards.code === "EXPIRES_BEFORE_ISSUE");
  const badKind = await addEntry(admin, a.ctx, {
    kind: "nobel_prize", title: "Something not in the taxonomy", correlationId: "harness-pf",
  });
  ok("8b. and an unknown kind is refused rather than stored as free text",
    !badKind.ok && badKind.code === "VALIDATION_ERROR");

  const withEntries = await buildPortfolio(admin, a.ctx);
  const certs = withEntries.declared.byKind.find((g: any) => g.key === "certification");
  const expiredOne = certs?.items.find((i: any) => i.title === "Advanced life support");
  const liveOne = certs?.items.find((i: any) => i.title === "Basic life support");
  const soonOne = certs?.items.find((i: any) => i.title === "Radiation safety");
  ok("7. EXPIRY IS DERIVED: the lapsed certificate is flagged",
    expiredOne?.expired === true, JSON.stringify(expiredOne));
  ok("7b. CONTROL: the live one is NOT -- so 'expired' is not a flag set on everything",
    liveOne?.expired === false && liveOne?.expiringSoon === false, JSON.stringify(liveOne));
  ok("7c. and one expiring inside ninety days is flagged as expiring, not as expired",
    soonOne?.expired === false && soonOne?.expiringSoon === true, JSON.stringify(soonOne));
  ok("7d. NO EXPIRED COLUMN EXISTS -- it could not have been stored",
    !("expired" in ((await admin.from("practice_portfolio_entry").select("*")
      .eq("id", (lapsed as any).data.id).maybeSingle()).data ?? {})),
    "an expired column exists");
  ok("7e. and both appear in the attention list, the live one does not",
    withEntries.attention.expiring.length === 2 &&
    !withEntries.attention.expiring.some((e: any) => e.title === "Basic life support"),
    JSON.stringify(withEntries.attention.expiring.map((e: any) => e.title)));
  ok("7f. every declared item is labelled as declared, never as verified",
    withEntries.declared.byKind.flatMap((g: any) => g.items).every((i: any) => i.provenance === "self_declared"));

  // ── The profile, which now lives on the PERSON-scoped identity (D2) ────────
  const savedProfile = await saveProfile(admin, OWNER, {
    fullName: "Dr Aisha Nakimuli", profession: "Medical doctor", specialty: "General practice",
    registrationNumber: "MED/2016/UG/12345", registrationBody: "Uganda Medical and Dental Council",
    practisingSince: "2016-03-01", workspaceId: wsA, correlationId: "harness-pf",
  });
  ok("the practitioner profile saves", savedProfile.ok, savedProfile.ok ? "" : savedProfile.message);
  const again = await saveProfile(admin, OWNER, { specialty: "Family medicine", correlationId: "harness-pf" });
  ok("and saving again UPDATES rather than creating a second", again.ok);
  const { count: identityRows } = await admin.from("practice_practitioner_identity")
    .select("*", { count: "exact", head: true }).eq("user_id", OWNER);
  ok("so there is exactly ONE row describing this person, and it is the identity", identityRows === 1,
    String(identityRows));
  // ⚠ AND THE RETIRED TABLE IS GONE. Two person-scoped tables describing one person is the duplication
  // D2 retired; a second store that still existed would be the same defect under a new name.
  const retired = await admin.from("practice_practitioner_profile").select("id").limit(1);
  ok("D2. practice_practitioner_profile NO LONGER EXISTS -- the duplicate store was retired, not re-keyed",
    !!retired.error, retired.error ? retired.error.message : "the table is still there");

  const profile = await getProfile(admin, OWNER);
  ok("and the update landed while the untouched fields survived",
    profile?.specialties === "Family medicine" && profile?.display_name === "Dr Aisha Nakimuli",
    JSON.stringify({ s: profile?.specialties, n: profile?.display_name }));
  const badDate = await saveProfile(admin, OWNER, { practisingSince: "March 2016", correlationId: "harness-pf" });
  ok("a date that is not a date is refused", !badDate.ok && badDate.code === "VALIDATION_ERROR");
  // ⚠ IT WILL NOT CREATE A SECOND STORE FOR SOMEBODY WITH NO IDENTITY. A practitioner number is
  // permanent and comes from a sequence; a save that quietly invented a row would be D2 undone.
  const noIdentity = await saveProfile(admin, "00000000-0000-4000-8000-0000000c240f", {
    fullName: "Nobody At All", correlationId: "harness-pf",
  });
  ok("and a person with no identity is REFUSED rather than given a second store",
    !noIdentity.ok && noIdentity.code === "NO_IDENTITY",
    noIdentity.ok ? "a row was created" : noIdentity.code);

  const withProfile = await buildPortfolio(admin, a.ctx);
  ok("THE PRACTISING-SINCE DATE AND THE COVERAGE WINDOW ARE KEPT APART",
    withProfile.profile?.self_declared_practising_since === "2016-03-01" &&
    withProfile.coverage.from !== "2016-03-01",
    JSON.stringify({ since: withProfile.profile?.self_declared_practising_since, from: withProfile.coverage.from }));
  ok("and the profile is labelled declared, not verified",
    withProfile.profile?.provenance === "self_declared");

  // ── 4. No score anywhere ───────────────────────────────────────────────────
  const serialised = JSON.stringify(withProfile);
  const scoreField = /"(score|portfolio_score|portfolioScore|rating|strength|grade)"\s*:/i.exec(serialised);
  ok("4. NO SCORE FIELD IN THE PORTFOLIO -- the comp's 842/1000 could not be rendered from it",
    scoreField === null, scoreField?.[0] ?? "");
  const percentShaped = /:\s*"?\d{1,3}(\.\d+)?\s*%/.exec(serialised);
  ok("4b. and no percentage-shaped value -- the comp's donut and CPD target included",
    percentShaped === null, percentShaped?.[0] ?? "");
  ok("4c. the payload says so as FIELDS: not scored, not verified, not a whole career",
    withProfile.scored === false && withProfile.verified === false && withProfile.coversWholeCareer === false);

  // ── 11. The export ─────────────────────────────────────────────────────────
  const exported = await exportPortfolio(admin, a.ctx, { correlationId: "harness-pf" });
  ok("the portfolio exports", exported.ok, exported.ok ? "" : exported.message);
  if (exported.ok) {
    const doc = exported.data as any;
    const keys = Object.keys(doc);
    ok("11b. THE COVERAGE STATEMENT IS THE FIRST FIELD, not a footer that gets cropped",
      keys[0] === "coverage" && String(doc.coverage).includes(withProfile.coverage.from!),
      keys.slice(0, 3).join(","));
    ok("11c. and the export states it is not verified, and was not sent anywhere",
      /has been verified by this product/i.test(String(doc.notVerified)) && doc.sentByThisProduct === false &&
      doc.scored === false && doc.isClinicalDocument === false,
      JSON.stringify({ s: doc.sentByThisProduct, sc: doc.scored }));
    ok("11d. THE REFLECTION TEXT IS NOT IN THE EXPORT EITHER",
      !JSON.stringify(doc).includes("SUPERSECRETREFLECTIONTEXT"),
      "the reflection text leaked into the export");
    const exportScore = /"(score|rating|strength)"\s*:/i.exec(JSON.stringify(doc));
    ok("11e. and the export carries no score", exportScore === null, exportScore?.[0] ?? "");
    const { data: trail } = await admin.from("practice_audit_event")
      .select("event_type").eq("workspace_id", wsA).eq("event_type", "practice.portfolio_exported");
    ok("11f. exporting is recorded in the audit trail", ((trail ?? []) as any[]).length === 1);
  }

  // ── 10. Declared entries belong to their author ────────────────────────────
  const theirRemoval = await removeEntry(admin, colleague.ctx, {
    id: (paper as any).data.id, correlationId: "harness-pf",
  });
  ok("10. A COLLEAGUE CANNOT REMOVE SOMEBODY ELSE'S DECLARED ENTRY",
    !theirRemoval.ok && theirRemoval.code === "NOT_YOURS");
  const ownRemoval = await removeEntry(admin, a.ctx, {
    id: (paper as any).data.id, correlationId: "harness-pf",
  });
  ok("10b. CONTROL: its author can", ownRemoval.ok, ownRemoval.ok ? "" : ownRemoval.message);
  const colleaguePortfolio = await buildPortfolio(admin, colleague.ctx);
  ok("10c. and a colleague's portfolio holds none of the owner's declared entries",
    colleaguePortfolio.declared.total === 0, String(colleaguePortfolio.declared.total));

  // ── 12. Cross-PERSON isolation ─────────────────────────────────────────────
  //
  // ⚠ THIS USED TO BE CROSS-WORKSPACE, AND SINCE MIGRATION 270 THAT IS THE WRONG QUESTION for the
  // declared half. A portfolio is one person's wherever they typed it, so what must hold is that ANOTHER
  // PERSON sees none of it -- and the recorded half stays workspace-scoped, so that half is still tested
  // across practices.
  const crossPortfolio = await buildPortfolio(admin, b.ctx);
  ok("12. ANOTHER PERSON'S PORTFOLIO HOLDS NONE OF THIS ONE'S WORK OR DECLARATIONS",
    crossPortfolio.recorded.consultations === 0 && crossPortfolio.recorded.procedures === 0 &&
    crossPortfolio.declared.total === 0,
    JSON.stringify(crossPortfolio.recorded));
  ok("12a. and the profile it shows is THEIR identity, never the other practitioner's",
    crossPortfolio.profile !== null &&
    crossPortfolio.profile?.user_id === OTHER &&
    crossPortfolio.profile?.self_declared_registration_number === null,
    JSON.stringify({ u: crossPortfolio.profile?.user_id, r: crossPortfolio.profile?.self_declared_registration_number }));
  const crossRemoval = await removeEntry(admin, b.ctx, {
    id: (lapsed as any).data.id, correlationId: "harness-pf",
  });
  // ⚠ NOT_YOURS, NOT NOT_FOUND, AND THE CHANGE IS DELIBERATE. There is one scope on this table now and
  // it is the person, so "in another workspace" is no longer a reason to refuse -- being somebody else's
  // is. The refusal is unchanged in effect and honest about its reason.
  ok("12b. nor can they remove one of them", !crossRemoval.ok && crossRemoval.code === "NOT_YOURS",
    crossRemoval.ok ? "it was removed" : crossRemoval.code);
  // NON-VACUOUS: the other practitioner works on their own records.
  const bEntry = await addEntry(admin, b.ctx, {
    kind: "achievement", title: "Their own award, in their own practice", correlationId: "harness-pf",
  });
  ok("12c. CONTROL: the other practitioner can build their own portfolio perfectly well", bEntry.ok,
    bEntry.ok ? "" : bEntry.message);

  // ⚠ 12d PINS THE SILENT HALF OF THE BUG 12b EXPOSED. removeEntry kept a workspace filter from before
  // migration 270, which produced 12b's wrong refusal code -- but the worse harm had no assertion at
  // all: 270 NULLS workspace_id when a practice closes, and a null pointer matched no workspace, so an
  // entry that outlived its practice could never be removed BY ITS OWN AUTHOR. The fixture clears the
  // pointer exactly the way 270 does, then the author removes it.
  const orphanable = await addEntry(admin, a.ctx, {
    kind: "certification", title: "Typed in a practice that later closed", correlationId: "harness-pf",
  });
  ok("12d-fixture. the entry records", orphanable.ok, orphanable.ok ? "" : (orphanable as any).message);
  if (orphanable.ok) {
    const { error: orphanErr } = await admin.from("practice_portfolio_entry")
      .update({ workspace_id: null }).eq("id", orphanable.data.id);
    const orphanRemoval = orphanErr
      ? { ok: false as const, code: "FIXTURE_BROKEN", message: orphanErr.message }
      : await removeEntry(admin, a.ctx, { id: orphanable.data.id, correlationId: "harness-pf" });
    ok("12d. AN ENTRY THAT OUTLIVED ITS PRACTICE IS STILL ITS AUTHOR'S TO REMOVE -- the person is the scope",
      orphanRemoval.ok === true, orphanRemoval.ok ? "" : `${(orphanRemoval as any).code}: ${(orphanRemoval as any).message}`);
  }

  // ══ 13. THE ENTRY OUTLIVES THE PRACTICE ═══════════════════════════════════
  //
  // The reachable failure the survey found, reproduced and then shown not to happen. Nothing is deleted
  // anywhere in this block: the practice is merely ARCHIVED, which is the state access.ts refuses.
  const entryIds = ((await admin.from("practice_portfolio_entry").select("id, workspace_id")
    .eq("user_id", OWNER)).data ?? []) as any[];
  ok("13. fixture: the owner's declared entries were typed in practice A",
    entryIds.length >= 3 && entryIds.every(e => e.workspace_id === wsA),
    JSON.stringify({ n: entryIds.length }));

  const { error: archiveError } = await admin.from("practice_workspace")
    .update({ status: "ARCHIVED" }).eq("id", wsA);
  ok("13a. fixture: practice A is archived", !archiveError, archiveError?.message ?? "");

  // ⚠ THE CONTROL, AND IT COMES FIRST because everything after it is meaningless without it. If the
  // archive did not actually shut the door, "still readable" would prove nothing at all.
  const shut = await resolveWorkspaceContext(admin, OWNER, wsA);
  ok("13b. CONTROL: the practice really is shut -- its own owner cannot obtain a context for it",
    !shut.ok && (shut as any).reason === "WORKSPACE_INACTIVE",
    shut.ok ? "the archived workspace still resolves" : (shut as any).reason);

  const afterArchive = await buildProfessionalRecord(admin, OWNER);
  // ⚠ SPLIT IN TWO ON PURPOSE. The entries are person-scoped in the engine already, so that half is
  // provable before migration 270 lands. The declared professional facts move onto the identity IN 270,
  // so that half cannot be green until it is applied -- and folding both into one assertion would have
  // hidden which of them was actually true.
  ok("13c. AND THE DECLARED ENTRIES ARE STILL READABLE BY THEIR AUTHOR -- no workspace, no context, no loss",
    afterArchive.declared.total === entryIds.length,
    JSON.stringify({ total: afterArchive.declared.total, expected: entryIds.length }));
  ok("13c2. and so are the professional facts that describe them",
    afterArchive.profile?.self_declared_registration_number === "MED/2016/UG/12345",
    JSON.stringify({ got: afterArchive.profile?.self_declared_registration_number ?? null }));
  // ⚠ THE LENGTH TEST IS NOT DECORATION. `every` over an empty array is true, so without it this
  // assertion passes brightly on a portfolio that has lost every entry -- which is the exact defect the
  // assertion above it exists to catch. Found by breaking 13c and watching this one stay green.
  ok("13d. and each entry still says WHERE it was typed -- provenance survives the archive",
    afterArchive.declared.byKind.flatMap((g: any) => g.items).length === entryIds.length &&
    afterArchive.declared.byKind.flatMap((g: any) => g.items)
      .every((i: any) => i.workspace_id === wsA && typeof i.recordedAtPractice === "string"),
    JSON.stringify(afterArchive.declared.byKind.flatMap((g: any) => g.items).map((i: any) => i.recordedAtPractice)));
  ok("13e. THE EXPORT WORKS FROM BEHIND THE CLOSED DOOR TOO -- the escape hatch no longer needs the room",
    (await exportProfessionalRecord(admin, OWNER, { correlationId: "harness-pf" })).ok);
  ok("13f. and the person-scoped export path is the one the locked-out screen links to",
    PERSON_SCOPED_EXPORT_PATH === "/api/v1/practice/portfolio/record?view=export",
    PERSON_SCOPED_EXPORT_PATH);

  const { error: restoreError } = await admin.from("practice_workspace")
    .update({ status: "ACTIVE" }).eq("id", wsA);
  ok("13g. fixture: practice A is reopened for the rest of the run", !restoreError, restoreError?.message ?? "");

  // ══ 14. SELF-DECLARED vs VERIFIED, AT THE DATABASE ════════════════════════
  const declaredColumn = await admin.from("practice_practitioner_identity")
    .select("self_declared_registration_number").limit(1);
  const bareColumn = await admin.from("practice_practitioner_identity")
    .select("registration_number").limit(1);
  ok("14. THE PROVENANCE IS IN THE COLUMN NAME: self_declared_registration_number exists at the database",
    !declaredColumn.error, declaredColumn.error?.message ?? "");
  ok("14a. and a bare `registration_number` DOES NOT -- there is no name that reads as verified",
    !!bareColumn.error, bareColumn.error ? "" : "a bare registration_number column exists");

  // ⚠ THE OTHER HALF, ENFORCED BY POSTGRES RATHER THAN NAMED. A licence check with nobody behind it is
  // the tick both migration 217 and migration 218 refuse.
  const nobodyChecked = await admin.from("practice_practitioner_identity")
    .update({ licence_verified_at: new Date().toISOString(), licence_verified_by: null })
    .eq("user_id", OWNER).select("user_id");
  ok("14b. A LICENCE CANNOT HAVE BEEN CHECKED BY NOBODY -- the database refuses a verifier-less check",
    !!nobodyChecked.error, nobodyChecked.error ? "" : "a licence check with no verifier was accepted");
  const somebodyChecked = await admin.from("practice_practitioner_identity")
    .update({ licence_verified_at: new Date().toISOString(), licence_verified_by: OTHER, licence_reference: "UMDC ledger p.14" })
    .eq("user_id", OWNER).select("user_id");
  ok("14c. CONTROL: with the id of the person who looked, the SAME write is accepted",
    !somebodyChecked.error && (somebodyChecked.data ?? []).length === 1,
    somebodyChecked.error?.message ?? "");

  const bothHalves = await getProfile(admin, OWNER);
  ok("14d. and the two halves stay apart in the payload -- a declared number beside a checked licence, each named",
    bothHalves?.self_declared_registration_number === "MED/2016/UG/12345" &&
    bothHalves?.provenance === "self_declared" &&
    bothHalves?.licence.checked === true &&
    bothHalves?.licence.provenance === "operator_checked" &&
    bothHalves?.licence.verifiedByThisProduct === false,
    JSON.stringify(bothHalves?.licence));
  ok("14e. and the id of whoever checked is NOT in the document the practitioner sends out",
    !JSON.stringify(bothHalves).includes(OTHER), "the verifier's id leaked into the record");

  // ══ 15. THE EXPORTS CARRY THE PROFESSIONAL RECORD ═════════════════════════
  ok("15. THE WHOLE-PRACTICE EXPORT NOW LISTS THE PORTFOLIO ENTRIES -- it used to omit them entirely",
    EXPORT_SECTIONS.some(s => s.table === "practice_portfolio_entry"),
    EXPORT_SECTIONS.map(s => s.table).join(","));
  const a2 = await resolveWorkspaceContext(admin, OWNER, wsA);
  ok("15a. fixture: the owner holds data.export, so the refusal below could only be about content",
    a2.ok && a2.ctx.capabilities.includes("data.export"),
    a2.ok ? a2.ctx.capabilities.join(",") : "no context");
  const practiceExport = a2.ok ? await exportPractice(admin, a2.ctx, { correlationId: "harness-pf" }) : null;
  const exportedEntries = practiceExport?.ok ? (practiceExport.data as any).portfolioEntries : null;
  ok("15b. and the export actually carries the entries typed in that practice",
    Array.isArray(exportedEntries) && (exportedEntries as any[]).length === entryIds.length,
    practiceExport && !practiceExport.ok ? practiceExport.message : JSON.stringify({ got: Array.isArray(exportedEntries) ? exportedEntries.length : exportedEntries, expected: entryIds.length }));
  ok("15c. and names it in its own manifest, so a reader can see the section exists rather than infer it",
    !!practiceExport?.ok &&
    ((practiceExport.data as any).export?.sections as any[] ?? []).some(s => s.key === "portfolioEntries" && s.error === null),
    "");

  const personalExport = await exportProfessionalRecord(admin, OWNER, { correlationId: "harness-pf" });
  ok("15d. THE PERSON-SCOPED EXPORT NEEDS NO WORKSPACE AND CARRIES THE DECLARED ENTRIES",
    personalExport.ok &&
    ((personalExport.data as any).declared as any).total === entryIds.length,
    personalExport.ok ? JSON.stringify({ total: (personalExport.data as any).declared?.total, expected: entryIds.length }) : personalExport.message);
  ok("15d2. and the professional facts, under the practitioner's own name",
    personalExport.ok &&
    (personalExport.data as any).generatedFor === "Dr Aisha Nakimuli" &&
    ((personalExport.data as any).profile as any)?.self_declared_registration_number === "MED/2016/UG/12345",
    personalExport.ok ? JSON.stringify({ for: (personalExport.data as any).generatedFor }) : personalExport.message);
  ok("15e. D4: it does NOT carry the recorded half, and SAYS SO rather than printing zeroes",
    personalExport.ok &&
    !("recorded" in (personalExport.data as any)) &&
    /not in this document/i.test(String((personalExport.data as any).recordedNotIncluded)),
    personalExport.ok ? Object.keys(personalExport.data).join(",") : "");
  const theirRecord = await buildProfessionalRecord(admin, OTHER);
  ok("15f. CONTROL: another practitioner's record carries none of it, and does carry their own",
    theirRecord.declared.total === 1 &&
    !JSON.stringify(theirRecord).includes("MED/2016/UG/12345"),
    JSON.stringify({ total: theirRecord.declared.total }));

  // ══ 16. THE WRITE-TIME WARNING, ON ALL THREE FREE-TEXT FIELDS ═════════════
  ok("16. THE ENGINE CARRIES A SENTENCE FOR EACH OF THE THREE FREE-TEXT FIELDS",
    ["title", "organisation", "detail"].every(f => {
      const entry = PORTABLE_FIELDS.find(x => x.field === f);
      return !!entry && entry.notice.length > 80 && /travels? with you|travels/i.test(entry.notice);
    }) && PORTABLE_FIELDS.length === 3,
    PORTABLE_FIELDS.map(f => f.field).join(","));
  ok("16a. each sentence is its own, not one string repeated three times",
    new Set(PORTABLE_FIELDS.map(f => f.notice)).size === 3);
  ok("16b. and each names the consequence -- that it leaves this practice's control -- and says not to identify a patient",
    PORTABLE_FIELDS.every(f => /leaves this practice's control/i.test(f.notice)) &&
    PORTABLE_FIELDS.every(f => /patient|identif/i.test(f.notice)));
  ok("16c. the notice before the form says the entry outlives the practice and that nothing scans it",
    /outlives this practice/i.test(PORTABLE_ENTRY_NOTICE) &&
    /archived, suspended or closed/i.test(PORTABLE_ENTRY_NOTICE) &&
    /nothing here reads it/i.test(PORTABLE_ENTRY_NOTICE));

  // ⚠ THE SOURCE SCAN, WITH ITS COMMENTS STRIPPED FIRST. A negative or positive scan over raw source is
  // the commonest way an assertion becomes vacuous here: the phrase being looked for also appears in the
  // explaining comment three lines above it, and the assertion passes on the comment.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const consoleSrc = stripComments(readFileSync("src/app/practice/(shell)/portfolio/PortfolioConsole.tsx", "utf8"));
  const pageSrc = stripComments(readFileSync("src/app/practice/(shell)/portfolio/page.tsx", "utf8"));
  ok("16d. CONTROL: the stripper actually strips -- a phrase that exists ONLY in a comment is gone",
    !consoleSrc.includes("a warning that lives only in JSX"),
    "the comment survived stripping, so every scan below is over comments too");
  ok("16e. THE FORM RENDERS THE SENTENCE AT EACH OF THE THREE FIELDS",
    ["title", "organisation", "detail"].every(f => consoleSrc.includes(`fieldNotice("${f}")`)),
    consoleSrc.match(/fieldNotice\("[a-z]+"\)/g)?.join(",") ?? "none");
  ok("16f. and `detail` is actually on the form, so the field the survey named sharpest is warnable at all",
    /setDetail/.test(consoleSrc) && /<textarea/.test(consoleSrc));
  ok("16g. and the page hands the engine's own strings to it rather than the form inventing its own",
    /portableNotice=\{PORTABLE_ENTRY_NOTICE\}/.test(pageSrc) && /portableFields=\{PORTABLE_FIELDS/.test(pageSrc));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
