/**
 * Case Memory harness -- CPR-220. Migration 214.
 *
 * WHAT IT PROVES:
 *   1. NO SIMILARITY SCORE ANYWHERE. Asserted structurally over the whole serialised payload: no field
 *      named like a score, no percentage-shaped value. The comp puts "92% similar" beside each case;
 *      nothing in the payload could render it.
 *   2. MATCHING IS ON STATED FACTS AND DISCRIMINATES. A case sharing a diagnosis comes back; a case
 *      sharing nothing does not. A query returning everything, or nothing, fails here.
 *   3. EACH RESULT NAMES WHAT IT SHARES -- the field, the label and the value -- which is what replaces
 *      the percentage.
 *   4. ORDER IS BY HOW MANY FACTS MATCHED. Two shared facts rank above one.
 *   5. AGE AND SEX COUNT ONLY ALONGSIDE A CLINICAL MATCH. Another forty-year-old is a coincidence, not a
 *      similar case, and is not returned.
 *   6. A CASE IS NEVER ITS OWN MATCH.
 *   7. A CASE WITH NOTHING RECORDED SAYS SO, with a reason, rather than returning recent consultations
 *      dressed up as similar.
 *   8. DE-IDENTIFICATION: encounter.list without patient.view gets the clinical content and no names,
 *      and the outcome detail -- which is free text and can name anybody -- goes with the names.
 *   9. A LEARNING POINT BELONGS TO ITS AUTHOR. Two clinicians write about one case and both survive;
 *      deleting somebody else's is refused.
 *  10. A LEARNING POINT MUST BE SUBSTANTIVE, in the engine AND in the database, so the rule holds for a
 *      writer that bypasses the engine.
 *  11. FILING A CASE TWICE IS NOT AN ERROR, and does not create a second row.
 *  12. A PERSONAL COLLECTION IS ONE PERSON'S; a shared one is the practice's.
 *  13. Reading similar cases is logged, because it is a read across the whole clinical history.
 *  14. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-case-memory-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter, recordDiagnosis } from "../src/lib/practice/encounters";
import { recordProcedure, recordProcedureOutcome } from "../src/lib/practice/procedures";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  findSimilarCases, captureLearning, listLearning, deleteLearning,
  listCollections, createCollection, addToCollection, collectionCases, caseMemoryDashboard,
} from "../src/lib/practice/case-memory";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000c220a";
const OTHER = "00000000-0000-4000-8000-0000000c220b";

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
    idempotency_key: `harness-cm-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-cm",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-cm", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-cm" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function withoutCapability(workspaceId: string, userId: string, capability: string): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .eq("capability_code", capability).is("effective_to", null);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

/** One consultation, closed out, with the diagnoses and procedures it carried. */
async function caseFor(workspaceId: string, patientId: string, args: {
  reason: string; diagnoses?: string[]; procedures?: string[]; sign?: boolean;
}): Promise<string> {
  const e = await launchEncounter(admin, {
    workspaceId, patientId, pathway: "new_walk_in", reasonForVisit: args.reason, ...base,
  });
  if (!e.ok) throw new Error(`launch failed: ${e.message}`);

  // BEFORE SIGNING, ALWAYS. Migration 194's trigger makes a signed encounter immutable, and a fixture
  // that writes afterwards gets a silent refusal that reads later as a bug in the engine.
  for (const label of args.diagnoses ?? []) {
    const dx = await recordDiagnosis(admin, { workspaceId, encounterId: e.data.id, label, certainty: "confirmed", ...base });
    if (!dx.ok) throw new Error(`diagnosis "${label}" refused: ${dx.message}`);
  }
  for (const label of args.procedures ?? []) {
    const p = await recordProcedure(admin, {
      workspaceId, encounterId: e.data.id, label, consentStatus: "obtained", status: "PERFORMED", ...base,
    });
    if (!p.ok) throw new Error(`procedure "${label}" refused: ${p.message}`);
    const o = await recordProcedureOutcome(admin, {
      workspaceId, procedureId: p.data.id, outcomeType: "complication", severity: "mild",
      detail: `Seen again by Dr Okello on the ward`, ...base,
    });
    if (!o.ok) throw new Error(`outcome refused: ${o.message}`);
  }

  await transitionEncounter(admin, { workspaceId, encounterId: e.data.id, to: "ACTIVE", ...base });
  await transitionEncounter(admin, { workspaceId, encounterId: e.data.id, to: "COMPLETED", ...base });
  if (args.sign !== false)
    await transitionEncounter(admin, { workspaceId, encounterId: e.data.id, to: "SIGNED", ...base });
  return e.data.id;
}

