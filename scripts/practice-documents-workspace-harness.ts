/**
 * CPR-DOC-002 Documents Workspace harness -- PHASE 1 (s20), exercised against the live database through
 * the same engine the pages and the API use.
 *
 * WHAT IT PROVES:
 *   1.  THE REGISTER COMPOSES THREE SOURCES and keeps each one's origin. Authored documents, arrivals and
 *       patient files in one cross-practice list, isolated per workspace with a non-vacuous control.
 *   2.  THE STATUS MODEL (s7/s18) is DERIVED, and `issued` comes from the release register rather than
 *       from a column. Two signed documents in the SAME read, one released and one not, so the right
 *       answer cannot be produced by a function that always says one thing.
 *   3.  EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. Each card's own href is parsed back into a
 *       filter and re-applied to the rows; the result must equal the card's count. Plus a control that
 *       the counts are not all the same number.
 *   4.  s17 RULE 1 -- a patient-specific document cannot exist without a patient link. Refused by the
 *       DATABASE, not by an application check, with the identical insert succeeding as the control.
 *   5.  s17 RULE 2 -- a signed document is immutable. The engine refuses; a RAW update that bypasses the
 *       engine entirely is refused by migration 195's trigger; the same raw update on a DRAFT succeeds.
 *   6.  s13 -- AN ASSISTANT CANNOT SIGN AS A PRACTITIONER. Every capability code this feature names is
 *       checked against practice_role_capabilities as it is actually seeded, and a live assistant context
 *       is resolved to show it holds inbox.record and does NOT hold document.sign.
 *   7.  s17 -- SOURCE ATTRIBUTION SURVIVES CLASSIFICATION, including when a caller tries to pass a new
 *       source through the engine's own argument object.
 *   8.  s17 -- REMOVING A PATIENT LINK REQUIRES A REASON, and the reason reaches the audit trail.
 *   9.  A FAILED READ IS NEVER A ZERO. A register whose reads fail reports which source failed, its cards
 *       report `unreadable` rather than 0, and `empty` is false -- with a clean workspace as the control.
 *   10. NO RATES. The prior-month comparison is a COUNT and appears only when the prior month existed.
 *   11. BASIC AUDIT: document events are visible and non-document events in the same workspace are not.
 *   12. The swatch map and the engine's card keys are identical in BOTH directions.
 *   13. Cross-workspace isolation on both writes.
 *   14. THE NAV CONTRACT: every tab resolves to a page that exists, and /practice/messages and
 *       /practice/inbox are reachable from this workspace -- which is what makes s3.1's sidebar change
 *       safe to make.
 *
 * CONTROLS: every refusal is paired with the same operation succeeding where it should, so a green
 * "refused" can never be an artefact of a malformed call.
 *
 *   npx --yes tsx scripts/practice-documents-workspace-harness.ts
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, hasCapability } from "../src/lib/practice/access";
import { createDocument, updateDocument, transitionDocument, amendDocument, recordRelease } from "../src/lib/practice/documentation";
import { recordIncoming, reviewIncoming } from "../src/lib/practice/communication";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  documentRegister, documentsOverview, documentActivity, applyFilter,
  classifyIncoming, unlinkIncomingPatient, EMITTED_CARD_KEYS,
} from "../src/lib/practice/documents-workspace";
import {
  DOC_CARD_SWATCH, DOC_CARD_LABEL, DOC_CARD_VIEW, DOC_STATUS, DOC_STATUSES, DOC_ORIGIN, DOC_ORIGINS,
  DOC_TABS, DOC_ADJACENT, DOC_AUDIT_EVENTS, EMPTY_STATE_ACTIONS, parseDocFilter, patientLinkState,
  authoredStatus, receivedStatus,
} from "../src/lib/practice/documents-workspace-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-00000000d0c1";
const USER_B = "00000000-0000-4000-8000-00000000d0c2";
const ASSISTANT = "00000000-0000-4000-8000-00000000d0c3";
const EMPTY_USER = "00000000-0000-4000-8000-00000000d0c4";

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
    idempotency_key: `harness-docws-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-docws",
  }).select("id").single();
  const run = await runProvisioning(admin, {
    id: req!.id, target_user_id: user, correlation_id: "harness-docws", workspace_id: null,
  }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B, ASSISTANT, EMPTY_USER]);
}

const base = { actorId: USER_A, correlationId: "harness-docws" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function newPatient(workspaceId: string, name: string, actor: string, phone: string): Promise<string> {
  const r = await registerPatient(admin, {
    workspaceId, displayName: name, sex: "female", birthDate: "1990-04-02", phone,
    actorId: actor, correlationId: "harness-docws",
  } as any);
  if (!r.ok) throw new Error(`registerPatient failed: ${r.message}`);
  return r.data.id;
}

async function main() {
  console.log("\nCPR-DOC-002 Documents Workspace harness (Phase 1 -- s20)\n");
  await cleanup();

  const wsA = await provision(USER_A, "HARNESS DocWS A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS DocWS B (synthetic)", "b");
  const wsEmpty = await provision(EMPTY_USER, "HARNESS DocWS Empty (synthetic)", "empty");

  // ── 0. Is the machinery this workspace sits on actually deployed? ────────────────────────────────
  // Reported first so every failure below reads as "the migration is missing" rather than as a mystery.
  const reg = await admin.rpc("plat_function_registry");
  const fns = ((reg.data ?? []) as { fn_name: string }[]).map(f => f.fn_name);
  ok("0a-control. the function registry probe returns rows (the trigger check below is not vacuous)",
    fns.length > 0, reg.error?.message ?? `${fns.length} functions`);
  ok("0b. practice_clinical_document_signed_guard() is deployed (migration 195 s7)",
    fns.includes("practice_clinical_document_signed_guard"),
    "NOT FOUND -- signed documents would be engine-protected only");

  const pAlice = await newPatient(wsA, "HARNESS Alice Namulawa", USER_A, "0772 555 301");
  const pBrian = await newPatient(wsA, "HARNESS Brian Kato", USER_A, "0772 555 302");
  const pOther = await newPatient(wsB, "HARNESS Grace Achieng", USER_B, "0772 555 303");

  // ── 1. THE REGISTER COMPOSES THREE SOURCES ──────────────────────────────────────────────────────
  const draftDoc = await createDocument(admin, {
    workspaceId: wsA, patientId: pAlice, docType: "referral_letter",
    title: "HARNESS referral -- neurosurgery", body: "Please see this patient.", ...base,
  });
  ok("1-setup. an authored document is created", draftDoc.ok, draftDoc.ok ? "" : (draftDoc as any).message);
  if (!draftDoc.ok) return report();

  const arrival = await recordIncoming(admin, {
    workspaceId: wsA, docType: "lab_result",
    source: "Lancet Laboratories, Kololo branch", title: "HARNESS FBC result",
    summary: "Full blood count", whereHeld: "paper file", ...base,
  });
  ok("1-setup. an arrival is recorded with no patient (migration 200: patient_id is nullable by design)",
    arrival.ok, arrival.ok ? "" : (arrival as any).message);
  if (!arrival.ok) return report();

  // A patient file. Inserted directly rather than through recordAttachment(), which uploads bytes to a
  // storage bucket -- the register reads metadata only, and a harness that needed object storage would
  // fail for a reason that has nothing to do with this feature.
  const { error: attachError } = await admin.from("practice_attachment").insert({
    workspace_id: wsA, patient_id: pBrian, storage_path: `harness/${wsA}/x.pdf`,
    file_name: "harness-scan.pdf", mime_type: "application/pdf", byte_size: 1024,
    kind: "scan", caption: "HARNESS scanned discharge summary", created_by: USER_A,
  });
  ok("1-setup. a patient file is filed", !attachError, attachError?.message ?? "");

  const regA = await documentRegister(admin, wsA);
  const byOrigin = (o: string) => regA.rows.filter(r => r.origin === o);
  ok("1a. an authored document appears in the register as Created in CP",
    byOrigin("created_in_cp").some(r => r.id === draftDoc.data.id),
    JSON.stringify(regA.rows.map(r => [r.origin, r.title])));
  ok("1b. an arrival appears as Received externally, carrying its sender in words",
    byOrigin("received_externally").some(r => r.id === arrival.data.id && r.source === "Lancet Laboratories, Kololo branch"),
    JSON.stringify(byOrigin("received_externally").map(r => r.source)));
  ok("1c. a patient file appears as Uploaded by staff",
    byOrigin("uploaded_by_staff").some(r => r.title === "HARNESS scanned discharge summary"),
    JSON.stringify(byOrigin("uploaded_by_staff").map(r => r.title)));
  ok("1d. all three origins are present in ONE cross-practice list (s2.1)",
    new Set(regA.rows.map(r => r.origin)).size === 3,
    JSON.stringify([...new Set(regA.rows.map(r => r.origin))]));
  ok("1e-control. every source read cleanly, so the counts below are counts and not silence",
    regA.unreadable.length === 0, JSON.stringify(regA.unreadable));

  // Isolation, made NON-VACUOUS by giving B something of its own to find.
  const bDoc = await createDocument(admin, {
    workspaceId: wsB, patientId: pOther, title: "HARNESS B's own letter", body: "B",
    actorId: USER_B, correlationId: "harness-docws",
  });
  const regB = await documentRegister(admin, wsB);
  ok("1f. workspace B's register does NOT contain workspace A's rows",
    !regB.rows.some(r => r.id === draftDoc.data.id || r.id === arrival.data.id),
    JSON.stringify(regB.rows.map(r => r.title)));
  ok("1f-control. ...and it DOES contain B's own, so 1f is not an empty list agreeing with everything",
    bDoc.ok && regB.rows.some(r => r.id === (bDoc as any).data.id),
    JSON.stringify(regB.rows.map(r => r.title)));

  // ── 2. THE STATUS MODEL (s7, s18) ───────────────────────────────────────────────────────────────
  const statusOf = (rows: any[], id: string) => rows.find(r => r.id === id)?.status ?? "(absent)";
  ok("2a. a new authored document reads as Draft", statusOf(regA.rows, draftDoc.data.id) === "draft",
    statusOf(regA.rows, draftDoc.data.id));

  // Two signed documents, ONE RELEASED AND ONE NOT, read in the SAME call -- so `issued` cannot be
  // produced by a function that always returns the same word.
  const signedOnly = await createDocument(admin, {
    workspaceId: wsA, patientId: pAlice, title: "HARNESS signed, never released", body: "Signed only.", ...base,
  });
  const issuedOne = await createDocument(admin, {
    workspaceId: wsA, patientId: pAlice, title: "HARNESS signed and released", body: "Issued.", ...base,
  });
  const readyOne = await createDocument(admin, {
    workspaceId: wsA, patientId: pBrian, title: "HARNESS marked ready", body: "Ready.", ...base,
  });
  if (!signedOnly.ok || !issuedOne.ok || !readyOne.ok) { ok("2-setup. three more documents", false); return report(); }

  for (const d of [signedOnly.data.id, issuedOne.data.id]) {
    await transitionDocument(admin, { workspaceId: wsA, documentId: d, to: "FINAL", ...base });
    await transitionDocument(admin, { workspaceId: wsA, documentId: d, to: "SIGNED", ...base });
  }
  await transitionDocument(admin, { workspaceId: wsA, documentId: readyOne.data.id, to: "FINAL", ...base });
  const released = await recordRelease(admin, {
    workspaceId: wsA, documentId: issuedOne.data.id, channel: "handed_over", recipient: "the patient", ...base,
  });
  ok("2-setup. a copy of exactly one of the two signed documents is recorded as released",
    released.ok, released.ok ? "" : (released as any).message);

  const reg2 = await documentRegister(admin, wsA);
  ok("2b. FINAL reads as Approved (s7: accepted, not yet issued)",
    statusOf(reg2.rows, readyOne.data.id) === "approved", statusOf(reg2.rows, readyOne.data.id));
  ok("2c. a SIGNED document with no release recorded reads as Signed, not Issued",
    statusOf(reg2.rows, signedOnly.data.id) === "signed", statusOf(reg2.rows, signedOnly.data.id));
  ok("2d. ⚠ a SIGNED document WITH a release reads as Issued -- in the same read as 2c, so the word is derived and not constant",
    statusOf(reg2.rows, issuedOne.data.id) === "issued", statusOf(reg2.rows, issuedOne.data.id));

  const amended = await amendDocument(admin, {
    workspaceId: wsA, documentId: signedOnly.data.id, reason: "HARNESS: wrong date", ...base,
  });
  const reg3 = await documentRegister(admin, wsA);
  ok("2e. an amended document reads as Superseded and its successor is a separate Draft row",
    amended.ok
      && statusOf(reg3.rows, signedOnly.data.id) === "superseded"
      && statusOf(reg3.rows, (amended as any).data?.id) === "draft",
    `${statusOf(reg3.rows, signedOnly.data.id)} / ${amended.ok ? statusOf(reg3.rows, amended.data.id) : (amended as any).code}`);

  await reviewIncoming(admin, { workspaceId: wsA, incomingId: arrival.data.id, note: "seen", ...base });
  const secondArrival = await recordIncoming(admin, {
    workspaceId: wsA, docType: "imaging_report", source: "Nsambya Radiology",
    title: "HARNESS CT brain", priority: "urgent", ...base,
  });
  const reg4 = await documentRegister(admin, wsA);
  ok("2f. ⚠ RECEIVED reads as Awaiting review and REVIEWED reads as Reviewed -- both in the same read",
    secondArrival.ok
      && statusOf(reg4.rows, (secondArrival as any).data.id) === "awaiting_review"
      && statusOf(reg4.rows, arrival.data.id) === "reviewed",
    `${secondArrival.ok ? statusOf(reg4.rows, secondArrival.data.id) : "?"} / ${statusOf(reg4.rows, arrival.data.id)}`);
  ok("2g. every stored status this schema can hold maps to a chip that exists",
    ["DRAFT", "FINAL", "SIGNED", "AMENDED", "ENTERED_IN_ERROR"].every(s => !!DOC_STATUS[authoredStatus(s, 0)])
    && ["RECEIVED", "REVIEWED", "ACTIONED"].every(s => !!DOC_STATUS[receivedStatus(s)]),
    "a stored value with no chip would render an undefined class");

  // ── 3. EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN ────────────────────────────────────────
  const overview = await documentsOverview(admin, wsA, { userId: USER_A, capabilities: ["document.view"] });
  const cardCounts: Record<string, number> = {};
  let cardsChecked = 0;
  for (const card of overview.cards) {
    if (card.count.state !== "ok") continue;
    cardsChecked++;
    cardCounts[card.key] = card.count.value;
    // The card's OWN href, parsed by the SAME parser the page uses, re-applied to the SAME rows.
    const qs = card.href.includes("?") ? card.href.split("?")[1] : "";
    const sp = Object.fromEntries(new URLSearchParams(qs).entries());
    const reopened = applyFilter(overview.register.rows, parseDocFilter(sp), overview.register.today).length;
    ok(`3a. the "${DOC_CARD_LABEL[card.key].label}" figure equals the list its own href opens (${card.count.value})`,
      reopened === card.count.value, `card ${card.count.value}, list ${reopened}, href ${card.href}`);
  }
  ok("3b-control. all five cards were checked and at least two carry a non-zero figure, so 3a is not comparing zeroes",
    cardsChecked === 5 && Object.values(cardCounts).filter(n => n > 0).length >= 2,
    JSON.stringify(cardCounts));
  ok("3c-control. the five figures are NOT all the same number, so 3a's predicates really differ",
    new Set(Object.values(cardCounts)).size > 1, JSON.stringify(cardCounts));
  ok("3d. every attention-queue section carries the rows it counts, not a number beside a promise",
    overview.attention.length > 0 && overview.attention.every(q => q.rows.length > 0 && !!q.href),
    JSON.stringify(overview.attention.map(q => [q.key, q.rows.length])));
  // ⚠ AND "Work this list" OPENS EXACTLY WHAT THE SECTION IS SHOWING. The section href is re-parsed and
  // re-applied, the same way each card's is: a queue that opens some other list is a queue you cannot
  // trust to be the work.
  const queueMismatch = overview.attention.filter(q => {
    const sp = Object.fromEntries(new URLSearchParams(q.href.split("?")[1] ?? "").entries());
    const opened = applyFilter(overview.register.rows, parseDocFilter(sp), overview.register.today);
    return opened.slice(0, 8).map(r => r.id).join() !== q.rows.map(r => r.id).join();
  });
  ok("3e. ⚠ each attention section's 'Work this list' opens exactly the rows the section is showing",
    queueMismatch.length === 0, queueMismatch.map(q => `${q.key} -> ${q.href}`).join(", "));
  ok("3e-control. all three sections were checked (an empty attention queue would pass 3e vacuously)",
    overview.attention.length === 3, JSON.stringify(overview.attention.map(q => q.key)));

  // ── 3f. THE SAME TWO CHECKS UNDER A CHOSEN PERIOD, WHICH IS WHERE THEY WERE FAILING ─────────────
  //
  // ⚠ 3a AND 3e ONLY EVER RAN WITH NO PERIOD, AND THAT IS WHY THIS SHIPPED. documentsOverview passes
  // {from, to} into documentRegister, so under a period EVERY count on the dashboard is bounded --
  // while DOC_CARD_VIEW was a static string carrying no period at all. Narrowed to a range, a card
  // reading 3 opened a list of 47, and all three attention queues did the same. Every existing
  // assertion stayed green because none of them ever chose a period.
  //
  // ⚠ AND THE COMMENT ABOVE DOC_CARD_VIEW ALREADY RECORDS THIS BUG BEING FOUND ONCE, on `origin`:
  // "card said 5, list showed 8, and both were correct answers to two different questions". It was
  // fixed there and the period control reintroduced it on a new axis. A test that covers one axis of a
  // predicate does not cover the next one somebody adds.
  // ⚠ THE FIXTURE HAS TO BE BACK-DATED FIRST, AND THE CONTROL IS WHAT FOUND THAT OUT. Every row this
  // harness creates is made in the same run, so the whole register shares one date -- and a period over
  // a single-date register selects everything, which is the unbounded run wearing a period's clothes.
  // 3f and 3g passed vacuously until 3f-control failed and said so.
  //
  // Back-dating ONE authored row is enough for two distinct dates, and it is done AFTER 3a-3e have run
  // so nothing above sees a changed register. `at` for an authored row is signed_at ?? created_at, so
  // both move together or the row keeps today's date through the column that was not touched.
  // ⚠ THE BACK-DATING WAS SILENTLY FAILING AND 3f-control WAS THE ONLY THING THAT SAID SO. It took
  // `limit(1)` -- an arbitrary row, often a SIGNED one -- and DISCARDED the update's error. Migration
  // 194's trigger refuses a write to a signed document, so the row kept today's date, the register had
  // one date, and a period over a single-date register selects everything. That is the unbounded run
  // wearing a period's clothes, which is exactly what this control exists to catch.
  //
  // Two changes, and both are the same rule: pick a row that CAN be written, and never throw away the
  // answer when you write it. A fixture that fails quietly makes the assertions above it meaningless
  // while leaving them green.
  const backAt = new Date(Date.now() - 45 * 86400000).toISOString();
  const { data: toAge } = await admin.from("practice_clinical_document")
    .select("id, status").eq("workspace_id", wsA)
    .not("status", "in", "(SIGNED,AMENDED,ENTERED_IN_ERROR)").limit(1);
  ok("3f-fixture. an UNLOCKED document exists to back-date -- a signed one cannot be written",
    !!toAge?.[0], JSON.stringify(toAge));
  if (toAge?.[0]) {
    const { data: aged, error: ageErr } = await admin.from("practice_clinical_document")
      .update({ created_at: backAt, signed_at: null }).eq("id", toAge[0].id).select("id");
    ok("3f-fixture-b. and the back-dating actually landed, so the register really has two dates",
      !ageErr && (aged ?? []).length === 1,
      ageErr?.message ?? `${(aged ?? []).length} rows updated`);
  }

  const spread = await documentsOverview(admin, wsA, { userId: USER_A, capabilities: ["document.view"] });
  const allDates = [...new Set(spread.register.rows.map(r => r.at))].sort();
  // A boundary that genuinely splits the register, so the bounded run is not the unbounded run again.
  const cutoff = allDates[Math.floor(allDates.length / 2)];
  const bounded = await documentsOverview(admin, wsA, {
    userId: USER_A, capabilities: ["document.view"], from: cutoff,
  });
  ok("3f-control. the period actually narrowed the register (otherwise 3f and 3g are the unbounded run)",
    allDates.length >= 2 && bounded.register.rows.length > 0
      && bounded.register.rows.length < spread.register.rows.length,
    `dates ${allDates.length}, bounded ${bounded.register.rows.length} of ${spread.register.rows.length}, from ${cutoff}`);

  // ⚠ THE HREF IS RE-APPLIED TO THE **UNBOUNDED** REGISTER, AND THE FIRST VERSION USED THE BOUNDED ONE.
  // That version could not fail: `bounded.register.rows` are already period-filtered, so re-applying a
  // filter that has LOST the period selects exactly the same rows. It passed with the bug deliberately
  // reintroduced. What actually happens when somebody clicks a card is a fresh navigation to
  // /documents/patient, which re-reads the WHOLE register through parseDocFilter -- so the honest
  // simulation is the whole register, and only that shape can see a period going missing.
  const boundedMismatch = bounded.cards.filter(card => {
    if (card.count.state !== "ok") return false;
    const sp = Object.fromEntries(new URLSearchParams(card.href.split("?")[1] ?? "").entries());
    return applyFilter(spread.register.rows, parseDocFilter(sp), spread.register.today).length
      !== card.count.value;
  });
  ok("3f. ⚠ UNDER A PERIOD, every card's figure still equals the list its own href opens",
    boundedMismatch.length === 0,
    boundedMismatch.map(c => `${c.key}: card ${c.count.state === "ok" ? c.count.value : "?"} href ${c.href}`).join(" | "));

  // ⚠ AND EVERY CARD'S HREF MUST CARRY THE PERIOD. Without this, 3f could pass by the href happening to
  // select the same rows -- true today for a small fixture, and false the moment the register grows.
  ok("3f-b. and every card href carries the period it was counted under",
    bounded.cards.every(c => c.href.includes(`from=${cutoff}`)),
    bounded.cards.map(c => c.href).join(" | "));

  // Same correction as 3f: the whole register, because that is what the link opens.
  const boundedQueueMismatch = bounded.attention.filter(q => {
    const sp = Object.fromEntries(new URLSearchParams(q.href.split("?")[1] ?? "").entries());
    const opened = applyFilter(spread.register.rows, parseDocFilter(sp), spread.register.today);
    return opened.slice(0, 8).map(r => r.id).join() !== q.rows.map(r => r.id).join();
  });
  ok("3g. ⚠ UNDER A PERIOD, each attention section opens exactly the rows it is showing",
    boundedQueueMismatch.length === 0,
    boundedQueueMismatch.map(q => `${q.key} -> ${q.href}`).join(", "));

  // ⚠ created_this_month DROPS ITS WINDOW WHEN BOUNDED, because the COUNT drops it -- intersecting the
  // reader's range with "this month" would read nought. An href that kept it would open the one list
  // guaranteed to be empty, which is the failure mode this whole section exists to prevent.
  const createdCard = bounded.cards.find(c => c.key === "created_this_month");
  ok("3g-b. the created card drops window=this_month under a period, exactly as its count does",
    !!createdCard && !createdCard.href.includes("window=this_month"), createdCard?.href);

  // ── 4. s17 RULE 1 -- NO PATIENT-SPECIFIC DOCUMENT WITHOUT A PATIENT LINK ────────────────────────
  const rawNullPatient = await admin.from("practice_clinical_document").insert({
    workspace_id: wsA, patient_id: null, title: "HARNESS no patient", body: "x", status: "DRAFT",
  }).select("id");
  ok("4a. ⚠ the DATABASE refuses an authored document with no patient link (migration 195 s4, not null)",
    !!rawNullPatient.error, rawNullPatient.error?.message ?? "WAS ALLOWED -- a document about nobody");
  const rawWithPatient = await admin.from("practice_clinical_document").insert({
    workspace_id: wsA, patient_id: pAlice, title: "HARNESS raw control", body: "x", status: "DRAFT",
  }).select("id").single();
  ok("4a-control. the IDENTICAL insert with a real patient succeeds, so 4a is the null and not the statement",
    !rawWithPatient.error, rawWithPatient.error?.message ?? "");

  const crossPatient = await createDocument(admin, {
    workspaceId: wsA, patientId: pOther, title: "HARNESS cross-workspace", body: "x", ...base,
  });
  ok("4b. a document cannot be filed against another workspace's patient",
    !crossPatient.ok && (crossPatient as any).code === "NOT_FOUND",
    crossPatient.ok ? "was allowed" : (crossPatient as any).code);
  ok("4b-control. the same call with this workspace's patient succeeds",
    (await createDocument(admin, { workspaceId: wsA, patientId: pAlice, title: "HARNESS control doc", body: "x", ...base })).ok);

  const unlinkedRow = reg4.rows.find(r => r.id === (secondArrival as any).data.id)!;
  const linkedRow = reg4.rows.find(r => r.id === draftDoc.data.id)!;
  ok("4c. an arrival with no patient is NAMED as unlinked, and a linked row is not -- in one pass",
    patientLinkState(unlinkedRow).ok === false && patientLinkState(linkedRow).ok === true,
    `${JSON.stringify(patientLinkState(unlinkedRow))} / ${JSON.stringify(patientLinkState(linkedRow))}`);

  // ── 5. s17 RULE 2 -- A SIGNED DOCUMENT IS IMMUTABLE ─────────────────────────────────────────────
  const engineEdit = await updateDocument(admin, {
    workspaceId: wsA, documentId: issuedOne.data.id, body: "REWRITTEN BY THE ENGINE", ...base,
  });
  ok("5a. the engine refuses to edit a signed document",
    !engineEdit.ok && (engineEdit as any).code === "DOCUMENT_LOCKED",
    engineEdit.ok ? "was allowed" : (engineEdit as any).code);

  const rawEdit = await admin.from("practice_clinical_document")
    .update({ body: "REWRITTEN BY A RAW STATEMENT" }).eq("id", issuedOne.data.id).select("id");
  ok("5b. ⚠ a RAW update that bypasses the engine is refused by migration 195's trigger",
    !!rawEdit.error, rawEdit.error?.message ?? "WAS ALLOWED -- the guarantee is engine-only");

  const rawDraftEdit = await admin.from("practice_clinical_document")
    .update({ body: "REWRITTEN, LEGITIMATELY" }).eq("id", rawWithPatient.data!.id).select("id");
  ok("5b-control. the IDENTICAL raw update on a DRAFT succeeds, so 5b is the signature and not the syntax",
    !rawDraftEdit.error && (rawDraftEdit.data ?? []).length === 1,
    rawDraftEdit.error?.message ?? `${(rawDraftEdit.data ?? []).length} rows`);

  const { data: stillSigned } = await admin.from("practice_clinical_document")
    .select("body").eq("id", issuedOne.data.id).single();
  ok("5c. and the signed document's text is byte-for-byte what it was",
    stillSigned?.body === "Issued.", JSON.stringify(stillSigned?.body));

  // ── 6. s13 -- AN ASSISTANT CANNOT SIGN AS A PRACTITIONER ────────────────────────────────────────
  //
  // ⚠ CAPABILITY CODES ARE STRINGS COMPARED AGAINST A TABLE. Inventing a plausible one costs nothing at
  // compile time and silently disables a feature at runtime -- this codebase has shipped six such. Every
  // code this feature names is checked against the seed as it actually is, not against a list retyped
  // here.
  const { data: seeded, error: seedError } = await admin.from("practice_role_capabilities")
    .select("role_code, capability_code");
  const seedRows = (seeded ?? []) as any[];
  ok("6a-control. practice_role_capabilities was read (every check below would pass vacuously on an empty table)",
    !seedError && seedRows.length > 0, seedError?.message ?? `${seedRows.length} rows`);
  const seedSet = new Set(seedRows.map(r => r.capability_code as string));
  const NAMED = [
    "document.view", "document.author", "document.sign", "template.manage",
    "inbox.record", "inbox.review", "message.use", "encounter.list", "patient.list",
  ];
  const invented = NAMED.filter(c => !seedSet.has(c));
  ok("6b. every capability code this workspace names exists in the seeded catalogue",
    invented.length === 0, invented.length ? `INVENTED: ${invented.join(", ")}` : "");

  const grants = (role: string) => new Set(seedRows.filter(r => r.role_code === role).map(r => r.capability_code));
  ok("6c. the practitioner role is granted document.sign", grants("practitioner").has("document.sign"));
  ok("6d. ⚠ the practice_assistant role is NOT granted document.sign (s13)",
    !grants("practice_assistant").has("document.sign"),
    "an assistant could sign as a practitioner");
  ok("6d-control. ...and the assistant IS granted inbox.record, so 6d is not 'the assistant has nothing'",
    grants("practice_assistant").has("inbox.record"));

  // LIVE: a real assistant membership, its capabilities backfilled the way the migrations do it, and the
  // context resolved through the same function every page and every route uses.
  await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: ASSISTANT, role_code: "practice_assistant", status: "active",
  });
  const { data: am } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", wsA).eq("user_id", ASSISTANT).single();
  await admin.from("practice_role_assignment").insert(
    [...grants("practice_assistant")].map(c => ({
      membership_id: am!.id, capability_code: c, source: "role_default",
    })),
  );
  const assistantCtx = await resolveWorkspaceContext(admin, ASSISTANT, wsA);
  const practitionerCtx = await resolveWorkspaceContext(admin, USER_A, wsA);
  ok("6e-control. both contexts resolve, so the comparison below is between two real callers",
    assistantCtx.ok && practitionerCtx.ok,
    `${assistantCtx.ok ? "ok" : (assistantCtx as any).reason} / ${practitionerCtx.ok ? "ok" : (practitionerCtx as any).reason}`);
  if (assistantCtx.ok && practitionerCtx.ok) {
    ok("6f. ⚠ a LIVE assistant context does not hold document.sign",
      !hasCapability(assistantCtx.ctx, "document.sign"),
      JSON.stringify(assistantCtx.ctx.capabilities));
    ok("6f-control. ...while the practitioner's does, so 6f is not an empty capability set",
      hasCapability(practitionerCtx.ctx, "document.sign"));
    ok("6g. and the assistant DOES hold inbox.record -- the classify route's capability, which is the point of s13's split",
      hasCapability(assistantCtx.ctx, "inbox.record"));
  }

  // ── 7. s17 -- SOURCE ATTRIBUTION SURVIVES CLASSIFICATION ────────────────────────────────────────
  const SOURCE = "Nsambya Radiology";
  const beforeClassify = await admin.from("practice_incoming_document")
    .select("source, doc_type, patient_id").eq("id", (secondArrival as any).data.id).single();
  const classified = await classifyIncoming(admin, {
    workspaceId: wsA, incomingId: (secondArrival as any).data.id,
    patientId: pBrian, docType: "discharge_summary", receivedOn: "2026-05-01",
    // ⚠ A SOURCE PASSED THROUGH THE ENGINE'S OWN ARGUMENT OBJECT. There is no parameter for it; this
    // asserts the allowlist rather than the type signature, because a route could always cast.
    ...({ source: "SOMEBODY ELSE ENTIRELY" } as any),
    ...base,
  });
  ok("7a. classify links the patient and sets the type",
    classified.ok && (classified as any).data.patientId === pBrian && (classified as any).data.docType === "discharge_summary",
    classified.ok ? JSON.stringify(classified.data) : (classified as any).message);
  const afterClassify = await admin.from("practice_incoming_document")
    .select("source, doc_type, patient_id, received_on").eq("id", (secondArrival as any).data.id).single();
  ok("7b. ⚠ the source is byte-for-byte what it was, even though a new one was passed in",
    afterClassify.data?.source === SOURCE && beforeClassify.data?.source === SOURCE,
    `before ${JSON.stringify(beforeClassify.data?.source)} after ${JSON.stringify(afterClassify.data?.source)}`);
  ok("7b-control. ...and the row REALLY CHANGED, so 7b is not 'nothing was written'",
    afterClassify.data?.patient_id === pBrian
    && afterClassify.data?.doc_type === "discharge_summary"
    && beforeClassify.data?.patient_id === null
    && beforeClassify.data?.doc_type === "imaging_report",
    `${JSON.stringify(beforeClassify.data)} -> ${JSON.stringify(afterClassify.data)}`);
  ok("7c. and the classified row keeps its Received-externally origin -- filing does not make it ours",
    (await documentRegister(admin, wsA)).rows
      .find(r => r.id === (secondArrival as any).data.id)?.origin === "received_externally");
  const badType = await classifyIncoming(admin, {
    workspaceId: wsA, incomingId: (secondArrival as any).data.id, docType: "sick_note", ...base,
  });
  ok("7d. a document type from the WRONG vocabulary is refused (sick_note is an authored type, not an arriving one)",
    !badType.ok && (badType as any).code === "VALIDATION_ERROR",
    badType.ok ? "was allowed" : (badType as any).code);

  // ── 8. s17 -- REMOVING A PATIENT LINK REQUIRES A REASON ─────────────────────────────────────────
  const noReason = await unlinkIncomingPatient(admin, {
    workspaceId: wsA, incomingId: (secondArrival as any).data.id, reason: "   ", ...base,
  });
  ok("8a. unlinking with no reason is refused",
    !noReason.ok && (noReason as any).code === "REASON_REQUIRED",
    noReason.ok ? "was allowed" : (noReason as any).code);
  const nullThroughClassify = await classifyIncoming(admin, {
    workspaceId: wsA, incomingId: (secondArrival as any).data.id, patientId: null, ...base,
  });
  ok("8b. and classify cannot be used as a back door to unlink",
    !nullThroughClassify.ok && (nullThroughClassify as any).code === "USE_UNLINK",
    nullThroughClassify.ok ? "was allowed" : (nullThroughClassify as any).code);

  const REASON = "HARNESS: filed against the wrong Kato";
  const unlinked = await unlinkIncomingPatient(admin, {
    workspaceId: wsA, incomingId: (secondArrival as any).data.id, reason: REASON, ...base,
  });
  ok("8a-control. the same call WITH a reason succeeds",
    unlinked.ok, unlinked.ok ? "" : (unlinked as any).message);
  const { data: afterUnlink } = await admin.from("practice_incoming_document")
    .select("patient_id, source").eq("id", (secondArrival as any).data.id).single();
  ok("8c. the link is gone and the source is STILL untouched",
    afterUnlink?.patient_id === null && afterUnlink?.source === SOURCE, JSON.stringify(afterUnlink));
  const { data: unlinkEvents } = await admin.from("practice_audit_event")
    .select("payload").eq("workspace_id", wsA).eq("event_type", "practice.incoming_patient_unlinked");
  ok("8d. the reason reaches the audit trail, with the patient it was removed from",
    ((unlinkEvents ?? []) as any[]).some(e => e.payload?.reason === REASON && e.payload?.previousPatientId === pBrian),
    JSON.stringify(unlinkEvents));
  const twice = await unlinkIncomingPatient(admin, {
    workspaceId: wsA, incomingId: (secondArrival as any).data.id, reason: "again", ...base,
  });
  ok("8e. unlinking a row that is not linked is refused rather than silently doing nothing",
    !twice.ok && (twice as any).code === "NOT_LINKED", twice.ok ? "was allowed" : (twice as any).code);

  // ── 9. A FAILED READ IS NEVER A ZERO ────────────────────────────────────────────────────────────
  //
  // A workspace id PostgREST cannot parse makes every read ERROR for real (invalid uuid syntax), which is
  // the closest a harness gets to an outage without one.
  const broken = await documentRegister(admin, "not-a-uuid" as any);
  ok("9a. a register whose reads failed reports WHICH sources failed",
    broken.unreadable.length >= 3 && broken.rows.length === 0,
    `${broken.unreadable.length} unreadable: ${JSON.stringify(broken.unreadable.map(u => u.source))}`);
  // ⚠ THE LENGTH TEST FIRST. `.every()` over an empty array is true, so without it this control passes
  // LOUDEST exactly when the error was swallowed and there is nothing to carry words about.
  ok("9a-control. ...and it carries the database's own words rather than a phrase this file invented",
    broken.unreadable.length > 0 && broken.unreadable.every(u => u.detail.length > 0 && u.detail !== "unreadable"),
    JSON.stringify(broken.unreadable.map(u => u.detail)));

  const brokenOverview = await documentsOverview(admin, "not-a-uuid" as any, { userId: USER_A, capabilities: [] });
  ok("9b. ⚠ every card is `unreadable`, NOT `ok: 0`",
    brokenOverview.cards.length === 5 && brokenOverview.cards.every(c => c.count.state === "unreadable"),
    JSON.stringify(brokenOverview.cards.map(c => [c.key, c.count.state, (c.count as any).value])));
  ok("9b-control. ...while the same five cards over a real workspace are `ok`, so 9b is not 'cards are always unreadable'",
    overview.cards.length === 5 && overview.cards.every(c => c.count.state === "ok"),
    JSON.stringify(overview.cards.map(c => [c.key, c.count.state])));
  ok("9c. ⚠ `empty` is FALSE when the reads failed -- a broken workspace does not get 'here is how to get started'",
    brokenOverview.empty === false, `${brokenOverview.empty}`);

  const emptyOverview = await documentsOverview(admin, wsEmpty, { userId: EMPTY_USER, capabilities: [] });
  ok("9c-control. ...and `empty` IS true for a workspace that genuinely holds nothing and read cleanly",
    emptyOverview.empty === true && emptyOverview.register.unreadable.length === 0,
    `${emptyOverview.empty} / ${JSON.stringify(emptyOverview.register.unreadable)}`);
  ok("9d. an empty workspace's cards are `ok: 0`, which is a real answer and not the failure's answer",
    emptyOverview.cards.every(c => c.count.state === "ok" && (c.count as any).value === 0),
    JSON.stringify(emptyOverview.cards.map(c => [c.key, c.count.state, (c.count as any).value])));

  // ── 10. NO RATES, AND NO COMPARISON AGAINST A MONTH THIS PRACTICE DID NOT LIVE THROUGH ──────────
  const created = overview.cards.find(c => c.key === "created_this_month")!;
  ok("10a. a workspace created today carries NO prior-month comparison",
    created.against === null, JSON.stringify(created.against));
  ok("10a-control. ...while still carrying a figure, so 10a is not a missing card",
    created.count.state === "ok" && created.count.value > 0, JSON.stringify(created.count));

  // Back-date the workspace so last month genuinely existed for it, and the comparison must appear.
  const twoMonthsAgo = new Date(Date.now() - 62 * 86400000).toISOString();
  await admin.from("practice_workspace").update({ created_at: twoMonthsAgo }).eq("id", wsA);
  const aged = await documentsOverview(admin, wsA, { userId: USER_A, capabilities: [] });
  const agedCreated = aged.cards.find(c => c.key === "created_this_month")!;
  ok("10b. ⚠ once the prior month existed, the comparison appears -- and it is a COUNT, never a rate",
    agedCreated.against !== null && Number.isInteger(agedCreated.against!.count)
    && !JSON.stringify(agedCreated.against).includes("%"),
    JSON.stringify(agedCreated.against));
  ok("10c. no card anywhere carries a percentage or a rate field",
    aged.cards.every(c => c.against === null || (typeof c.against.count === "number" && "label" in c.against)),
    JSON.stringify(aged.cards.map(c => c.against)));

  // ── 11. BASIC AUDIT ─────────────────────────────────────────────────────────────────────────────
  const activity = await documentActivity(admin, wsA, 50);
  ok("11a. the document activity trail reads",
    activity.state === "ok" && activity.value.length > 0,
    activity.state === "ok" ? `${activity.value.length} entries` : (activity as any).detail);
  if (activity.state === "ok") {
    ok("11b. it includes the classify this harness performed",
      activity.value.some(e => e.eventType === "practice.incoming_classified"),
      JSON.stringify([...new Set(activity.value.map(e => e.eventType))]));
    // NON-VACUOUS: provisioning wrote non-document events into this same workspace. Prove they are there
    // AND that the panel does not show them.
    const { data: nonDoc } = await admin.from("practice_audit_event")
      .select("event_type").eq("workspace_id", wsA)
      .not("event_type", "in", `(${Object.keys(DOC_AUDIT_EVENTS).join(",")})`);
    ok("11c-control. non-document events DO exist in this workspace's trail",
      ((nonDoc ?? []) as any[]).length > 0,
      JSON.stringify([...new Set(((nonDoc ?? []) as any[]).map(r => r.event_type))]));
    ok("11c. ⚠ and none of them appears in the document activity panel",
      activity.value.every(e => !!DOC_AUDIT_EVENTS[e.eventType]),
      JSON.stringify(activity.value.map(e => e.eventType).filter(t => !DOC_AUDIT_EVENTS[t])));
    ok("11d. ⚠ no activity entry carries clinical text -- the subject is an id, never a body",
      activity.value.every(e => e.subject === null || /^[0-9a-f-]{36}$/i.test(e.subject)),
      JSON.stringify(activity.value.map(e => e.subject).filter(s => s && !/^[0-9a-f-]{36}$/i.test(s))));
  }

  // ── 12. THE SWATCH MAP AND THE ENGINE AGREE, IN BOTH DIRECTIONS ─────────────────────────────────
  const emitted = overview.cards.map(c => c.key);
  ok("12a. every card the engine emits has a swatch",
    emitted.every(k => !!DOC_CARD_SWATCH[k]), emitted.filter(k => !DOC_CARD_SWATCH[k]).join(", "));
  ok("12b. and the swatch map holds nothing the engine does not emit",
    Object.keys(DOC_CARD_SWATCH).every(k => (emitted as string[]).includes(k)),
    Object.keys(DOC_CARD_SWATCH).filter(k => !(emitted as string[]).includes(k)).join(", "));
  ok("12b-control. the declared key list matches what was actually emitted",
    [...EMITTED_CARD_KEYS].sort().join() === [...emitted].sort().join(),
    `${[...EMITTED_CARD_KEYS].sort().join()} vs ${[...emitted].sort().join()}`);
  ok("12c. every card key has a label and a view href",
    emitted.every(k => !!DOC_CARD_LABEL[k] && !!DOC_CARD_VIEW[k]));
  ok("12d. every status and every origin has a chip, so no row can render an undefined class",
    DOC_STATUSES.every(s => !!DOC_STATUS[s]?.chip) && DOC_ORIGINS.every(o => !!DOC_ORIGIN[o]?.chip));

  // ── 13. CROSS-WORKSPACE ISOLATION ON THE WRITES ─────────────────────────────────────────────────
  const crossClassify = await classifyIncoming(admin, {
    workspaceId: wsB, incomingId: arrival.data.id, patientId: pOther,
    actorId: USER_B, correlationId: "harness-docws",
  });
  ok("13a. workspace B cannot classify workspace A's arrival",
    !crossClassify.ok && (crossClassify as any).code === "NOT_FOUND",
    crossClassify.ok ? "was allowed" : (crossClassify as any).code);
  ok("13a-control. workspace A can classify its own",
    (await classifyIncoming(admin, { workspaceId: wsA, incomingId: arrival.data.id, patientId: pAlice, ...base })).ok);
  const crossLink = await classifyIncoming(admin, {
    workspaceId: wsA, incomingId: arrival.data.id, patientId: pOther, ...base,
  });
  ok("13b. an arrival cannot be linked to ANOTHER workspace's patient",
    !crossLink.ok && (crossLink as any).code === "NOT_FOUND",
    crossLink.ok ? "was allowed" : (crossLink as any).code);
  const crossUnlink = await unlinkIncomingPatient(admin, {
    workspaceId: wsB, incomingId: arrival.data.id, reason: "not mine",
    actorId: USER_B, correlationId: "harness-docws",
  });
  ok("13c. workspace B cannot unlink workspace A's arrival",
    !crossUnlink.ok && (crossUnlink as any).code === "NOT_FOUND",
    crossUnlink.ok ? "was allowed" : (crossUnlink as any).code);

  const { data: anonRows, error: anonError } = await anon.from("practice_incoming_document").select("id").limit(5);
  ok("13d. an anonymous client reads no rows from the incoming register (RLS, migration 200 s6)",
    (anonRows ?? []).length === 0, anonError?.message ?? `${(anonRows ?? []).length} rows`);

  // ── 14. THE NAV CONTRACT -- what makes s3.1's sidebar change safe ───────────────────────────────
  const pageFor = (href: string) =>
    join(process.cwd(), "src", "app", "practice", "(shell)", href.replace(/^\/practice\//, ""), "page.tsx");
  const missingTabs = DOC_TABS.filter(t => !existsSync(pageFor(t.href)));
  ok("14a. every tab in this workspace resolves to a page that exists",
    missingTabs.length === 0, missingTabs.map(t => t.href).join(", "));
  ok("14a-control. the tab list is not empty and the path scan really ran",
    DOC_TABS.length >= 3 && existsSync(pageFor("/practice/documents")),
    `${DOC_TABS.length} tabs`);
  const adjacentHrefs = DOC_ADJACENT.map(a => a.href);
  ok("14b. ⚠ /practice/inbox and /practice/messages are BOTH reachable from inside this workspace",
    adjacentHrefs.includes("/practice/inbox") && adjacentHrefs.includes("/practice/messages"),
    adjacentHrefs.join(", "));
  const missingAdjacent = DOC_ADJACENT.filter(a => !existsSync(pageFor(a.href)));
  ok("14b-control. ...and both of those pages exist, so 14b is a route and not a string",
    missingAdjacent.length === 0, missingAdjacent.map(a => a.href).join(", "));
  ok("14c. every adjacent link declares the capability its own page requires",
    DOC_ADJACENT.every(a => seedSet.has(a.capability)),
    DOC_ADJACENT.filter(a => !seedSet.has(a.capability)).map(a => a.capability).join(", "));

  // ⚠ s4.1's THREE ACTIONS ARE ROUTES, NOT PROMISES. The first build pointed one of them at
  // `?record=1`, a parameter nothing parses -- a link dressed as a control. This is the check that makes
  // that a failure rather than something somebody notices.
  const badActions = EMPTY_STATE_ACTIONS.filter(a => !existsSync(pageFor(a.href.split("?")[0])));
  ok("14d. ⚠ every empty-state action points at a page that exists",
    badActions.length === 0, badActions.map(a => a.href).join(", "));
  ok("14d-control. all three of s4.1's actions are declared, and none carries a query nothing reads",
    EMPTY_STATE_ACTIONS.length === 3 && EMPTY_STATE_ACTIONS.every(a => !a.href.includes("?")),
    EMPTY_STATE_ACTIONS.map(a => a.href).join(", "));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`   - ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch(async e => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
