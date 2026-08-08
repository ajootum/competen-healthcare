/**
 * Practice search harness -- CPR-350, exercised against the live database through the same engine the
 * API uses.
 *
 * THE SECURITY PROPERTY IS THE POINT OF THIS FILE. Search is the easiest place in a product to
 * accidentally grant access: a text index over clinical notes, one missing capability check, and a role
 * that could open one record it was pointed at can now go fishing across every consultation in a
 * practice. So the capability assertions are NON-VACUOUS BY CONSTRUCTION -- every "you cannot find it"
 * is paired with the SAME query, for the SAME record, by somebody who can.
 *
 * WHAT IT PROVES:
 *   1. Free text in a SOAP segment is findable. This is the thing that did not exist before: the
 *      "patient with the mango allergy" was unfindable in the record that named her.
 *   2. WITHDRAWING A CAPABILITY MAKES ITS DOMAIN VANISH -- not shrink, not appear with a hidden count.
 *      Documents, follow-ups, tasks and the entire clinical group tested one at a time, each against a
 *      record proven findable a moment earlier.
 *   3. THE COUNT LEAKS NOTHING. `total` is what was returned, and nothing reports how much was withheld:
 *      "2 results hidden" for a name is a disclosure on its own.
 *   4. Workspace isolation on every domain, non-vacuously: B searches the same terms and finds none of
 *      A's records while A finds all of them.
 *   5. Prefix matching, stemming, multi-term AND semantics, and a query of pure punctuation refusing to
 *      run rather than matching everything.
 *   6. Signed and locked records stay findable -- reading is not editing.
 *   7. Patients come from the identity engine, not a second fuzzy search: `matchedBy` survives.
 *
 *   npx --yes tsx scripts/practice-search-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment } from "../src/lib/practice/encounters";
import { saveNoteSegment, createDocument } from "../src/lib/practice/documentation";
import { recordProcedure } from "../src/lib/practice/procedures";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { createTask } from "../src/lib/practice/tasks";
import { searchPractice, toTsQuery, recentlyTouched } from "../src/lib/practice/search";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e1391";
const USER_B = "00000000-0000-4000-8000-0000000e1392";

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
    idempotency_key: `harness-search-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-search",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-search", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-search" };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Withdraw a capability from every membership this user holds, and hand back the fresh context. */
async function withoutCapability(workspaceId: string, userId: string, capability: string): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  const ids = ((mine ?? []) as any[]).map(m => m.id);
  await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
    .in("membership_id", ids).eq("capability_code", capability).is("effective_to", null);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed after withdrawing a capability");
  return res.ctx;
}

async function restoreCapability(workspaceId: string, userId: string, capability: string) {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  const ids = ((mine ?? []) as any[]).map(m => m.id);
  await admin.from("practice_role_assignment").update({ effective_to: null })
    .in("membership_id", ids).eq("capability_code", capability);
}

const domainsIn = (r: any) => r.groups.map((g: any) => g.domain);
const hitsIn = (r: any, domain: string) => (r.groups.find((g: any) => g.domain === domain)?.hits ?? []) as any[];