async function main() {
  console.log("\nCase Memory harness (CPR-220, migration 214)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Case Memory A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Case Memory B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── The fixture ────────────────────────────────────────────────────────────
  // Four patients, chosen so every discrimination below has something to fail against.
  const born = (yearsAgo: number) => {
    const d = new Date(); d.setFullYear(d.getFullYear() - yearsAgo); return d.toISOString().slice(0, 10);
  };

  const pIndex = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Sarah", sex: "female", birthDate: born(42), phone: "0772 100 001", ...base,
  });
  const pTwin = await registerPatient(admin, {   // same condition AND procedure AND age: two facts, then more
    workspaceId: wsA, displayName: "Auma Grace", sex: "female", birthDate: born(44), phone: "0772 100 002", ...base,
  });
  const pOneFact = await registerPatient(admin, { // same condition only; far younger, male
    workspaceId: wsA, displayName: "Okot Peter", sex: "male", birthDate: born(19), phone: "0772 100 003", ...base,
  });
  const pCoincidence = await registerPatient(admin, { // SAME AGE AND SEX, nothing clinical in common
    workspaceId: wsA, displayName: "Adong Betty", sex: "female", birthDate: born(42), phone: "0772 100 004", ...base,
  });
  if (!pIndex.ok || !pTwin.ok || !pOneFact.ok || !pCoincidence.ok) {
    ok("the four fixture patients register", false,
      [pIndex, pTwin, pOneFact, pCoincidence].map(p => p.ok ? "ok" : p.message).join(" | "));
    return report();
  }
  ok("the four fixture patients register", true);

  const index = await caseFor(wsA, pIndex.data.id, {
    reason: "Back pain", diagnoses: ["Lumbar disc herniation"], procedures: ["Microdiscectomy"],
  });
  const twin = await caseFor(wsA, pTwin.data.id, {
    reason: "Back pain", diagnoses: ["Lumbar disc herniation"], procedures: ["Microdiscectomy"],
  });
  const oneFact = await caseFor(wsA, pOneFact.data.id, {
    reason: "Back pain", diagnoses: ["Lumbar disc herniation"],
  });
  const coincidence = await caseFor(wsA, pCoincidence.data.id, {
    reason: "Sore throat", diagnoses: ["Acute tonsillitis"],
  });
  const bare = await caseFor(wsA, pIndex.data.id, { reason: "Review", sign: false });
  ok("the fixture consultations exist", [index, twin, oneFact, coincidence, bare].every(Boolean));

  // ── 2, 3, 4, 5, 6. Retrieval ───────────────────────────────────────────────
  const similar = await findSimilarCases(admin, a.ctx, { encounterId: index });
  if (!similar) { ok("similar cases resolve", false); return report(); }
  const ids = similar.cases.map(c => c.encounterId);

  ok("2. A CASE SHARING A DIAGNOSIS COMES BACK", ids.includes(twin) && ids.includes(oneFact),
    JSON.stringify(ids));
  ok("2b. and a case sharing NOTHING CLINICAL does not -- the query discriminates",
    !ids.includes(coincidence), JSON.stringify(ids));
  ok("5. AGE AND SEX ALONE ARE A COINCIDENCE, NOT A SIMILAR CASE: same age, same sex, different condition, absent",
    !ids.includes(coincidence));
  ok("6. A CASE IS NEVER ITS OWN MATCH", !ids.includes(index));

  const twinRow = similar.cases.find(c => c.encounterId === twin);
  const oneRow = similar.cases.find(c => c.encounterId === oneFact);
  ok("3. EACH RESULT NAMES WHAT IT SHARES, by field and by value",
    !!twinRow &&
    twinRow.matchedOn.some(m => m.field === "diagnosis" && /Lumbar disc herniation/i.test(m.value)) &&
    twinRow.matchedOn.some(m => m.field === "procedure" && /Microdiscectomy/i.test(m.value)),
    JSON.stringify(twinRow?.matchedOn));
  ok("3b. and an age match reads as a BAND rather than a date of birth",
    !!twinRow && twinRow.matchedOn.some(m => m.field === "age" && /^\d+s$|^\d+-\d+$|under/.test(m.value)),
    JSON.stringify(twinRow?.matchedOn.filter(m => m.field === "age")));
  ok("4. ORDER IS BY HOW MANY FACTS MATCHED: four beats one",
    !!twinRow && !!oneRow && twinRow.matchCount > oneRow.matchCount && ids[0] === twin,
    JSON.stringify({ twin: twinRow?.matchCount, one: oneRow?.matchCount, first: ids[0] === twin }));
  ok("4b. and the one-fact case matched on the diagnosis alone, not on age it does not share",
    !!oneRow && oneRow.matchCount === 1 && oneRow.matchedOn[0].field === "diagnosis",
    JSON.stringify(oneRow?.matchedOn));

  // ── 1. NO SCORE ANYWHERE ───────────────────────────────────────────────────
  const serialised = JSON.stringify(similar);
  const scoreField = /"(similarity|relevance|score|confidence|match_percent|percentage|rate)"\s*:/i.exec(serialised);
  ok("1. NO SCORE FIELD ANYWHERE IN THE PAYLOAD -- the comp's 92% could not be rendered from it",
    scoreField === null, scoreField?.[0] ?? "");
  const percentShaped = /:\s*"?\d{1,3}(\.\d+)?\s*%/.exec(serialised);
  ok("1b. and no percentage-shaped value either", percentShaped === null, percentShaped?.[0] ?? "");
  ok("1c. and the payload says so as a FIELD, so a client cannot invent one",
    similar.similarityScored === false);

  // ── 7. Nothing recorded says so ────────────────────────────────────────────
  const nothing = await findSimilarCases(admin, a.ctx, { encounterId: bare });
  ok("7. A CASE WITH NOTHING RECORDED RETURNS NO LIST, and says why",
    !!nothing && nothing.matchedNothing === true && nothing.cases.length === 0 &&
    /no diagnosis or procedure/i.test(nothing.reason ?? ""),
    JSON.stringify({ n: nothing?.cases.length, r: nothing?.reason }));

  // ── 13. The read is logged ─────────────────────────────────────────────────
  //
  // EXACTLY ONE, after two retrievals. The retrieval that returned cases read across the practice's
  // whole clinical history and is logged. The one against `bare` read nothing but the consultation the
  // caller already had open, found no diagnosis to match on, and returned before touching anybody
  // else's record -- so there was no access to log. Asserting the exact count is what makes this test
  // say something: `>= 1` would pass whether or not the empty read logged a phantom entry.
  const { count: logged } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", wsA).eq("actor_id", OWNER).eq("action", "search").ilike("detail", "%Case memory%");
  ok("13. READING SIMILAR CASES IS LOGGED -- and a retrieval that read nobody's record logs nothing",
    logged === 1, String(logged));

  // ── 9, 10. Learning points ─────────────────────────────────────────────────
  const short = await captureLearning(admin, a.ctx, {
    encounterId: index, kind: "what_worked", body: "good case", correlationId: "harness-cm",
  });
  ok("10. A ONE-LINE LEARNING POINT IS REFUSED", !short.ok && short.code === "TOO_SHORT");

  // THE SAME RULE, ONE LAYER DOWN. A writer that never touches the engine must not be able to file
  // "good case" either, or the constraint is a suggestion.
  const { error: rawShort } = await admin.from("practice_case_learning").insert({
    workspace_id: wsA, encounter_id: index, author_id: OWNER, kind: "observation", body: "good case",
  });
  ok("10b. AND THE DATABASE REFUSES IT TOO, for a writer that bypasses the engine", rawShort !== null,
    rawShort?.message ?? "the insert succeeded");

  const badKind = await captureLearning(admin, a.ctx, {
    encounterId: index, kind: "brilliant", body: "This is a long enough body to pass the length check.", correlationId: "harness-cm",
  });
  ok("10c. an unknown kind is refused rather than stored as free text",
    !badKind.ok && badKind.code === "VALIDATION_ERROR");

  const mine = await captureLearning(admin, a.ctx, {
    encounterId: index, kind: "technique",
    body: "Retracting laterally before the annulotomy kept the root out of the field.",
    correlationId: "harness-cm",
  });
  ok("a learning point is captured", mine.ok, mine.ok ? "" : mine.message);

  // A COLLEAGUE'S LESSON FROM THE SAME CASE. Both are real; one must not overwrite the other.
  const { data: otherMembership, error: memberError } = await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: OTHER, role_code: "practitioner", status: "active",
  }).select("id").single();
  // CHECKED, NOT ASSUMED. A refused fixture write here would surface later as "the colleague could not
  // write a learning point", attributed to the engine rather than to this line.
  ok("a colleague joins the practice", memberError === null && !!otherMembership, memberError?.message ?? "");
  if (!otherMembership) return report();
  const { error: capError } = await admin.from("practice_role_assignment").insert(
    ["encounter.list", "encounter.edit"].map(c => ({
      membership_id: otherMembership.id, capability_code: c, source: "explicit_grant", created_by: OWNER,
    })),
  );
  ok("and holds the two capabilities Case Memory needs", capError === null, capError?.message ?? "");
  const colleagueCtx = await resolveWorkspaceContext(admin, OTHER, wsA);
  if (!colleagueCtx.ok) { ok("colleague context resolves", false); return report(); }

  const theirs = await captureLearning(admin, colleagueCtx.ctx, {
    encounterId: index, kind: "what_to_avoid",
    body: "I would not have used the lateral approach here given how narrow the canal was.",
    correlationId: "harness-cm",
  });
  ok("9. TWO CLINICIANS WRITE ABOUT ONE CASE AND BOTH SURVIVE", theirs.ok, theirs.ok ? "" : theirs.message);

  const allLearning = await listLearning(admin, a.ctx, { encounterId: index });
  ok("9b. and both are listed, each attributed", allLearning.length === 2 &&
    allLearning.some(l => l.mine === true) && allLearning.some(l => l.mine === false),
    JSON.stringify(allLearning.map(l => ({ mine: l.mine, kind: l.kind }))));
  const onlyMine = await listLearning(admin, a.ctx, { encounterId: index, mine: true });
  ok("9c. and `mine` filters to the caller's own -- non-vacuously, since two exist",
    onlyMine.length === 1 && onlyMine[0].mine === true, String(onlyMine.length));

  const stealDelete = await deleteLearning(admin, a.ctx, {
    id: (theirs as any).data.id, correlationId: "harness-cm",
  });
  ok("9d. DELETING SOMEBODY ELSE'S LEARNING POINT IS REFUSED",
    !stealDelete.ok && stealDelete.code === "NOT_YOURS");
  // THE CONTROL. A refusal assertion proves nothing unless the same operation succeeds where it should.
  const ownDelete = await deleteLearning(admin, colleagueCtx.ctx, {
    id: (theirs as any).data.id, correlationId: "harness-cm",
  });
  ok("9e. CONTROL: its author can delete it", ownDelete.ok, ownDelete.ok ? "" : ownDelete.message);

  // Re-file it, so the counts below have something to count.
  await captureLearning(admin, colleagueCtx.ctx, {
    encounterId: index, kind: "what_to_avoid",
    body: "I would not have used the lateral approach here given how narrow the canal was.",
    correlationId: "harness-cm",
  });

  // ── 8. De-identification ───────────────────────────────────────────────────
  const blind = await withoutCapability(wsA, OWNER, "patient.view");
  const blindSimilar = await findSimilarCases(admin, blind, { encounterId: index });
  ok("8. WITHOUT patient.view THERE ARE NO NAMES",
    !!blindSimilar && blindSimilar.identified === false &&
    blindSimilar.cases.every(c => c.patientName === null),
    JSON.stringify(blindSimilar?.cases.map(c => c.patientName)));
  ok("8b. but the CLINICAL CONTENT IS STILL THERE -- that is the part you learn from",
    !!blindSimilar && blindSimilar.cases.length > 0 &&
    blindSimilar.cases.every(c => c.matchedOn.length > 0) &&
    blindSimilar.cases.some(c => c.ageBand !== null),
    String(blindSimilar?.cases.length));
  const blindSerialised = JSON.stringify(blindSimilar);
  ok("8c. AND THE OUTCOME DETAIL GOES WITH THE NAMES, because free text names people too",
    !/Dr Okello/.test(blindSerialised),
    /Dr Okello/.test(blindSerialised) ? "the detail leaked" : "");
  // THE CONTROL: the identified caller does see it, so the assertion above is not passing on an empty list.
  ok("8d. CONTROL: an identified caller sees both the name and the detail",
    /Dr Okello/.test(serialised) && similar.cases.some(c => c.patientName !== null));

  // ── 11, 12. Collections ────────────────────────────────────────────────────
  const shelf = await createCollection(admin, a.ctx, {
    name: "Lumbar spine", description: "Discectomies worth re-reading", correlationId: "harness-cm",
  });
  ok("a personal collection is created", shelf.ok, shelf.ok ? "" : shelf.message);
  const dupName = await createCollection(admin, a.ctx, { name: "lumbar spine", correlationId: "harness-cm" });
  ok("12a. THE SAME NAME TWICE ON ONE SHELF IS REFUSED, case-insensitively",
    !dupName.ok && dupName.code === "NAME_IN_USE", dupName.ok ? "it was created" : "");
  // CONTROL for the NULL-owner partial index: the practice may hold the same name as a person, because
  // those are two different shelves.
  const sharedSame = await createCollection(admin, a.ctx, {
    name: "Lumbar spine", shared: true, correlationId: "harness-cm",
  });
  ok("12b. CONTROL: the PRACTICE may hold the same name as a person -- two shelves, two indexes",
    sharedSame.ok, sharedSame.ok ? "" : sharedSame.message);

  const filed = await addToCollection(admin, a.ctx, {
    collectionId: (shelf as any).data.id, encounterId: twin, note: "Textbook",
  });
  ok("a case is filed", filed.ok && (filed as any).data.added === true);
  const refiled = await addToCollection(admin, a.ctx, {
    collectionId: (shelf as any).data.id, encounterId: twin,
  });
  ok("11. FILING A CASE TWICE IS NOT AN ERROR -- and reports that nothing was added",
    refiled.ok && (refiled as any).data.added === false,
    JSON.stringify(refiled));
  const { count: memberRows } = await admin.from("practice_case_collection_member")
    .select("*", { count: "exact", head: true }).eq("collection_id", (shelf as any).data.id);
  ok("11b. and there is still ONE row, not two", memberRows === 1, String(memberRows));

  const intrude = await addToCollection(admin, colleagueCtx.ctx, {
    collectionId: (shelf as any).data.id, encounterId: oneFact,
  });
  ok("12c. A COLLEAGUE CANNOT FILE INTO SOMEBODY'S PERSONAL SHELF",
    !intrude.ok && intrude.code === "NOT_YOURS");
  const intrudeShared = await addToCollection(admin, colleagueCtx.ctx, {
    collectionId: (sharedSame as any).data.id, encounterId: oneFact,
  });
  ok("12d. CONTROL: but they can file into the PRACTICE's", intrudeShared.ok,
    intrudeShared.ok ? "" : intrudeShared.message);

  const colleagueSees = await listCollections(admin, colleagueCtx.ctx);
  ok("12e. a colleague sees the practice's shelf and NOT the owner's personal one",
    colleagueSees.some(c => c.scope === "practice") && !colleagueSees.some(c => c.scope === "personal"),
    JSON.stringify(colleagueSees.map(c => ({ n: c.name, s: c.scope }))));
  const ownerSees = await listCollections(admin, a.ctx);
  ok("12f. CONTROL: the owner sees both", ownerSees.length === 2, String(ownerSees.length));

  const shelfCases = await collectionCases(admin, a.ctx, (shelf as any).data.id);
  ok("a collection lists its cases with the note that was filed with them",
    !!shelfCases && shelfCases.cases.length === 1 && shelfCases.cases[0].note === "Textbook");
  const peek = await collectionCases(admin, colleagueCtx.ctx, (shelf as any).data.id);
  ok("12g. and a colleague cannot open somebody's personal shelf at all", peek === null);

  // ── The dashboard ──────────────────────────────────────────────────────────
  const dash = await caseMemoryDashboard(admin, a.ctx);
  ok("the summary counts what exists: five consultations, two learning points, two collections",
    dash.cases === 5 && dash.learnings === 2 && dash.collections === 2,
    JSON.stringify({ c: dash.cases, l: dash.learnings, k: dash.collections }));
  ok("and the top conditions are counted as typed, most-seen first",
    dash.topConditions[0]?.label === "Lumbar disc herniation" && dash.topConditions[0]?.total === 3 &&
    dash.distinctConditions === 2,
    JSON.stringify(dash.topConditions));
  const dashSerialised = JSON.stringify(dash);
  ok("and the summary carries no rate either",
    !/"(rate|percentage|score)"\s*:/i.test(dashSerialised) && !/:\s*"?\d{1,3}(\.\d+)?\s*%/.test(dashSerialised));

  // ── 14. Cross-workspace isolation ──────────────────────────────────────────
  const crossSimilar = await findSimilarCases(admin, b.ctx, { encounterId: index });
  ok("14. ANOTHER PRACTICE CANNOT RETRIEVE THIS ONE'S CASES", crossSimilar === null);
  const crossLearning = await listLearning(admin, b.ctx, {});
  ok("14b. nor read its learning points", crossLearning.length === 0, String(crossLearning.length));
  const crossCollections = await listCollections(admin, b.ctx);
  ok("14c. nor see its collections", crossCollections.length === 0, String(crossCollections.length));
  const crossFile = await addToCollection(admin, b.ctx, {
    collectionId: (sharedSame as any).data.id, encounterId: twin,
  });
  ok("14d. nor file into them", !crossFile.ok && crossFile.code === "NOT_FOUND");
  // NON-VACUOUS: workspace B is a real, working workspace, so the four refusals above are about
  // isolation rather than about B being broken.
  const bShelf = await createCollection(admin, b.ctx, { name: "Their own shelf", correlationId: "harness-cm" });
  ok("14e. CONTROL: workspace B works perfectly well on its own records", bShelf.ok,
    bShelf.ok ? "" : bShelf.message);

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
