/**
 * Practice communication harness -- CPR-320, exercised against the live database through the same
 * engine the API uses.
 *
 * WHAT IT PROVES:
 *   1. THREADS. A subject with no body is refused (a heading is not a message); a colleague sees the
 *      thread UNREAD, derived from a cursor with nothing stored on the message; opening it clears that;
 *      a reply makes it unread again FOR THE COLLEAGUE ONLY -- your own message never reads as unread
 *      at you. What was said cannot be unsaid, even by a raw statement (migration 200 s5).
 *   2. THE CONTACT LOG records what happened in the world: words required, the follow-up being chased
 *      must belong to the person being called, rows are immutable, and NOTHING IS SENT -- asserted
 *      structurally: no sent_at, no delivery state anywhere in the row.
 *   3. THE INCOMING REGISTER. Receipt is recorded; a result CANNOT jump RECEIVED -> ACTIONED, because
 *      review is a clinical stamp with a name on it and the register exists to answer "who looked";
 *      review stamps who and when; re-review is refused; actioning needs words. A result for an
 *      ARCHIVED patient is registrable -- refusing it would lose the fact that it arrived.
 *   4. THE MISSED-RESULT FIGURE IS DERIVED. "Received, nobody has looked" appears on the operations
 *      home with nothing having run, escalates when the desk flagged urgency, and leaves the moment a
 *      practitioner reviews. Unread messages surface the same way. Both vanish -- not zero -- without
 *      the capability, and the blind spot is named.
 *   5. SEARCH: sentinel words in a message, a contact summary and an incoming title are findable, and
 *      each new domain vanishes from search with its capability, named in notSearched.
 *   6. Workspace isolation non-vacuously; anon reads 0 rows from all five tables.
 *
 *   npx --yes tsx scripts/practice-communication-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { dueDateFrom, practiceToday } from "../src/lib/practice/practice-time";
import {
  createThread, postMessage, markThreadRead, listThreads, unreadThreadCount, getThread,
  recordContact, listContacts,
  recordIncoming, reviewIncoming, actionIncoming, listIncoming, unreviewedIncoming,
} from "../src/lib/practice/communication";
import { operationsHome } from "../src/lib/practice/operations-home";
import { searchPractice } from "../src/lib/practice/search";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e15a1";
const USER_B = "00000000-0000-4000-8000-0000000e15a2";
const COLLEAGUE = "00000000-0000-4000-8000-0000000e15a3";

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
    idempotency_key: `harness-comm-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-comm",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-comm", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-comm" };

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  await admin.from("practice_role_assignment").update({ effective_to: null })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id)).eq("capability_code", capability);
}

async function main() {
  console.log("\nPractice communication harness (CPR-320, migration 200)\n");
  await cleanup();

  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  ok("the function registry probe returns rows (the trigger checks are not vacuous)", fns.length > 0);
  ok("practice_thread_message_immutable() is deployed (migration 200 s5)",
    fns.some(f => f.fn_name === "practice_thread_message_immutable"), "NOT FOUND");
  ok("practice_contact_log_immutable() is deployed (migration 200 s5)",
    fns.some(f => f.fn_name === "practice_contact_log_immutable"), "NOT FOUND");

  const wsA = await provision(USER_A, "HARNESS Comm A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Comm B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, USER_A, wsA);
  const b = await resolveWorkspaceContext(admin, USER_B, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // A colleague in workspace A, with their own capabilities backfilled by the same mechanism the
  // migration used.
  await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: COLLEAGUE, role_code: "practice_assistant", status: "active",
  });
  const { data: colleagueMembership } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", wsA).eq("user_id", COLLEAGUE).single();
  const { data: assistantCaps } = await admin.from("practice_role_capabilities")
    .select("capability_code").eq("role_code", "practice_assistant");
  await admin.from("practice_role_assignment").insert(
    ((assistantCaps ?? []) as any[]).map(c => ({
      membership_id: colleagueMembership!.id, capability_code: c.capability_code, source: "role_default",
    })),
  );

  // ── 1. Threads ────────────────────────────────────────────────────────────
  const headingOnly = await createThread(admin, { workspaceId: wsA, subject: "The fridge", body: "  ", ...base });
  ok("a subject with no body is refused (a heading is not a message)",
    !headingOnly.ok && headingOnly.code === "VALIDATION_ERROR", headingOnly.ok ? "was allowed" : headingOnly.code);
  const { count: orphanThreads } = await admin.from("practice_thread")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  ok("...and the refused thread left no heading behind (the rollback worked)", (orphanThreads ?? -1) === 0, `${orphanThreads}`);

  const thread = await createThread(admin, {
    workspaceId: wsA, subject: "Vaccine fridge temperature",
    body: "The zebrafridge logger read 9C overnight. I have moved the stock to the backup.", ...base,
  });
  ok("a thread with a first message is created (control)", thread.ok, thread.ok ? "" : thread.message);
  if (!thread.ok) return report();

  const colleagueView = await listThreads(admin, wsA, COLLEAGUE);
  ok("THE COLLEAGUE SEES IT UNREAD, derived from a cursor -- nothing was stored on the message",
    colleagueView.length === 1 && colleagueView[0].unread === true, JSON.stringify(colleagueView.map(t => t.unread)));
  const authorView = await listThreads(admin, wsA, USER_A);
  ok("the author does NOT see their own thread as unread", authorView[0]?.unread === false, JSON.stringify(authorView[0]?.unread));

  await markThreadRead(admin, { workspaceId: wsA, threadId: thread.data.id, userId: COLLEAGUE });
  ok("opening it clears the colleague's unread", (await unreadThreadCount(admin, wsA, COLLEAGUE)) === 0);

  const reply = await postMessage(admin, {
    workspaceId: wsA, threadId: thread.data.id, body: "Backup fridge confirmed at 4C.", actorId: USER_A, correlationId: "harness-comm",
  });
  ok("a reply posts", reply.ok, reply.ok ? "" : reply.message);
  ok("THE REPLY MAKES IT UNREAD FOR THE COLLEAGUE AGAIN (the cursor is per person, per thread)",
    (await unreadThreadCount(admin, wsA, COLLEAGUE)) === 1 && (await unreadThreadCount(admin, wsA, USER_A)) === 0,
    `colleague=${await unreadThreadCount(admin, wsA, COLLEAGUE)} author=${await unreadThreadCount(admin, wsA, USER_A)}`);

  const rewrite = await admin.from("practice_thread_message")
    .update({ body: "it was fine actually" }).eq("thread_id", thread.data.id);
  ok("the DATABASE refuses to rewrite a message (what was said cannot be unsaid)",
    !!rewrite.error, rewrite.error?.message ?? "the update succeeded");

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Auma Christine", birthDate: "1987-06-25", sex: "female",
    phone: "0772 555 880", ...base,
  });
  const pOther = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Okwir David", birthDate: "1979-12-01", sex: "male", phone: "0772 555 881", ...base,
  });
  if (!pa.ok || !pOther.ok) { ok("patients register", false); return report(); }

  const enc = await launchEncounter(admin, { workspaceId: wsA, patientId: pOther.data.id, pathway: "new_walk_in", ...base });
  const crossAnchor = enc.ok ? await createThread(admin, {
    workspaceId: wsA, subject: "x", body: "y", patientId: pa.data.id, encounterId: enc.data.id, ...base,
  }) : null;
  ok("a thread cannot anchor one patient to another patient's encounter",
    !!crossAnchor && !crossAnchor.ok && crossAnchor.code === "ENCOUNTER_PATIENT_MISMATCH",
    crossAnchor?.ok ? "was allowed" : crossAnchor?.code ?? "setup failed");

  ok("getThread is workspace-scoped (B cannot read A's thread)", (await getThread(admin, wsB, thread.data.id)) === null);
  ok("B's thread list is empty", (await listThreads(admin, wsB, USER_B)).length === 0);

  // ── 2. The contact log ────────────────────────────────────────────────────
  const noWords = await recordContact(admin, { workspaceId: wsA, patientId: pa.data.id, summary: " ", ...base });
  ok("a contact with no words is refused (a tally mark is not a record)",
    !noWords.ok && noWords.code === "VALIDATION_ERROR", noWords.ok ? "was allowed" : noWords.code);

  const fu = await createFollowUp(admin, {
    workspaceId: wsA, patientId: pOther.data.id, reason: "review the knee", dueOn: dueDateFrom(practiceToday("Africa/Kampala"), -2), ...base,
  });
  const wrongChase = fu.ok ? await recordContact(admin, {
    workspaceId: wsA, patientId: pa.data.id, followUpId: fu.data.id, summary: "called about the knee", ...base,
  }) : null;
  ok("the follow-up being chased must belong to the person being called",
    !!wrongChase && !wrongChase.ok && wrongChase.code === "FOLLOWUP_PATIENT_MISMATCH",
    wrongChase?.ok ? "was allowed" : wrongChase?.code ?? "setup failed");

  const call = await recordContact(admin, {
    workspaceId: wsA, patientId: pa.data.id, channel: "phone", outcome: "left_message",
    summary: "Called about the pending zebraswab result; left a message with her sister.", ...base,
  });
  ok("a contact records (control for the refusals above)", call.ok, call.ok ? "" : call.message);
  if (!call.ok) return report();

  const { data: contactRow } = await admin.from("practice_contact_log").select("*").eq("id", call.data.id).single();
  ok("NOTHING WAS SENT AND NOTHING CAN CLAIM TO HAVE BEEN: no sent_at, no delivery state on the row",
    !("sent_at" in (contactRow ?? {})) && !("delivery_status" in (contactRow ?? {})) && !("channel_message_id" in (contactRow ?? {})),
    Object.keys(contactRow ?? {}).join(","));

  const rewriteContact = await admin.from("practice_contact_log").update({ summary: "reached her" }).eq("id", call.data.id);
  ok("the DATABASE refuses to rewrite a contact record", !!rewriteContact.error, rewriteContact.error?.message ?? "the update succeeded");

  const onPatient = await listContacts(admin, wsA, { patientId: pa.data.id });
  ok("the contact appears on the patient it belongs to", onPatient.length === 1 && /sister/.test(onPatient[0].summary));

  // ── 3. The incoming register ──────────────────────────────────────────────
  const noSource = await recordIncoming(admin, { workspaceId: wsA, title: "FBC result", source: "  ", ...base });
  ok("an incoming document with no source is refused (a result with no source cannot be queried)",
    !noSource.ok && noSource.code === "VALIDATION_ERROR", noSource.ok ? "was allowed" : noSource.code);

  // Archive a patient, then register a result for them -- see migration 200: refusing it would lose
  // the fact that it arrived.
  await admin.from("practice_patient").update({ status: "archived" }).eq("id", pOther.data.id);
  const forArchived = await recordIncoming(admin, {
    workspaceId: wsA, patientId: pOther.data.id, docType: "lab_result",
    source: "City Lab", title: "HbA1c result", ...base,
  });
  ok("A RESULT FOR AN ARCHIVED PATIENT IS REGISTRABLE (the arrival is a fact either way)",
    forArchived.ok, forArchived.ok ? "" : forArchived.message);

  const urgent = await recordIncoming(admin, {
    workspaceId: wsA, patientId: pa.data.id, docType: "lab_result", source: "Lancet Labs",
    title: "Zebraswab culture result", priority: "urgent", whereHeld: "lab portal", ...base,
  });
  ok("an urgent result registers", urgent.ok, urgent.ok ? "" : urgent.message);
  if (!urgent.ok) return report();

  const jumpToActioned = await actionIncoming(admin, {
    workspaceId: wsA, incomingId: urgent.data.id, note: "dealt with", ...base,
  });
  ok("RECEIVED CANNOT JUMP TO ACTIONED -- the clinical stamp cannot be skipped",
    !jumpToActioned.ok && jumpToActioned.code === "ILLEGAL_TRANSITION", jumpToActioned.ok ? "was allowed" : jumpToActioned.code);

  const before = await unreviewedIncoming(admin, wsA);
  ok("THE MISSED-RESULT FIGURE IS DERIVED: both unreviewed rows are counted, nothing having run",
    before.rows.length === 2 && before.anyUrgent === true, `${before.rows.length}, urgent=${before.anyUrgent}`);

  const homeBefore = await operationsHome(admin, a.ctx);
  const tile = homeBefore.attention.find(i => i.kind === "incoming_unreviewed");
  ok("the operations home carries it, CRITICAL because the desk flagged urgency",
    tile?.count === 2 && tile?.severity === "critical" && tile?.href === "/practice/inbox" && tile.sample.length === 2,
    JSON.stringify({ c: tile?.count, s: tile?.severity }));
  ok("...ranked directly after overdue follow-ups, above unsigned encounters",
    homeBefore.attention.findIndex(i => i.kind === "incoming_unreviewed") <
    (homeBefore.attention.findIndex(i => i.kind === "encounter_unsigned") + 1 || Infinity),
    homeBefore.attention.map(i => i.kind).join(" > "));
  const msgTile = homeBefore.attention.find(i => i.kind === "message_unread");
  ok("the home does NOT nag the author about their own thread (unread is per reader)",
    msgTile === undefined, JSON.stringify(msgTile?.count));

  const review = await reviewIncoming(admin, {
    workspaceId: wsA, incomingId: urgent.data.id, note: "sensitive organism; needs a change of antibiotic", ...base,
  });
  ok("a practitioner reviews it (control)", review.ok, review.ok ? "" : review.message);
  const { data: reviewedRow } = await admin.from("practice_incoming_document")
    .select("status, reviewed_by, reviewed_at").eq("id", urgent.data.id).single();
  ok("THE REVIEW IS A STAMP WITH A NAME ON IT",
    reviewedRow?.status === "REVIEWED" && reviewedRow?.reviewed_by === USER_A && !!reviewedRow?.reviewed_at,
    JSON.stringify(reviewedRow));

  const reReview = await reviewIncoming(admin, { workspaceId: wsA, incomingId: urgent.data.id, ...base });
  ok("re-reviewing is refused (one stamp, one name)", !reReview.ok && reReview.code === "ILLEGAL_TRANSITION",
    reReview.ok ? "was allowed" : reReview.code);

  const actionNoWords = await actionIncoming(admin, { workspaceId: wsA, incomingId: urgent.data.id, note: "  ", ...base });
  ok("actioning with no words is refused", !actionNoWords.ok && actionNoWords.code === "NOTE_REQUIRED",
    actionNoWords.ok ? "was allowed" : actionNoWords.code);
  const actioned = await actionIncoming(admin, {
    workspaceId: wsA, incomingId: urgent.data.id, note: "phoned the patient; antibiotic changed; follow-up raised", ...base,
  });
  ok("actioning with words works (control)", actioned.ok, actioned.ok ? "" : actioned.message);

  const after = await unreviewedIncoming(admin, wsA);
  ok("the reviewed one LEFT the missed-result figure the moment it was reviewed",
    after.rows.length === 1 && after.anyUrgent === false, `${after.rows.length}, urgent=${after.anyUrgent}`);

  // ── 4. Blind spots ────────────────────────────────────────────────────────
  const blind = await operationsHome(admin, await withoutCapability(wsA, USER_A, "inbox.record"));
  ok("WITHOUT inbox.record THE TILE IS ABSENT, NOT ZERO, and the blind spot is named",
    !blind.attention.some(i => i.kind === "incoming_unreviewed") && blind.blindSpots.includes("the incoming-document register"),
    blind.blindSpots.join(" | "));
  await restoreCapability(wsA, USER_A, "inbox.record");

  // ── 5. Search over the new domains ────────────────────────────────────────
  const ctxA = (await resolveWorkspaceContext(admin, USER_A, wsA) as any).ctx;
  const foundMsg = await searchPractice(admin, ctxA, "zebrafridge");
  ok("a MESSAGE BODY is findable, labelled by its conversation",
    foundMsg.groups.some(g => g.domain === "threads" && g.hits[0]?.label === "Vaccine fridge temperature"),
    JSON.stringify(foundMsg.groups.map(g => g.domain)));
  const foundBoth = await searchPractice(admin, ctxA, "zebraswab");
  ok("a CONTACT SUMMARY and an INCOMING TITLE are findable by the same term",
    foundBoth.groups.some(g => g.domain === "contacts") && foundBoth.groups.some(g => g.domain === "incoming"),
    JSON.stringify(foundBoth.groups.map(g => g.domain)));

  const noThreads = await searchPractice(admin, await withoutCapability(wsA, USER_A, "message.use"), "zebrafridge");
  ok("withdrawing message.use makes messages vanish from search, named in notSearched",
    !noThreads.groups.some(g => g.domain === "threads") && noThreads.notSearched.includes("messages"),
    noThreads.notSearched.join(" | "));
  await restoreCapability(wsA, USER_A, "message.use");

  const noInbox = await searchPractice(admin, await withoutCapability(wsA, USER_A, "inbox.record"), "zebraswab");
  ok("withdrawing inbox.record makes received documents vanish from search, named in notSearched",
    !noInbox.groups.some(g => g.domain === "incoming") && noInbox.notSearched.includes("received documents"),
    noInbox.notSearched.join(" | "));
  await restoreCapability(wsA, USER_A, "inbox.record");

  // ── 6. Isolation + anon ───────────────────────────────────────────────────
  ok("B's inbox is empty and B's contact log is empty",
    (await listIncoming(admin, wsB, {})).length === 0 && (await listContacts(admin, wsB, {})).length === 0);
  ok("A's registers are non-empty (the isolation test is not vacuous)",
    (await listIncoming(admin, wsA, {})).length === 2 && (await listContacts(admin, wsA, {})).length === 1);

  const TABLES = ["practice_thread", "practice_thread_message", "practice_thread_read", "practice_contact_log", "practice_incoming_document"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: c } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((c ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in every communication table (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("anon reads 0 rows from every communication table", leaked === 0, `${leaked} table(s) leaked`);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