async function main() {
  console.log("\nPractice search harness (CPR-350, migration 199)\n");
  await cleanup();

  // ── 0. The query sanitiser, before anything touches the database ─────────
  ok("terms are prefix-matched so a partial word finds the whole one", toTsQuery("diab") === "diab:*", String(toTsQuery("diab")));
  ok("multiple terms are ANDed", toTsQuery("mango allergy") === "mango:* & allergy:*", String(toTsQuery("mango allergy")));
  ok("tsquery OPERATORS IN USER INPUT ARE DISCARDED, not passed through",
    toTsQuery("mango & !allergy | x:*") === "mango:* & allergy:* & x:*", String(toTsQuery("mango & !allergy | x:*")));
  ok("a query of pure punctuation refuses to run rather than matching everything",
    toTsQuery("   *&|!  ") === null, String(toTsQuery("   *&|!  ")));
  ok("a paste accident is capped rather than sent",
    (toTsQuery(Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")) ?? "").split("&").length === 8,
    String((toTsQuery(Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")) ?? "").split("&").length));

  const wsA = await provision(USER_A, "HARNESS Search A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Search B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, USER_A, wsA);
  const b = await resolveWorkspaceContext(admin, USER_B, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── Build one patient with something findable in every domain ────────────
  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nabbosa Miriam", birthDate: "1991-02-17", sex: "female",
    phone: "0772 555 770", ...base,
  });
  if (!pa.ok) { ok("patient registration succeeded", false, pa.message); return report(); }
  const patientA = pa.data.id;

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "new_walk_in",
    reasonForVisit: "itchy rash after eating mango", ...base,
  });
  if (!enc.ok) { ok("encounter launch succeeded", false, enc.message); return report(); }
  const encId = enc.data.id;
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "ACTIVE", ...base });

  // THE SENTINEL. A distinctive phrase in a SOAP segment, which nothing in this product could find
  // before CPR-350.
  await saveNoteSegment(admin, {
    workspaceId: wsA, encounterId: encId, noteType: "subjective",
    body: "Widespread urticaria within an hour of eating mango. No airway involvement.", ...base,
  });
  await recordDiagnosis(admin, {
    workspaceId: wsA, encounterId: encId, label: "Mango-induced acute urticaria",
    problemLabel: "Mango allergy", certainty: "confirmed", isPrimary: true, ...base,
  });
  await recordTreatment(admin, {
    workspaceId: wsA, encounterId: encId, treatmentType: "medication",
    label: "Cetirizine", dose: "10 mg", notes: "avoid mango", ...base,
  });
  await recordProcedure(admin, {
    workspaceId: wsA, encounterId: encId, label: "Skin prick testing",
    indication: "suspected mango allergy", ...base,
  });
  const doc = await createDocument(admin, {
    workspaceId: wsA, patientId: patientA, encounterId: encId, docType: "referral_letter",
    title: "Referral: mango allergy", body: "Please assess for mango allergy.", ...base,
  });
  const fu = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, originEncounterId: encId,
    reason: "review the mango allergy after testing", intervalCode: "1m", ...base,
  });
  const task = await createTask(admin, {
    workspaceId: wsA, title: "Chase the mango allergy panel", assignedTo: USER_A,
    patientId: patientA, category: "clinical_admin", ...base,
  });
  ok("a record exists in every searchable domain",
    doc.ok && fu.ok && task.ok, [doc, fu, task].map(r => r.ok ? "ok" : r.message).join("; "));

  // ── 1. Free text in a clinical note is findable ──────────────────────────
  const full = await searchPractice(admin, a.ctx, "mango");
  ok("A SOAP SEGMENT IS FINDABLE BY ITS FREE TEXT (this did not exist before CPR-350)",
    hitsIn(full, "notes").length === 1, `${hitsIn(full, "notes").length} note hits`);
  ok("the note hit carries the patient's name, not just an id",
    hitsIn(full, "notes")[0]?.label === "Nabbosa Miriam", String(hitsIn(full, "notes")[0]?.label));
  ok("...and a link to the consultation it is in",
    hitsIn(full, "notes")[0]?.href === `/practice/encounters/${encId}`, String(hitsIn(full, "notes")[0]?.href));

  ok("every other domain matched the same term",
    ["problems", "treatments", "procedures", "documents", "followUps", "tasks"]
      .every(d => hitsIn(full, d).length >= 1),
    JSON.stringify(domainsIn(full)));
  ok("results are GROUPED BY WHAT THEY ARE, not blended into one ranked list",
    full.groups.length >= 6 && full.groups.every((g: any) => !!g.title && !!g.note),
    `${full.groups.length} groups`);
  ok("every hit has somewhere to go", full.groups.every((g: any) => g.hits.every((h: any) => h.href.startsWith("/practice/"))));

  // Stemming and prefix, over real rows.
  const stem = await searchPractice(admin, a.ctx, "eat");
  ok("stemming works: 'eat' finds 'eating' in the note", hitsIn(stem, "notes").length === 1, `${hitsIn(stem, "notes").length}`);
  const twoTerms = await searchPractice(admin, a.ctx, "mango urticaria");
  ok("two terms are ANDed, not ORed (the note has both; the task has only one)",
    hitsIn(twoTerms, "notes").length === 1 && hitsIn(twoTerms, "tasks").length === 0,
    `notes=${hitsIn(twoTerms, "notes").length} tasks=${hitsIn(twoTerms, "tasks").length}`);
  const nonsense = await searchPractice(admin, a.ctx, "zzzznotathing");
  ok("a term that matches nothing returns nothing, and says it ran",
    nonsense.ran === true && nonsense.total === 0, JSON.stringify({ ran: nonsense.ran, total: nonsense.total }));
  const empty = await searchPractice(admin, a.ctx, "   ");
  ok("an empty query does not run at all (rather than matching everything)",
    empty.ran === false && empty.groups.length === 0, JSON.stringify({ ran: empty.ran, groups: empty.groups.length }));

  // ── 7. Patients come from the identity engine ────────────────────────────
  const byName = await searchPractice(admin, a.ctx, "Nabbosa");
  ok("a patient is found by name", hitsIn(byName, "patients").length === 1, `${hitsIn(byName, "patients").length}`);
  ok("THE IDENTITY RANKING SURVIVES: the hit says how it matched",
    /name|identifier|phone/i.test(hitsIn(byName, "patients")[0]?.detail ?? ""),
    String(hitsIn(byName, "patients")[0]?.detail));

  // ── 6. Signed records stay findable ──────────────────────────────────────
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "COMPLETED", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: encId, to: "SIGNED", ...base });
  const afterSigning = await searchPractice(admin, a.ctx, "mango");
  ok("A SIGNED, LOCKED ENCOUNTER IS STILL FINDABLE (reading is not editing)",
    hitsIn(afterSigning, "notes").length === 1, `${hitsIn(afterSigning, "notes").length}`);

  // ── 2. THE SECURITY PROPERTY. Each withdrawal paired with the finding above. ──
  // Each gate carries its OWN probe term, because "mango" does not name a patient and "Nabbosa" does not
  // appear in a task. A control that quietly excused itself for one capability -- as an earlier version
  // of this loop did -- is a control that proves nothing for that capability.
  const gates: [string, string[], string, string][] = [
    ["document.view", ["documents"], "documents", "mango"],
    ["followup.view", ["followUps"], "follow-ups", "mango"],
    ["task.view", ["tasks"], "tasks", "mango"],
    ["encounter.list", ["notes", "encounters", "diagnoses", "problems", "treatments", "procedures"], "consultations and everything in them", "mango"],
    ["patient.list", ["patients"], "patients", "Nabbosa"],
  ];
  for (const [capability, domains, label, term] of gates) {
    const before = await searchPractice(admin, a.ctx, term);
    const foundBefore = domains.filter(d => hitsIn(before, d).length > 0);
    ok(`${capability}: EVERY one of its domains is findable while the capability is held (control)`,
      foundBefore.length === domains.length,
      `found ${foundBefore.join(",")} of ${domains.join(",")}`);

    const blinded = await withoutCapability(wsA, USER_A, capability);
    const after = await searchPractice(admin, blinded, term);
    const stillThere = domains.filter(d => hitsIn(after, d).length > 0);
    ok(`WITHDRAWING ${capability} MAKES ITS DOMAINS VANISH FROM SEARCH`,
      stillThere.length === 0, `still returned: ${stillThere.join(", ")}`);
    ok(`...and the skipped domain is NAMED rather than silently missing (${capability})`,
      after.notSearched.includes(label), after.notSearched.join(" | "));

    await restoreCapability(wsA, USER_A, capability);
  }

  const restored = await resolveWorkspaceContext(admin, USER_A, wsA);
  if (!restored.ok) { ok("context resolves after restoring capabilities", false); return report(); }
  const back = await searchPractice(admin, restored.ctx, "mango");
  ok("everything is findable again once the capabilities are restored (the withdrawals were surgical)",
    hitsIn(back, "notes").length === 1 && hitsIn(back, "documents").length === 1,
    JSON.stringify(domainsIn(back)));

  // ── 3. The count leaks nothing ───────────────────────────────────────────
  const noDocs = await searchPractice(admin, await withoutCapability(wsA, USER_A, "document.view"), "mango");
  ok("TOTAL COUNTS ONLY WHAT WAS RETURNED -- there is no withheld count anywhere in the result",
    noDocs.total === noDocs.groups.reduce((n: number, g: any) => n + g.hits.length, 0) &&
    !JSON.stringify(noDocs).includes("hidden") && !("withheld" in noDocs) && !("totalBeforeFilter" in noDocs),
    JSON.stringify({ total: noDocs.total, keys: Object.keys(noDocs) }));
  await restoreCapability(wsA, USER_A, "document.view");
  const ctxA = (await resolveWorkspaceContext(admin, USER_A, wsA) as any).ctx;

  // ── 4. Isolation, non-vacuously ──────────────────────────────────────────
  const bSearch = await searchPractice(admin, b.ctx, "mango");
  ok("B FINDS NOTHING OF A'S, searching the same term", bSearch.total === 0, `${bSearch.total} hits`);
  ok("...and B was not simply blocked -- its search ran across every domain",
    bSearch.ran === true && bSearch.notSearched.length === 0, JSON.stringify(bSearch.notSearched));
  const aSearch = await searchPractice(admin, ctxA, "mango");
  ok("...while A finds them all (the isolation test is not vacuous)", aSearch.total >= 7, `${aSearch.total} hits`);

  // ── 5. Domain filter and truncation ──────────────────────────────────────
  const onlyNotes = await searchPractice(admin, ctxA, "mango", { domains: ["notes"] });
  ok("a domain filter narrows the search to what was asked for",
    onlyNotes.groups.length === 1 && onlyNotes.groups[0].domain === "notes", JSON.stringify(domainsIn(onlyNotes)));

  for (let i = 0; i < 12; i++) {
    await createTask(admin, { workspaceId: wsA, title: `Bulk mango task ${i}`, assignedTo: USER_A, ...base });
  }
  const many = await searchPractice(admin, ctxA, "mango");
  const taskGroup = many.groups.find((g: any) => g.domain === "tasks");
  ok("a group past the limit is marked TRUNCATED rather than silently cut",
    taskGroup?.truncated === true && taskGroup?.hits.length === 10,
    JSON.stringify({ truncated: taskGroup?.truncated, hits: taskGroup?.hits.length }));

  // ── Recent, for the empty state ──────────────────────────────────────────
  const recent = await recentlyTouched(admin, ctxA);
  ok("the empty state offers what was touched recently, from real rows",
    recent.encounters.length >= 1 && recent.patients.length >= 1 && recent.encounters[0].patient_name === "Nabbosa Miriam",
    JSON.stringify({ e: recent.encounters.length, p: recent.patients.length }));
  const recentBlind = await recentlyTouched(admin, await withoutCapability(wsA, USER_A, "encounter.list"));
  ok("...and it respects capabilities too", recentBlind.encounters.length === 0, `${recentBlind.encounters.length}`);
  await restoreCapability(wsA, USER_A, "encounter.list");

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
