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
 *  12. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-portfolio-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { recordProcedure } from "../src/lib/practice/procedures";
import { recordActivity, setPortfolio } from "../src/lib/practice/clinical-activity";
import { writeReflection } from "../src/lib/practice/reflection";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  buildPortfolio, exportPortfolio, saveProfile, getProfile, addEntry, removeEntry,
  PORTFOLIO_LIMITS, PROVENANCE,
} from "../src/lib/practice/portfolio";

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
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-pf" };
const day = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10);
};

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nProfessional Portfolio harness (CPR-240, migration 217)\n");
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

  // ── The profile ────────────────────────────────────────────────────────────
  const savedProfile = await saveProfile(admin, a.ctx, {
    fullName: "Dr Aisha Nakimuli", profession: "Medical doctor", specialty: "General practice",
    registrationNumber: "MED/2016/UG/12345", registrationBody: "Uganda Medical and Dental Council",
    practisingSince: "2016-03-01", correlationId: "harness-pf",
  });
  ok("the practitioner profile saves", savedProfile.ok, savedProfile.ok ? "" : savedProfile.message);
  const again = await saveProfile(admin, a.ctx, { specialty: "Family medicine", correlationId: "harness-pf" });
  ok("and saving again UPDATES rather than creating a second", again.ok);
  const { count: profileRows } = await admin.from("practice_practitioner_profile")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("user_id", OWNER);
  ok("so there is exactly one profile row", profileRows === 1, String(profileRows));
  const profile = await getProfile(admin, a.ctx);
  ok("and the update landed while the untouched fields survived",
    profile?.specialty === "Family medicine" && profile?.full_name === "Dr Aisha Nakimuli",
    JSON.stringify({ s: profile?.specialty, n: profile?.full_name }));
  const badDate = await saveProfile(admin, a.ctx, { practisingSince: "March 2016", correlationId: "harness-pf" });
  ok("a date that is not a date is refused", !badDate.ok && badDate.code === "VALIDATION_ERROR");

  const withProfile = await buildPortfolio(admin, a.ctx);
  ok("THE PRACTISING-SINCE DATE AND THE COVERAGE WINDOW ARE KEPT APART",
    withProfile.profile.practising_since === "2016-03-01" &&
    withProfile.coverage.from !== "2016-03-01",
    JSON.stringify({ since: withProfile.profile.practising_since, from: withProfile.coverage.from }));
  ok("and the profile is labelled declared, not verified",
    withProfile.profile.provenance === "self_declared");

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

  // ── 12. Cross-workspace isolation ──────────────────────────────────────────
  const crossPortfolio = await buildPortfolio(admin, b.ctx);
  ok("12. ANOTHER PRACTICE'S PORTFOLIO HOLDS NONE OF THIS ONE'S WORK",
    crossPortfolio.recorded.consultations === 0 && crossPortfolio.recorded.procedures === 0 &&
    crossPortfolio.declared.total === 0 && crossPortfolio.profile === null,
    JSON.stringify(crossPortfolio.recorded));
  const crossRemoval = await removeEntry(admin, b.ctx, {
    id: (lapsed as any).data.id, correlationId: "harness-pf",
  });
  ok("12b. nor can it remove one of them", !crossRemoval.ok && crossRemoval.code === "NOT_FOUND");
  // NON-VACUOUS: workspace B works on its own records.
  const bEntry = await addEntry(admin, b.ctx, {
    kind: "achievement", title: "Their own award, in their own practice", correlationId: "harness-pf",
  });
  ok("12c. CONTROL: workspace B can build its own portfolio perfectly well", bEntry.ok,
    bEntry.ok ? "" : bEntry.message);

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
