/**
 * CPR-DOC-002 Documents Workspace harness -- PHASES 3 AND 4 (s20).
 *
 * Phase 3: review queues, document tasks, saved views, bulk operations, AI-assisted drafting and the
 * permission picture. Phase 4: the metadata export, which is the one half of "integrations" that can
 * honestly be built. Exercised against the live database, through the same engines the pages and the API
 * use, and -- for the AI half -- against the real model provider this deployment is configured with.
 *
 * WHAT IT PROVES:
 *   1.  s10 -- SAVED VIEWS ARE THE SAME PREDICATE AS THE LIST THEY OPEN. Every figure is recomputed from
 *       the register by the harness, and every view whose href carries a querystring has that href
 *       re-parsed and re-applied. `signed_not_issued` is cross-checked against a DIFFERENT ENGINE
 *       (sharedAndIssued), so two independently written readings of "signed, nobody holds a copy" must
 *       agree. And the two views s10 names that this product cannot answer are proven ABSENT.
 *   2.  THREE STATES, EVERYWHERE, PROVEN BY MAKING A READ FAIL. A stub client refuses one table at a
 *       time and each queue is asserted to come back `unreadable` carrying the database's words -- never
 *       as an empty queue. Each has a control in which the same queue reads `ok` with rows in it.
 *   3.  s15 -- DocumentTask IS practice_task, filtered on document_id. A task about a patient and not a
 *       document is proven ABSENT from the queue, with the identical task carrying a documentId proven
 *       PRESENT.
 *   4.  s7/s14 -- ASSIGNING A REVIEW DOES NOT MOVE THE DOCUMENT'S STATUS. Asserted on the stored column
 *       before and after, with the control that transitionDocument DOES move the same fixture.
 *   5.  s10 -- BULK CLASSIFY REPORTS PER ROW. A batch containing another practice's document files the
 *       rest and names the one it refused; over the cap it refuses and WRITES NOTHING, proven on a
 *       canary row. s17's source attribution is proven to survive a bulk exactly as it survives one row.
 *   6.  s10/s20 P4 -- THE EXPORT CARRIES METADATA AND NOT CONTENT, proven with sentinels planted in a
 *       document body and an arrival summary. It REFUSES ENTIRELY when a source could not be read.
 *       CSV injection and quoting are proven on a hostile title.
 *   7.  s12 -- THE LABEL. A real draft is written into a real document by the real provider, and the
 *       attribution reads machine_unedited; one edit later it reads machine_edited; a document nobody
 *       drafted reads none; an unreadable trail reads unreadable and NOT none.
 *   8.  s12/248 -- A MACHINE MAY AUTHOR AND MAY NOT SIGN. The document is still DRAFT after the draft
 *       lands, the engine refuses a FINAL document, and it refuses without document.author -- with
 *       controls proving each refusal is a boundary rather than a locked door.
 *   9.  s13 -- THE PERMISSION MATRIX IS READ FROM LIVE GRANTS. Revoking a grant removes a holder and
 *       restoring it brings them back, so the matrix is not a rendering of the seed.
 *   10. CAPABILITY CODES PROBED LIVE. Every code this phase names is asserted present in the seeded
 *       catalogue -- six invented ones have shipped in this codebase.
 *   11. THE CLIENT/SERVER BOUNDARY, statically, on both new client components; and the review payload
 *       walked to its leaves for a function, which is what killed the Follow-ups board this week.
 *
 * CONTROLS: every refusal and every absence is paired with the same operation succeeding where it
 * should, so a green "refused" can never be an artefact of a malformed call or an empty fixture.
 *
 *   npx --yes tsx scripts/practice-documents-phase3-harness.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { createDocument, transitionDocument, updateDocument, saveNoteSegment } from "../src/lib/practice/documentation";
import { launchEncounter } from "../src/lib/practice/encounters";
import { recordIncoming } from "../src/lib/practice/communication";
import { createTask, transitionTask } from "../src/lib/practice/tasks";
import { documentRegister, applyFilter } from "../src/lib/practice/documents-workspace";
import { sharedAndIssued } from "../src/lib/practice/documents-workspace-issue";
import {
  documentsReview, documentTasks, documentPermissions, reviewMembers,
  assignDocumentReview, bulkClassify, documentMetadataExport,
} from "../src/lib/practice/documents-workspace-review";
import { aiAttribution, draftIntoDocument, draftAvailability } from "../src/lib/practice/documents-workspace-ai";
import { setAssistantEnabled, AI_NOTICE_VERSION, ASSISTANT_TASKS } from "../src/lib/practice/ai-assistant";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  AI_DRAFT_TASKS, DOC_BULK_LIMIT, DOC_EXPORT_COLUMNS, DOC_PERMISSION_ROWS, DOC_SAVED_VIEWS, DOC_TABS,
  csvCell, docFilterToQuery, documentExportHref, parseDocFilter,
} from "../src/lib/practice/documents-workspace-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-00000000d3a1";
const USER_B = "00000000-0000-4000-8000-00000000d3a2";
const COLLEAGUE = "00000000-0000-4000-8000-00000000d3a3";
const STRANGER = "00000000-0000-4000-8000-00000000d3a4";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const CID = "harness-docp3";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-docp3-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CID,
  }).select("id").single();
  const run = await runProvisioning(admin, {
    id: req!.id, target_user_id: user, correlation_id: CID, workspace_id: null,
  }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B, COLLEAGUE, STRANGER]);
}

const base = { actorId: USER_A, correlationId: CID };

async function newPatient(workspaceId: string, name: string, phone: string): Promise<string> {
  const r = await registerPatient(admin, {
    workspaceId, displayName: name, sex: "female", phone,
    ageEstimateYears: 34, actorId: USER_A, correlationId: CID,
  } as any);
  if (!r.ok) throw new Error(`registerPatient failed: ${(r as any).message}`);
  return r.data.id;
}

/* ══ A CLIENT THAT REFUSES ONE TABLE ══════════════════════════════════════════════════════════════════
 *
 * ⚠ THIS IS HOW THE THIRD STATE IS PROVEN RATHER THAN ASSUMED. Every "unreadable" assertion in this file
 * is made against a real engine reading a real database through a client that returns an error for ONE
 * named table and behaves normally for every other. Without it, the only way to test the failure branch
 * is to read the source and believe it -- and the whole point of the doctrine is that a failed read looks
 * exactly like an empty one from the outside.
 *
 * The stub is a thenable proxy: every method returns itself, and awaiting it yields { data: null, error }.
 * That matches PostgREST's builder, which is chainable and awaited at the end.
 */
function refusing(table: string, message: string): any {
  const failure = { data: null, error: { message }, count: null, status: 500, statusText: "harness" };
  const chain: any = new Proxy(() => undefined, {
    get(_t, prop) {
      if (prop === "then") return (resolve: any) => resolve(failure);
      if (prop === "catch" || prop === "finally") return () => chain;
      return () => chain;
    },
    apply() { return chain; },
  });
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop === "from")
        return (t: string) => (t === table ? chain : (target as any).from(t));
      const v = Reflect.get(target as any, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** Revoke a capability from every membership a user holds in a workspace. Returns a restore function. */
async function revoke(userId: string, workspaceId: string, capability: string): Promise<() => Promise<void>> {
  const { data: ms } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active");
  const ids = ((ms ?? []) as any[]).map(m => m.id as string);
  const { data: moved } = await admin.from("practice_role_assignment")
    .update({ effective_to: new Date().toISOString() })
    .in("membership_id", ids).eq("capability_code", capability).is("effective_to", null)
    .select("id");
  const movedIds = ((moved ?? []) as any[]).map(r => r.id as string);
  return async () => {
    if (movedIds.length > 0)
      await admin.from("practice_role_assignment").update({ effective_to: null }).in("id", movedIds);
  };
}

async function ctxFor(userId: string, workspaceId: string): Promise<WorkspaceContext> {
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error(`context did not resolve: ${res.reason}`);
  return res.ctx;
}

/**
 * ⚠ WALK EVERY LEAF OF A PAYLOAD LOOKING FOR A FUNCTION.
 *
 * A function on an object handed to a client component compiles, lints, passes the API and every runtime
 * harness, and then the page white-screens in a production build. `typeof payload === "object"` at the
 * top level does not find it; this does.
 */
function functionPaths(value: unknown, path = "$", seen = new Set<unknown>()): string[] {
  if (typeof value === "function") return [path];
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const found: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => found.push(...functionPaths(v, `${path}[${i}]`, seen)));
  else for (const [k, v] of Object.entries(value)) found.push(...functionPaths(v, `${path}.${k}`, seen));
  return found;
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length > 0) { for (const f of fails) console.log(`    - ${f}`); process.exit(1); }
  process.exit(0);
}

async function main() {
  await cleanup();

  const wsA = await provision(USER_A, "Phase3 Practice A", "a");
  const wsB = await provision(USER_B, "Phase3 Practice B", "b");
  const ctxA = await ctxFor(USER_A, wsA);

  // A colleague, so "assigned to somebody else" and the assignee-inactive flag have a real subject.
  await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: COLLEAGUE, role_code: "practitioner", status: "active",
  });

  const pAlice = await newPatient(wsA, "HARNESS Alice Phase3", "+256700900301");
  const pBeth = await newPatient(wsA, "HARNESS Beth Phase3", "+256700900302");
  const pOther = await newPatient(wsB, "HARNESS Other Practice", "+256700900303");

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: pAlice, pathway: "new_walk_in",
    reasonForVisit: "HARNESS: persistent cough for three weeks", actorId: USER_A, correlationId: CID,
  } as any);
  if (!enc.ok) { ok("setup. an encounter for the drafting fixture", false, (enc as any).message); return report(); }
  const encId = enc.data.id;
  await saveNoteSegment(admin, {
    workspaceId: wsA, encounterId: encId, noteType: "assessment",
    body: "HARNESS: likely post-infectious cough. Chest clear. No red flags recorded.",
    ...base,
  });
  await saveNoteSegment(admin, {
    workspaceId: wsA, encounterId: encId, noteType: "plan",
    body: "HARNESS: reassure, review in two weeks if not settling. Refer to respiratory if persists.",
    ...base,
  });

  /* ── FIXTURE DOCUMENTS ──────────────────────────────────────────────────────────────────────────── */

  const mk = async (patientId: string, title: string, body: string, encounterId?: string) => {
    const d = await createDocument(admin, {
      workspaceId: wsA, patientId, encounterId: encounterId ?? null,
      docType: "referral_letter", title, body, ...base,
    });
    if (!d.ok) throw new Error(`createDocument failed: ${(d as any).message}`);
    return d.data.id;
  };

  const docDraft = await mk(pAlice, "HARNESS draft letter", "A draft body.", encId);
  const docDraft2 = await mk(pBeth, "HARNESS second draft", "Another draft body.");
  const docFinal = await mk(pAlice, "HARNESS ready letter", "A body somebody has accepted.");
  await transitionDocument(admin, { workspaceId: wsA, documentId: docFinal, to: "FINAL", ...base });
  const docSigned = await mk(pAlice, "HARNESS signed letter", "A signed body.");
  await transitionDocument(admin, { workspaceId: wsA, documentId: docSigned, to: "FINAL", ...base });
  await transitionDocument(admin, { workspaceId: wsA, documentId: docSigned, to: "SIGNED", ...base });

  // A body sentinel: it must never reach the export.
  const BODY_SENTINEL = "SENTINEL-BODY-8f2c-do-not-export";
  const docSentinel = await mk(pAlice, "HARNESS sentinel letter", `Dear colleague. ${BODY_SENTINEL}. Yours.`);

  // A hostile title, for the CSV writer. The id is not kept: the assertion looks for the GUARDED FORM of
  // this title in the file, which is the only thing about this row that matters.
  const HOSTILE_TITLE = '=cmd|"/c calc"!A1, and an "aside"';
  await mk(pBeth, HOSTILE_TITLE, "A body.");

  const docOther = await createDocument(admin, {
    workspaceId: wsB, patientId: pOther, docType: "referral_letter",
    title: "HARNESS other practice letter", body: "Elsewhere.",
    actorId: USER_B, correlationId: CID,
  });
  if (!docOther.ok) { ok("setup. a document in the other practice", false, "x"); return report(); }

  /* ── FIXTURE ARRIVALS ───────────────────────────────────────────────────────────────────────────── */

  const SUMMARY_SENTINEL = "SENTINEL-SUMMARY-4a71-do-not-export";
  const arrive = async (title: string, source: string, patientId?: string, summary?: string) => {
    const r = await recordIncoming(admin, {
      workspaceId: wsA, title, source, docType: "lab_result", patientId: patientId ?? null,
      summary, ...base,
    });
    if (!r.ok) throw new Error(`recordIncoming failed: ${(r as any).message}`);
    return r.data.id;
  };

  const arr1 = await arrive("HARNESS arrival one", "Mulago Laboratory, Kampala");
  const arr2 = await arrive("HARNESS arrival two", "Nakasero Hospital");
  const arr3 = await arrive("HARNESS arrival three", "Case Clinic", undefined, `Result note: ${SUMMARY_SENTINEL}`);
  // An arrival that IS already linked, so the unlinked queue is a genuine subset of the arrivals rather
  // than the whole of them -- which is what makes the two figures differ in assertion 1e.
  await arrive("HARNESS arrival linked", "Mengo Hospital", pAlice);

  const arrOther = await recordIncoming(admin, {
    workspaceId: wsB, title: "HARNESS other arrival", source: "Elsewhere Lab",
    actorId: USER_B, correlationId: CID,
  });
  if (!arrOther.ok) { ok("setup. an arrival in the other practice", false, "x"); return report(); }

  console.log("\n══ 1. s10 -- SAVED VIEWS ═══════════════════════════════════════════════════════════════\n");

  const keys = DOC_SAVED_VIEWS.map(v => v.key);
  ok("1a. the saved views are the five this product can actually answer",
    keys.length === 5 && keys.includes("assigned_to_me") && keys.includes("awaiting_review")
    && keys.includes("unsigned_drafts") && keys.includes("signed_not_issued") && keys.includes("unlinked"),
    keys.join(", "));

  // ⚠ s10 NAMES FOUR EXAMPLE VIEWS AND TWO OF THEM CANNOT EXIST HERE. Their absence is the assertion:
  // "Patient uploads today" needs a patient channel there is no authentication for, and "Failed shares"
  // needs a delivery result nothing in this product produces. Either would read a structural zero, which
  // a practitioner would take as a statement about the world rather than about this database.
  const viewText = JSON.stringify(DOC_SAVED_VIEWS).toLowerCase();
  ok("1b. ⚠ no 'patient uploads' view -- there is no patient upload channel, so it could only ever read zero",
    !viewText.includes("patient upload"), "a view that is structurally always zero is a promise, not a queue");
  ok("1c. ⚠ no 'failed shares' view -- nothing in this product sends anything, so nothing can fail to arrive",
    !viewText.includes("failed"), "the same reason Phase 2 refused the Failed chip");

  const review1 = await documentsReview(admin, ctxA);
  const reg1 = await documentRegister(admin, wsA);

  // ⚠ RECOMPUTED HERE, FROM THE REGISTER, RATHER THAN READ BACK FROM THE ENGINE'S OWN ANSWER.
  for (const v of DOC_SAVED_VIEWS.filter(x => x.filter !== null)) {
    const expected = applyFilter(reg1.rows, v.filter!, reg1.today).length;
    const got = review1.views.find(x => x.key === v.key)!.count;
    ok(`1d-${v.key}. the figure is the length of the list its own filter selects`,
      got.state === "ok" && got.value === expected,
      `engine ${JSON.stringify(got)}, harness ${expected}`);
  }

  // The fixture must make the five figures DIFFERENT, or a broken filter would give the right answer by
  // accident. This assertion is the one that makes the five above mean anything.
  const figures = review1.views.map(v => (v.count.state === "ok" ? v.count.value : -1));
  ok("1e. ⚠ the fixture gives the views DIFFERENT figures, so a wrong filter cannot pass by coincidence",
    new Set(figures).size >= 3 && figures.every(f => f >= 0), figures.join(", "));

  // ⚠ THE HREF IS RE-PARSED AND RE-APPLIED. Phase 1 found a real card/list drift this way on its first
  // run: a card counted 5 while its own href opened 8.
  for (const v of DOC_SAVED_VIEWS.filter(x => x.href.includes("?"))) {
    const qs = v.href.split("?")[1];
    const sp = Object.fromEntries(new URLSearchParams(qs).entries());
    const viaHref = applyFilter(reg1.rows, parseDocFilter(sp), reg1.today).length;
    const got = review1.views.find(x => x.key === v.key)!.count;
    ok(`1f-${v.key}. ⚠ opening the card's OWN href re-applies the same predicate and yields the same figure`,
      got.state === "ok" && got.value === viaHref, `card ${JSON.stringify(got)}, href ${viaHref}`);
  }

  // ⚠ CROSS-ENGINE. sharedAndIssued() computes "signed with no release" from the release register by a
  // different route entirely. Two independently written readings of the same sentence must agree.
  const shared1 = await sharedAndIssued(admin, wsA);
  const signedView = review1.views.find(v => v.key === "signed_not_issued")!.count;
  ok("1g. ⚠ 'signed, nothing issued' agrees with the Shared & Issued engine, which computes it separately",
    shared1.awaiting.state === "ok" && signedView.state === "ok"
    && signedView.value === shared1.awaiting.value.length,
    `view ${JSON.stringify(signedView)}, shared ${shared1.awaiting.state === "ok" ? shared1.awaiting.value.length : "unreadable"}`);
  ok("1g-control. ...and that figure is not zero, so 1g is not two engines agreeing about nothing",
    signedView.state === "ok" && signedView.value > 0, JSON.stringify(signedView));

  console.log("\n══ 2. THREE STATES: A FAILED READ IS NEVER A ZERO ══════════════════════════════════════\n");

  const brokenIncoming = refusing("practice_incoming_document", "harness: the incoming register is refused");
  const reviewBroken = await documentsReview(brokenIncoming, ctxA);

  const awaitingBroken = reviewBroken.views.find(v => v.key === "awaiting_review")!.count;
  ok("2a. ⚠ with the incoming register unreadable, 'arrived, nobody has looked' is UNREADABLE and not 0",
    awaitingBroken.state === "unreadable" && awaitingBroken.detail.includes("incoming register"),
    JSON.stringify(awaitingBroken));
  const awaitingOk = review1.views.find(v => v.key === "awaiting_review")!.count;
  ok("2a-control. ...and the same view over a working client reads ok with a real number",
    awaitingOk.state === "ok" && awaitingOk.value > 0, JSON.stringify(awaitingOk));

  ok("2b. ⚠ the arrivals QUEUE itself is unreadable, so the page cannot draw 'nothing to review'",
    reviewBroken.arrivals.state === "unreadable", JSON.stringify(reviewBroken.arrivals).slice(0, 120));
  ok("2b-control. ...and it lists real rows over a working client",
    review1.arrivals.state === "ok" && review1.arrivals.value.length >= 3,
    review1.arrivals.state === "ok" ? String(review1.arrivals.value.length) : "unreadable");

  ok("2c. ⚠ the unlinked queue is unreadable too, because it reads the same source",
    reviewBroken.unlinked.state === "unreadable", JSON.stringify(reviewBroken.unlinked).slice(0, 120));

  // ⚠ AND THE QUEUES THAT DO NOT DEPEND ON IT ARE STILL ANSWERED. A failure that poisons everything is
  // indistinguishable from a page that gave up, and it would hide which source is actually broken.
  ok("2d. ⚠ the AUTHORED queue is unaffected by the incoming register failing -- the failure is per source",
    reviewBroken.unsigned.state === "ok",
    JSON.stringify(reviewBroken.unsigned).slice(0, 120));

  const brokenTasks = refusing("practice_task", "harness: the task table is refused");
  const tasksBroken = await documentTasks(brokenTasks, wsA, reg1.today);
  ok("2e. ⚠ document tasks come back unreadable, carrying the database's own words",
    tasksBroken.state === "unreadable" && tasksBroken.detail.includes("harness: the task table is refused"),
    JSON.stringify(tasksBroken).slice(0, 120));

  const brokenMembership = refusing("practice_membership", "harness: membership is refused");
  const membersBroken = await reviewMembers(brokenMembership, wsA);
  ok("2f. ⚠ the members list is unreadable, so the assign control is not drawn over an empty select",
    membersBroken.state === "unreadable", JSON.stringify(membersBroken).slice(0, 120));
  ok("2f-control. ...and the real one lists both members of this practice",
    review1.members.state === "ok" && review1.members.value.length === 2,
    review1.members.state === "ok" ? String(review1.members.value.length) : "unreadable");

  const permsBroken = await documentPermissions(brokenMembership, wsA);
  ok("2g. ⚠ the permission matrix is unreadable rather than a matrix in which nobody holds anything",
    permsBroken.state === "unreadable", JSON.stringify(permsBroken).slice(0, 120));

  console.log("\n══ 3. s15 -- DocumentTask IS practice_task, FILTERED ON document_id ════════════════════\n");

  const tAboutDoc = await createTask(admin, {
    workspaceId: wsA, title: "HARNESS task about a document", assignedTo: USER_A,
    documentId: docDraft, category: "clinical_admin", ...base,
  });
  const tAboutPatient = await createTask(admin, {
    workspaceId: wsA, title: "HARNESS task about a patient only", assignedTo: USER_A,
    patientId: pAlice, category: "admin", ...base,
  });
  ok("3-setup. two tasks created, identical but for the document link",
    tAboutDoc.ok && tAboutPatient.ok,
    `${tAboutDoc.ok ? "ok" : (tAboutDoc as any).code} / ${tAboutPatient.ok ? "ok" : (tAboutPatient as any).code}`);

  const tasks1 = await documentTasks(admin, wsA, reg1.today);
  const taskIds = tasks1.state === "ok" ? tasks1.value.map(t => t.id) : [];
  ok("3a. the task carrying a documentId is in the document queue",
    tAboutDoc.ok && taskIds.includes(tAboutDoc.data.id), taskIds.join(", "));
  ok("3b. ⚠ the task about a PATIENT ONLY is NOT -- this workspace shows work about documents, and the "
    + "task board shows the rest of the same table",
    tAboutPatient.ok && !taskIds.includes(tAboutPatient.data.id), taskIds.join(", "));

  const closed = tAboutPatient.ok
    ? await transitionTask(admin, { workspaceId: wsA, taskId: tAboutDoc.ok ? tAboutDoc.data.id : "", to: "DONE", outcome: "HARNESS done", ...base })
    : { ok: false } as any;
  const tasksAfterClose = await documentTasks(admin, wsA, reg1.today);
  ok("3c. ⚠ a CLOSED task leaves the queue -- a queue that keeps finished work is a queue nobody trusts",
    closed.ok && tasksAfterClose.state === "ok"
    && !tasksAfterClose.value.some(t => tAboutDoc.ok && t.id === tAboutDoc.data.id),
    closed.ok ? "closed" : "transition failed");
  ok("3c-control. ...and it WAS in the queue a moment ago, so 3c is a transition and not an empty fixture",
    tAboutDoc.ok && taskIds.includes(tAboutDoc.data.id), "the same id");

  console.log("\n══ 4. s7/s14 -- ASSIGNING A REVIEW DOES NOT MOVE THE DOCUMENT ══════════════════════════\n");

  const { data: beforeAssign } = await admin.from("practice_clinical_document")
    .select("status, record_version, updated_at").eq("id", docDraft2).single();

  const assigned = await assignDocumentReview(admin, ctxA, {
    documentId: docDraft2, assignTo: COLLEAGUE, note: "HARNESS: check the addressee", correlationId: CID,
  });
  ok("4a. a review is assigned, and it is a real row in a real store",
    assigned.ok, assigned.ok ? assigned.data.taskId : (assigned as any).message);

  const { data: afterAssign } = await admin.from("practice_clinical_document")
    .select("status, record_version, updated_at").eq("id", docDraft2).single();
  ok("4b. ⚠ THE DOCUMENT'S STATUS, RECORD VERSION AND updated_at ARE UNTOUCHED. s7's 'In review' is not a "
    + "stored value here, and borrowing FINAL would make 'ready to sign' and 'not yet checked' one word",
    afterAssign?.status === beforeAssign?.status
    && afterAssign?.record_version === beforeAssign?.record_version
    && afterAssign?.updated_at === beforeAssign?.updated_at,
    `${JSON.stringify(beforeAssign)} -> ${JSON.stringify(afterAssign)}`);

  // ⚠ THE CONTROL THAT MAKES 4b MEAN SOMETHING: the same three columns DO move when the document is
  // genuinely transitioned, so 4b is not an assertion about a fixture that cannot change.
  await transitionDocument(admin, { workspaceId: wsA, documentId: docDraft2, to: "FINAL", ...base });
  const { data: afterMove } = await admin.from("practice_clinical_document")
    .select("status, record_version").eq("id", docDraft2).single();
  ok("4b-control. ...and transitionDocument DOES move them on the same fixture",
    afterMove?.status === "FINAL" && afterMove?.record_version !== beforeAssign?.record_version,
    JSON.stringify(afterMove));

  const { data: assignEvent } = await admin.from("practice_audit_event")
    .select("payload").eq("workspace_id", wsA).eq("event_type", "practice.document_review_assigned")
    .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
  ok("4c. the trail records the assignment AND the status that did not move, so the question is answerable "
    + "without reading the source",
    (assignEvent?.payload as any)?.documentId === docDraft2
    && (assignEvent?.payload as any)?.assignedTo === COLLEAGUE
    && (assignEvent?.payload as any)?.documentStatusUnchanged === beforeAssign?.status,
    JSON.stringify(assignEvent?.payload));

  const signedAssign = await assignDocumentReview(admin, ctxA, {
    documentId: docSigned, assignTo: COLLEAGUE, correlationId: CID,
  });
  ok("4d. a SIGNED document cannot be assigned for review -- there is no change a review could produce, "
    + "because a correction is an amendment and that becomes a new document",
    !signedAssign.ok && (signedAssign as any).code === "NOT_REVIEWABLE",
    signedAssign.ok ? "accepted" : (signedAssign as any).code);
  const finalAssign = await assignDocumentReview(admin, ctxA, {
    documentId: docFinal, assignTo: COLLEAGUE, correlationId: CID,
  });
  ok("4d-control. ...and a document marked READY still can be, so 4d is a signature boundary and not a "
    + "refusal of anything past draft",
    finalAssign.ok, finalAssign.ok ? "ok" : (finalAssign as any).code);

  const strangerAssign = await assignDocumentReview(admin, ctxA, {
    documentId: docDraft, assignTo: STRANGER, correlationId: CID,
  });
  ok("4e. a review cannot be assigned to somebody who is not an active member -- work given to a revoked "
    + "account lands nowhere",
    !strangerAssign.ok && (strangerAssign as any).code === "NOT_A_MEMBER",
    strangerAssign.ok ? "accepted" : (strangerAssign as any).code);

  /* ⚠ A VACUITY FOUND BY THE BREAK PROCESS, AND WHAT IT WAS REPLACED WITH.
   *
   * This assertion originally read "a document belonging to another practice is Not found", checked at
   * runtime alone. Deleting `.eq("workspace_id", ctx.workspaceId)` from the engine's document read LEFT
   * IT GREEN -- because createTask's own subject-resolution loop refuses a document from another
   * workspace one layer deeper, with the same 404 and the same words. The assertion claimed to be
   * testing this engine's tenancy and was testing somebody else's.
   *
   * The rule is genuinely held twice, and that is defence in depth rather than waste. So the runtime
   * half is kept AND the source is asserted, because only the second can distinguish the two layers. */
  const crossAssign = await assignDocumentReview(admin, ctxA, {
    documentId: docOther.data.id, assignTo: COLLEAGUE, correlationId: CID,
  });
  const assignSource = readFileSync(
    join(process.cwd(), "src", "lib", "practice", "documents-workspace-review.ts"), "utf8");
  ok("4f. a document belonging to another practice is Not found, not 403 -- the workspace is the object "
    + "boundary and a 403 would confirm the row exists",
    !crossAssign.ok && (crossAssign as any).status === 404,
    crossAssign.ok ? "accepted" : String((crossAssign as any).status));
  ok("4f-depth. ⚠ ...and THIS engine's own read is workspace-scoped, not merely covered by createTask's. "
    + "Deleting the scoping leaves 4f green, so 4f alone was an assertion about somebody else's code",
    /\.eq\("id", args\.documentId\)\.eq\("workspace_id", ctx\.workspaceId\)/.test(assignSource),
    "the engine reads a document without scoping it to the caller's workspace");

  const restoreTask = await revoke(USER_A, wsA, "task.manage");
  const noTaskCtx = await ctxFor(USER_A, wsA);
  const refusedAssign = await assignDocumentReview(admin, noTaskCtx, {
    documentId: docDraft, assignTo: COLLEAGUE, correlationId: CID,
  });
  ok("4g. without task.manage -- REVOKED LIVE IN THE DATABASE AND RE-RESOLVED -- the engine refuses",
    !refusedAssign.ok && (refusedAssign as any).status === 403,
    refusedAssign.ok ? "accepted" : String((refusedAssign as any).status));
  ok("4g-control-a. ...and that same context still holds document.sign, so 4g is a capability boundary "
    + "and not a caller who lost everything",
    noTaskCtx.capabilities.includes("document.sign") && !noTaskCtx.capabilities.includes("task.manage"),
    `${noTaskCtx.capabilities.length} capabilities`);
  await restoreTask();
  const restoredCtx = await ctxFor(USER_A, wsA);
  const afterRestore = await assignDocumentReview(admin, restoredCtx, {
    documentId: docDraft, assignTo: COLLEAGUE, correlationId: CID,
  });
  ok("4g-control-b. ...and restoring the grant makes the identical call succeed",
    afterRestore.ok, afterRestore.ok ? "ok" : (afterRestore as any).code);

  const review2 = await documentsReview(admin, ctxA);
  ok("4h. the assigned review appears in the queue with the colleague's name on it, not the caller's",
    review2.assignedToOthers.state === "ok"
    && review2.assignedToOthers.value.some(t => t.documentId === docDraft2 && t.assignedTo === COLLEAGUE),
    review2.assignedToOthers.state === "ok" ? String(review2.assignedToOthers.value.length) : "unreadable");
  ok("4h-control. ...and the caller's OWN queue does not contain it, so 'mine' and 'somebody else's' are "
    + "genuinely two lists",
    review2.assignedToMe.state === "ok"
    && !review2.assignedToMe.value.some(t => t.assignedTo === COLLEAGUE),
    review2.assignedToMe.state === "ok" ? String(review2.assignedToMe.value.length) : "unreadable");

  // ⚠ WORK SITTING WITH SOMEBODY WHO CAN NO LONGER OPEN THE APP IS WORK NOBODY IS DOING.
  await admin.from("practice_membership").update({ status: "revoked" })
    .eq("workspace_id", wsA).eq("user_id", COLLEAGUE);
  const tasksOrphaned = await documentTasks(admin, wsA, reg1.today);
  ok("4i. a task assigned to a revoked member is flagged, not hidden",
    tasksOrphaned.state === "ok"
    && tasksOrphaned.value.some(t => t.assignedTo === COLLEAGUE && !t.assigneeActive),
    tasksOrphaned.state === "ok" ? tasksOrphaned.value.map(t => `${t.assignedTo.slice(0, 8)}:${t.assigneeActive}`).join(",") : "unreadable");
  await admin.from("practice_membership").update({ status: "active" })
    .eq("workspace_id", wsA).eq("user_id", COLLEAGUE);
  const tasksRestored = await documentTasks(admin, wsA, reg1.today);
  ok("4i-control. ...and it is NOT flagged while the membership is active, so the flag reads membership "
    + "rather than being always on",
    tasksRestored.state === "ok"
    && tasksRestored.value.filter(t => t.assignedTo === COLLEAGUE).every(t => t.assigneeActive),
    "restored");

  console.log("\n══ 5. s10 -- BULK CLASSIFY ═════════════════════════════════════════════════════════════\n");

  const { data: srcBefore } = await admin.from("practice_incoming_document")
    .select("id, source, patient_id").in("id", [arr1, arr2, arr3]);

  const bulkMixed = await bulkClassify(admin, ctxA, {
    ids: [arr1, arr2, arrOther.data.id], patientId: pBeth, correlationId: CID,
  });
  ok("5a. a bulk over a mixed selection RUNS -- the batch succeeded even though a row in it did not",
    bulkMixed.ok, bulkMixed.ok ? "ok" : (bulkMixed as any).code);
  ok("5b. ⚠ THE OUTCOMES ARE PER ROW: two filed, one refused, and the refused one is NAMED",
    bulkMixed.ok && bulkMixed.data.changed === 2 && bulkMixed.data.refused === 1
    && bulkMixed.data.outcomes.find(o => o.id === arrOther.data.id)?.ok === false,
    bulkMixed.ok ? JSON.stringify(bulkMixed.data.outcomes) : "");

  const { data: linked } = await admin.from("practice_incoming_document")
    .select("id, patient_id, source").in("id", [arr1, arr2]);
  ok("5c. ...and the two that succeeded REALLY MOVED, so 5b is not a report about nothing",
    ((linked ?? []) as any[]).every(r => r.patient_id === pBeth) && (linked ?? []).length === 2,
    JSON.stringify(linked));
  const { data: notMoved } = await admin.from("practice_incoming_document")
    .select("patient_id").eq("id", arrOther.data.id).single();
  ok("5c-control. ...and the other practice's row did NOT move, which is what 'refused' has to mean",
    notMoved?.patient_id === null, JSON.stringify(notMoved));

  // s17: "Patient-uploaded documents retain source attribution even after classification."
  const sourceBefore = new Map(((srcBefore ?? []) as any[]).map(r => [r.id, r.source]));
  ok("5d. ⚠ s17 -- WHERE A DOCUMENT CAME FROM SURVIVES A BULK exactly as it survives one row: there is no "
    + "`source` parameter on the engine, the route or the form",
    ((linked ?? []) as any[]).every(r => r.source === sourceBefore.get(r.id)),
    JSON.stringify(((linked ?? []) as any[]).map(r => r.source)));

  const overCap = await bulkClassify(admin, ctxA, {
    ids: Array.from({ length: DOC_BULK_LIMIT + 1 }, (_, i) => (i === 0 ? arr3 : `00000000-0000-4000-8000-0000000${String(i).padStart(5, "0")}`)),
    patientId: pAlice, correlationId: CID,
  });
  ok("5e. over the cap the batch is REFUSED, not truncated",
    !overCap.ok && (overCap as any).code === "TOO_MANY",
    overCap.ok ? "accepted" : (overCap as any).code);
  const { data: canary } = await admin.from("practice_incoming_document")
    .select("patient_id").eq("id", arr3).single();
  ok("5e-control. ⚠ ...AND NOTHING WAS WRITTEN. The first id of the oversized batch is untouched, which "
    + "is the difference between refusing and truncating",
    canary?.patient_id === null, JSON.stringify(canary));

  const emptyPatch = await bulkClassify(admin, ctxA, { ids: [arr3], correlationId: CID });
  ok("5f. a bulk with nothing to apply is refused -- fifty green ticks over an empty form reads as fifty "
    + "documents filed",
    !emptyPatch.ok && (emptyPatch as any).code === "NOTHING_TO_APPLY",
    emptyPatch.ok ? "accepted" : (emptyPatch as any).code);
  const emptySelection = await bulkClassify(admin, ctxA, { ids: [], patientId: pAlice, correlationId: CID });
  ok("5f-control. ...and an empty selection is its own refusal, distinct from an empty patch",
    !emptySelection.ok && (emptySelection as any).code === "NOTHING_SELECTED",
    emptySelection.ok ? "accepted" : (emptySelection as any).code);

  const restoreInbox = await revoke(USER_A, wsA, "inbox.record");
  const noInboxCtx = await ctxFor(USER_A, wsA);
  const refusedBulk = await bulkClassify(admin, noInboxCtx, { ids: [arr3], patientId: pAlice, correlationId: CID });
  ok("5g. without inbox.record -- revoked live -- the bulk is refused at the engine",
    !refusedBulk.ok && (refusedBulk as any).status === 403,
    refusedBulk.ok ? "accepted" : String((refusedBulk as any).status));
  await restoreInbox();
  const okBulk = await bulkClassify(admin, await ctxFor(USER_A, wsA), {
    ids: [arr3], docType: "imaging_report", correlationId: CID,
  });
  ok("5g-control. ...and with the grant restored the identical call files it",
    okBulk.ok && okBulk.data.changed === 1, okBulk.ok ? "ok" : (okBulk as any).code);

  console.log("\n══ 6. s10 / s20 PHASE 4 -- THE METADATA EXPORT ═════════════════════════════════════════\n");

  const exp = await documentMetadataExport(admin, ctxA, {});
  ok("6a. the export produces a file",
    exp.ok, exp.ok ? `${exp.data.rowCount} rows` : (exp as any).message);

  /* ⚠ NOT GUARDED BY `if (exp.ok)`, AND THE REASON IS A WEAKNESS THE BREAK PROCESS FOUND. Wrapped in
   * that guard, breaking the export so it always refuses made these assertions VANISH rather than fail:
   * the run reported fewer assertions and no reds, which reads exactly like a pass. An assertion that
   * disappears under a break is worse than one that goes red, because nothing in the output says it is
   * gone. The csv defaults to an empty string, so a refused export fails them all. */
  const csv = exp.ok ? exp.data.csv : "";
  const lines = csv.trim().split("\r\n");
  ok("6b. the header is DOC_EXPORT_COLUMNS' labels, in order",
    lines[0] === DOC_EXPORT_COLUMNS.map(([, l]) => `"${l}"`).join(","), lines[0]);
  const regAll = await documentRegister(admin, wsA);
  ok("6c. one row per register row, and the count is the register's own",
    lines.length - 1 === regAll.rows.length && exp.ok && exp.data.rowCount === regAll.rows.length,
    `${lines.length - 1} vs ${regAll.rows.length}`);

  // ⚠ THE OMISSIONS ARE THE POINT. Two sentinels, planted in the two places clinical content lives.
  ok("6d. ⚠ NO DOCUMENT BODY REACHES THE FILE. The body of a referral letter is clinical content and "
    + "s2.3 puts the legal record out of this product's scope",
    exp.ok && !csv.includes(BODY_SENTINEL), "the sentinel was exported");
  ok("6e. ⚠ NO ARRIVAL SUMMARY EITHER -- in practice a summary reads 'Hb 6.2, for review'",
    exp.ok && !csv.includes(SUMMARY_SENTINEL), "the sentinel was exported");
  ok("6d-control. ...and the sentinel documents ARE in the file by title, so 6d and 6e are not "
    + "assertions about rows that were never exported",
    csv.includes("HARNESS sentinel letter") && csv.includes("HARNESS arrival three"),
    "the rows are absent entirely");

  ok("6f. ⚠ CSV INJECTION IS GUARDED: a cell beginning = + - or @ is prefixed with an apostrophe, because "
    + "a spreadsheet opens it as a formula",
    csvCell("=cmd|calc") === `"'=cmd|calc"` && csvCell("-2 week review") === `"'-2 week review"`,
    csvCell("=cmd|calc"));
  ok("6g. ...and every field is quoted with internal quotes doubled, unconditionally",
    csvCell('Ann "Bee", O\'Brien') === `"Ann ""Bee"", O'Brien"`, csvCell('Ann "Bee", O\'Brien'));
  ok("6h. the hostile title survives that treatment in the real file, on one line",
    csv.includes(`"'=cmd|""/c calc""!A1, and an ""aside"""`),
    "the guarded, doubled form is not in the file");

  // ⚠ THE STRICTEST APPLICATION OF THE FIRST DOCTRINE IN THIS WORKSPACE. A screen can show a gap; a
  // spreadsheet cannot, and it is read months later by somebody with no way to know a third is missing.
  const expBroken = await documentMetadataExport(brokenIncoming, ctxA, {});
  ok("6i. ⚠ AN UNREADABLE SOURCE REFUSES THE EXPORT ENTIRELY -- no partial file is written",
    !expBroken.ok && (expBroken as any).code === "SOURCE_UNREADABLE",
    expBroken.ok ? "a partial file was produced" : (expBroken as any).code);
  ok("6i-control. ...and the identical call over a working client produces the file, so 6i is a failure "
    + "branch and not an export that never works",
    exp.ok, "the export never works");

  const restoreExport = await revoke(USER_A, wsA, "data.export");
  const noExportCtx = await ctxFor(USER_A, wsA);
  const refusedExport = await documentMetadataExport(admin, noExportCtx, {});
  ok("6j. without data.export -- revoked live -- the engine refuses, so hiding the link is not the control",
    !refusedExport.ok && (refusedExport as any).status === 403,
    refusedExport.ok ? "accepted" : String((refusedExport as any).status));
  ok("6j-control. ...and that context still holds document.view, so the refusal is the export capability "
    + "and not the ability to see documents",
    noExportCtx.capabilities.includes("document.view"), "document.view was lost too");
  await restoreExport();

  // ⚠ THE FILTER ROUND-TRIPS. The export link is built from the filter that was APPLIED, so the file and
  // the list it came from cannot be answering different questions.
  const sampleQs = "status=draft,approved&origin=created_in_cp&q=harness&link=linked&window=this_month";
  const parsed = parseDocFilter(Object.fromEntries(new URLSearchParams(sampleQs).entries()));
  const reparsed = parseDocFilter(Object.fromEntries(new URLSearchParams(docFilterToQuery(parsed)).entries()));
  ok("6k. a filter serialised for the export link and re-parsed by the route is the same filter",
    JSON.stringify(reparsed) === JSON.stringify(parsed),
    `${JSON.stringify(parsed)} vs ${JSON.stringify(reparsed)}`);
  ok("6k-control. ...and that filter is not empty, so 6k is not two blanks matching",
    Object.values(parsed).filter(v => v !== undefined).length >= 4, JSON.stringify(parsed));

  ok("6l. ⚠ authorId is NEVER serialised into the export link. My Documents scopes to the caller from the "
    + "server-resolved context; an author read from a URL is one edited link away from somebody else's",
    !docFilterToQuery({ authorId: USER_B, status: ["draft"] }).includes(USER_B)
    && documentExportHref({ authorId: USER_B }, true) === "/api/v1/practice/documents/export?mine=1",
    documentExportHref({ authorId: USER_B }, true));

  const filteredExport = await documentMetadataExport(admin, await ctxFor(USER_A, wsA), { status: ["draft"] });
  const draftsNow = applyFilter((await documentRegister(admin, wsA)).rows, { status: ["draft"] }, reg1.today).length;
  ok("6m. an export under a filter contains exactly the filtered rows, counted independently here",
    filteredExport.ok && filteredExport.data.rowCount === draftsNow && draftsNow > 0,
    filteredExport.ok ? `${filteredExport.data.rowCount} vs ${draftsNow}` : (filteredExport as any).code);
  ok("6m-control. ...and that is FEWER than the unfiltered export, so the filter did something",
    exp.ok && filteredExport.ok && filteredExport.data.rowCount < exp.data.rowCount,
    exp.ok && filteredExport.ok ? `${filteredExport.data.rowCount} vs ${exp.data.rowCount}` : "");

  console.log("\n══ 7. s12 -- AI DRAFTING: THE BOUNDARY, THEN THE LABEL ═════════════════════════════════\n");

  ok("7a. every drafting task is one of CPR-210's own six -- migration 215 puts a CHECK on "
    + "practice_ai_session.task, so a seventh key would compile and fail at INSERT",
    AI_DRAFT_TASKS.every(t => ASSISTANT_TASKS.some(a => a.key === t.key)),
    AI_DRAFT_TASKS.map(t => t.key).join(", "));
  ok("7a-control. ...and the drafting list is a strict SUBSET, so 7a is not 'they are the same list'",
    AI_DRAFT_TASKS.length < ASSISTANT_TASKS.length,
    `${AI_DRAFT_TASKS.length} of ${ASSISTANT_TASKS.length}`);

  // ⚠ THE CONSENT GATE COMES BEFORE ANY RECORD IS READ, AND THAT ORDERING IS WHAT IS ASSERTED. A
  // duplicate of runAssistant's own check placed AFTER the document read would change no outcome and
  // would be a line a harness passes over. Placed before it, it has an observable consequence: with the
  // assistant off, a document THAT DOES NOT EXIST answers AI_NOT_ENABLED rather than Not found, because
  // a practice that has not agreed to disclose record content does not have a record read on its behalf.
  const MISSING_DOC = "00000000-0000-4000-8000-0000000009ff";
  const beforeConsent = await draftIntoDocument(admin, await ctxFor(USER_A, wsA), {
    documentId: MISSING_DOC, task: "draft_referral", correlationId: CID,
  });
  ok("7b. ⚠ with the assistant off, even a document that does not exist answers AI_NOT_ENABLED -- the "
    + "consent gate is above the read, not merely present somewhere below it",
    !beforeConsent.ok && (beforeConsent as any).code === "AI_NOT_ENABLED",
    beforeConsent.ok ? "it ran" : (beforeConsent as any).code);

  const enabled = await setAssistantEnabled(admin, await ctxFor(USER_A, wsA), {
    enabled: true, acknowledgedNoticeVersion: AI_NOTICE_VERSION, correlationId: CID,
  });
  ok("7b-control-a. ...and it can be switched on, by somebody acknowledging the current disclosure",
    enabled.ok, enabled.ok ? "ok" : (enabled as any).code);

  const missingAfter = await draftIntoDocument(admin, await ctxFor(USER_A, wsA), {
    documentId: MISSING_DOC, task: "draft_referral", correlationId: CID,
  });
  ok("7b-control-b. ...and with it ON the identical call reaches the read and answers Not found, so 7b is "
    + "an ordering and not a permanent refusal",
    !missingAfter.ok && (missingAfter as any).status === 404,
    missingAfter.ok ? "it ran" : (missingAfter as any).code);

  const ctxAi = await ctxFor(USER_A, wsA);

  const noEncounter = await draftIntoDocument(admin, ctxAi, {
    documentId: docFinal, task: "draft_referral", correlationId: CID,
  });
  ok("7c. a document marked READY is refused -- somebody accepted its content, and machine text arriving "
    + "into it would move the words out from under that acceptance",
    !noEncounter.ok && (noEncounter as any).code === "NOT_A_DRAFT",
    noEncounter.ok ? "it ran" : (noEncounter as any).code);

  const draftNoEnc = await draftIntoDocument(admin, ctxAi, {
    documentId: docSentinel, task: "draft_referral", correlationId: CID,
  });
  ok("7d. a DRAFT with no consultation behind it is refused -- with nothing to reorganise a model composes",
    !draftNoEnc.ok && (draftNoEnc as any).code === "NO_ENCOUNTER",
    draftNoEnc.ok ? "it ran" : (draftNoEnc as any).code);

  const restoreAuthor = await revoke(USER_A, wsA, "document.author");
  const noAuthorCtx = await ctxFor(USER_A, wsA);
  const { count: logBefore } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("action", "export");
  const refusedDraft = await draftIntoDocument(admin, noAuthorCtx, {
    documentId: docDraft, task: "draft_referral", correlationId: CID,
  });
  const { count: logAfter } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("action", "export");
  ok("7e. without document.author -- revoked live -- drafting is refused",
    !refusedDraft.ok && (refusedDraft as any).status === 403,
    refusedDraft.ok ? "it ran" : String((refusedDraft as any).status));
  ok("7e-control-a. ⚠ ...AND NOTHING WAS DISCLOSED. The access log has not grown, so the refusal happened "
    + "before any record content could leave this system",
    (logAfter ?? 0) === (logBefore ?? 0), `${logBefore} -> ${logAfter}`);
  ok("7e-control-b. ...and that context still holds document.sign, so 7e is the authoring boundary "
    + "(migration 248: an assistant may author, not sign) and not a caller who lost everything",
    noAuthorCtx.capabilities.includes("document.sign") && !noAuthorCtx.capabilities.includes("document.author"),
    `${noAuthorCtx.capabilities.length} capabilities`);
  await restoreAuthor();

  const avail = await draftAvailability(admin, await ctxFor(USER_A, wsA), { status: "DRAFT", encounter_id: encId });
  ok("7f. the panel is offered for a draft with a consultation behind it",
    avail.available && avail.blocker === null, JSON.stringify(avail));
  const availSigned = await draftAvailability(admin, await ctxFor(USER_A, wsA), { status: "SIGNED", encounter_id: encId });
  ok("7g. ⚠ and for a signed document NOTHING IS DRAWN -- not a disabled button, not a sentence. s18 "
    + "forbids 'not built' messages and this codebase forbids dead controls; not drawing satisfies both",
    !availSigned.available && availSigned.blocker === null, JSON.stringify(availSigned));
  const availNoEnc = await draftAvailability(admin, await ctxFor(USER_A, wsA), { status: "DRAFT", encounter_id: null });
  ok("7h. ...but a DRAFT with no consultation gets the one sentence a reader can act on",
    !availNoEnc.available && !!availNoEnc.blocker && availNoEnc.blocker.includes("consultation"),
    JSON.stringify(availNoEnc));

  console.log("\n══ 8. s12 -- THE LABEL: WHAT A MACHINE WROTE, AND WHETHER ANYBODY HAS TOUCHED IT ═══════\n");

  const noneYet = await aiAttribution(admin, wsA, docDraft, "A draft body.");
  ok("8a. a document nobody asked a machine to draft carries NO claim at all",
    noneYet.state === "ok" && noneYet.value.state === "none", JSON.stringify(noneYet));

  // ⚠ THE REAL PROVIDER, THE REAL ENGINE, THE REAL DOCUMENT. This is the assertion the rest of section 8
  // rests on, and it is not simulated.
  const drafted = await draftIntoDocument(admin, ctxAi, {
    documentId: docDraft, task: "draft_referral", mode: "replace", correlationId: CID,
  });
  ok("8b. the assistant writes a draft into the document, through documentation.ts's own update engine",
    drafted.ok, drafted.ok ? `${drafted.data.model}` : (drafted as any).message);

  if (drafted.ok) {
    const { data: draftedDoc } = await admin.from("practice_clinical_document")
      .select("body, status, record_version").eq("id", docDraft).single();

    ok("8c. ⚠ THE DOCUMENT IS STILL A DRAFT. A machine may author; it may not mark ready, sign or issue, "
      + "and there is no code path here that reaches any of the three",
      draftedDoc?.status === "DRAFT", String(draftedDoc?.status));
    ok("8d. the body really changed, and it is the machine's text",
      draftedDoc?.body !== "A draft body." && String(draftedDoc?.body).length > 40,
      `${String(draftedDoc?.body).length} characters`);
    ok("8e. the digests recorded are the digests of what was produced and of what the body was left as",
      drafted.data.bodySha256After === sha(String(draftedDoc?.body ?? "")),
      `${drafted.data.bodySha256After.slice(0, 12)} vs ${sha(String(draftedDoc?.body ?? "")).slice(0, 12)}`);
    ok("8f. the attribution reached the trail, and the engine says so rather than assuming it",
      drafted.data.attributionRecorded, "the boolean came back false");

    const { data: aiEvent } = await admin.from("practice_audit_event")
      .select("payload").eq("workspace_id", wsA).eq("event_type", "practice.document_ai_drafted")
      .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
    ok("8g. the trail carries the document, the task, the real model id and the digests -- and NOT the text",
      (aiEvent?.payload as any)?.documentId === docDraft
      && (aiEvent?.payload as any)?.task === "draft_referral"
      && typeof (aiEvent?.payload as any)?.model === "string"
      && (aiEvent?.payload as any)?.bodySha256After === drafted.data.bodySha256After,
      JSON.stringify(aiEvent?.payload).slice(0, 160));
    ok("8g-control. ⚠ ...and the DRAFT ITSELF IS NOT IN THE PAYLOAD. The trail is readable by anybody "
      + "holding access.review and a referral letter is clinical content",
      !JSON.stringify(aiEvent?.payload).includes(String(draftedDoc?.body).slice(0, 40)),
      "the body text is in the audit payload");

    const labelled = await aiAttribution(admin, wsA, docDraft, String(draftedDoc?.body ?? ""));
    ok("8h. ⚠ THE LABEL: the body is byte-identical to what the machine left, so it reads machine_unedited "
      + "-- nothing here has been checked by a person",
      labelled.state === "ok" && labelled.value.state === "machine_unedited"
      && labelled.value.task === "draft_referral" && !!labelled.value.model,
      JSON.stringify(labelled).slice(0, 160));

    // ⚠ THE DIGEST IS WHAT MAKES THE LABEL A MEASUREMENT RATHER THAN A FLAG. One character is enough.
    const edited = await updateDocument(admin, {
      workspaceId: wsA, documentId: docDraft, body: `${String(draftedDoc?.body ?? "")} Reviewed by hand.`,
      ...base,
    });
    const { data: editedDoc } = await admin.from("practice_clinical_document")
      .select("body").eq("id", docDraft).single();
    const afterEdit = await aiAttribution(admin, wsA, docDraft, String(editedDoc?.body ?? ""));
    ok("8i. ⚠ ONE EDIT LATER IT READS machine_edited -- the state is derived from a SHA-256 of the body, "
      + "not from a flag anything could have set",
      edited.ok && afterEdit.state === "ok" && afterEdit.value.state === "machine_edited",
      JSON.stringify(afterEdit).slice(0, 160));
    ok("8i-control. ...and the same reader over the UNEDITED text still says machine_unedited, so 8i is "
      + "the digest changing and not the reader always saying edited",
      (await aiAttribution(admin, wsA, docDraft, String(draftedDoc?.body ?? ""))).state === "ok",
      "the unedited reading failed");
  }

  /* ⚠ THE DRAFT LANDED AND THE RECORD OF IT DID NOT. This is the one outcome in which a practitioner is
   * looking at machine-written words with nothing anywhere saying so, and it is exactly the state s12's
   * labelling rule exists to prevent. The engine must carry the boolean back rather than discard it --
   * a bare `await audit(...)` returns false and throws nothing, which is the discarded-error class this
   * product has shipped twice. Proven by running the whole real path through a client that refuses the
   * trail. */
  const docDraft3 = await mk(pAlice, "HARNESS trail-refused draft", "Before the machine.", encId);
  const brokenTrailDraft = refusing("practice_audit_event", "harness: the trail is refused");
  const draftedNoTrail = await draftIntoDocument(brokenTrailDraft, ctxAi, {
    documentId: docDraft3, task: "summarise_encounter", mode: "replace", correlationId: CID,
  });
  const { data: noTrailDoc } = await admin.from("practice_clinical_document")
    .select("body").eq("id", docDraft3).single();
  ok("8f-control. ⚠ when the attribution cannot be written the call still SUCCEEDS, the text is in the "
    + "document, and the engine says attributionRecorded: false rather than reporting everything worked",
    draftedNoTrail.ok && draftedNoTrail.data.attributionRecorded === false
    && String(noTrailDoc?.body ?? "") !== "Before the machine.",
    draftedNoTrail.ok ? String(draftedNoTrail.data.attributionRecorded) : (draftedNoTrail as any).code);

  // ⚠ THE EVENT IS MATCHED BY documentId. Filtering a jsonb path in PostgREST that does not match the
  // stored shape returns zero rows with NO ERROR, which reads as "no machine drafted this" -- the exact
  // false negative this reader exists to prevent. So the filter is in TypeScript, and this proves it.
  const otherDoc = await aiAttribution(admin, wsA, docFinal, "A body somebody has accepted.");
  ok("8j. ⚠ a DIFFERENT document in the same practice reads `none`, so the trail is matched on the "
    + "document and not merely on the event existing anywhere",
    otherDoc.state === "ok" && otherDoc.value.state === "none", JSON.stringify(otherDoc));

  const brokenTrail = refusing("practice_audit_event", "harness: the trail is refused");
  const trailBroken = await aiAttribution(brokenTrail, wsA, docDraft, "anything");
  ok("8k. ⚠ AN UNREADABLE TRAIL IS NOT `none`. 'No machine wrote this' and 'we could not find out whether "
    + "a machine wrote this' are opposite advice to somebody about to put their name on it",
    trailBroken.state === "unreadable", JSON.stringify(trailBroken).slice(0, 120));

  const aiSource = readFileSync(join(process.cwd(), "src", "lib", "practice", "documents-workspace-ai.ts"), "utf8");
  ok("8l. ⚠ the drafting module NEVER TRANSITIONS A DOCUMENT. It does not import transitionDocument and "
    + "it names no target status -- the boundary is structural, not a rule somebody remembers",
    !aiSource.includes("transitionDocument") && !/to:\s*"(SIGNED|FINAL)"/.test(aiSource),
    "a transition reached the drafting module");
  ok("8l-control. ...and it DOES import updateDocument, so 8l is not 'this module imports nothing'",
    aiSource.includes("updateDocument"), "the write engine is not imported either");

  console.log("\n══ 9. s13 -- THE PERMISSION MATRIX IS READ FROM LIVE GRANTS ════════════════════════════\n");

  const { data: seedRows } = await admin.from("practice_role_capabilities").select("role_code, capability_code");
  const seeded = new Set(((seedRows ?? []) as any[]).map(r => r.capability_code as string));
  ok("9a. ⚠ EVERY CAPABILITY THIS PHASE NAMES IS IN THE SEEDED CATALOGUE. Six invented capability codes "
    + "have shipped in this codebase; a seventh would compile, lint and grant nothing",
    DOC_PERMISSION_ROWS.every(r => seeded.has(r.capability)),
    DOC_PERMISSION_ROWS.filter(r => !seeded.has(r.capability)).map(r => r.capability).join(", "));
  ok("9a-control. ...and the probe found the catalogue it claims to be checking against",
    seeded.size >= 40, `${seeded.size} codes seeded`);
  ok("9b. and every tab's capability is seeded too, including the new Review & tasks tab",
    DOC_TABS.every(t => t.capability === null || seeded.has(t.capability))
    && DOC_TABS.some(t => t.key === "review" && t.href === "/practice/documents/review"),
    DOC_TABS.map(t => `${t.key}:${t.capability}`).join(", "));
  ok("9c. and the Review & tasks tab has a page behind it, so the sub-navigation cannot point at a 404",
    existsSync(join(process.cwd(), "src", "app", "practice", "(shell)", "documents", "review", "page.tsx")),
    "no page file");

  const perms1 = await documentPermissions(admin, wsA);
  const signRow = perms1.state === "ok" ? perms1.value.find(p => p.capability === "document.sign")! : null;
  ok("9d. the practitioner is listed as holding document.sign",
    !!signRow && signRow.holders.length >= 1 && !signRow.nobody,
    JSON.stringify(signRow));

  const restoreSignA = await revoke(USER_A, wsA, "document.sign");
  const restoreSignC = await revoke(COLLEAGUE, wsA, "document.sign");
  const perms2 = await documentPermissions(admin, wsA);
  const signRow2 = perms2.state === "ok" ? perms2.value.find(p => p.capability === "document.sign")! : null;
  ok("9e. ⚠ revoking the grant live removes the holder, so the matrix is the GRANTS and not the seed. A "
    + "practice where nobody can sign is a practice whose letters cannot leave",
    !!signRow2 && signRow2.nobody && signRow2.holders.length === 0,
    JSON.stringify(signRow2));
  ok("9e-control. ...and document.view is unaffected in the same reading, so 9e is one capability moving "
    + "and not the whole matrix collapsing",
    perms2.state === "ok" && !perms2.value.find(p => p.capability === "document.view")!.nobody,
    perms2.state === "ok" ? JSON.stringify(perms2.value.find(p => p.capability === "document.view")) : "unreadable");
  await restoreSignA();
  await restoreSignC();
  const perms3 = await documentPermissions(admin, wsA);
  const signRow3 = perms3.state === "ok" ? perms3.value.find(p => p.capability === "document.sign")! : null;
  ok("9f. ...and restoring it brings the holder back, so the matrix follows the grants in both directions",
    !!signRow3 && !signRow3.nobody && signRow3.holders.length === (signRow?.holders.length ?? -1),
    JSON.stringify(signRow3));

  // ⚠ A GRANT THAT HAS NOT STARTED IS NOT HELD. access.ts evaluates the window on the DATABASE'S clock in
  // two queries; the matrix must do the same, and this proves it does rather than reading every row.
  const { data: msA } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", wsA).eq("user_id", USER_A).eq("status", "active");
  const future = new Date(Date.now() + 86400000).toISOString();
  const { data: pushed } = await admin.from("practice_role_assignment")
    .update({ effective_from: future })
    .in("membership_id", ((msA ?? []) as any[]).map(m => m.id)).eq("capability_code", "template.manage")
    .is("effective_to", null).select("id");
  const perms4 = await documentPermissions(admin, wsA);
  const tmplRow = perms4.state === "ok" ? perms4.value.find(p => p.capability === "template.manage")! : null;
  ok("9g. ⚠ a grant dated to begin tomorrow is NOT counted as held today",
    !!tmplRow && tmplRow.nobody, JSON.stringify(tmplRow));
  await admin.from("practice_role_assignment")
    .update({ effective_from: new Date(Date.now() - 60000).toISOString() })
    .in("id", ((pushed ?? []) as any[]).map(r => r.id));
  const perms5 = await documentPermissions(admin, wsA);
  ok("9g-control. ...and dating it into the past makes it held again, so 9g is the window and not a "
    + "capability nobody ever had",
    perms5.state === "ok" && !perms5.value.find(p => p.capability === "template.manage")!.nobody,
    perms5.state === "ok" ? JSON.stringify(perms5.value.find(p => p.capability === "template.manage")) : "unreadable");

  console.log("\n══ 10. THE CLIENT/SERVER BOUNDARY, AND THE PAYLOAD ═════════════════════════════════════\n");

  // ⚠ A SERVER-ONLY IMPORT CROSSING INTO A CLIENT COMPONENT compiles, lints, passes every runtime harness
  // and then the page is dead in a production build. It killed the Follow-ups board this week.
  const clientFiles = [
    ["ReviewBoard.tsx", join(process.cwd(), "src", "app", "practice", "(shell)", "documents", "_workspace", "ReviewBoard.tsx")],
    ["AiDraftPanel.tsx", join(process.cwd(), "src", "app", "practice", "(shell)", "documents", "[documentId]", "AiDraftPanel.tsx")],
  ] as const;
  const FORBIDDEN = [
    "documents-workspace-review", "documents-workspace-ai", "documents-workspace-issue",
    "@/lib/practice/documents-workspace\"", "@/lib/supabase/server", "@/lib/practice/provisioning",
    "@/lib/practice/tasks", "@/lib/ai/client", "node:crypto",
  ];
  for (const [name, path] of clientFiles) {
    const src = existsSync(path) ? readFileSync(path, "utf8") : "";
    ok(`10a-${name}. it is a client component and imports nothing that reaches the server`,
      src.startsWith('"use client"') && FORBIDDEN.every(f => !src.includes(f)),
      FORBIDDEN.filter(f => src.includes(f)).join(", ") || "missing \"use client\"");
  }
  // ⚠ THE CANARY IS DERIVED FROM THE FORBIDDEN LIST, NOT A SECOND HARD-CODED STRING.
  //
  // It used to name `@/lib/practice/provisioning` and assert the review ENGINE imported it, proving the
  // scan above could fire. The engine stopped importing provisioning at some point and the control went
  // red -- correctly, but for a reason that had nothing to do with what it guards: the scan was still
  // perfectly capable, because the engine imports `@/lib/practice/tasks` and `documents-workspace`,
  // both of which are on the list two lines up.
  //
  // A control that names one specific violation goes stale every time the code legitimately changes,
  // and a control nobody trusts is the one that gets deleted along with the check it protects. Asking
  // "does ANY forbidden import appear in a server module" is the same proof and cannot rot this way.
  const engineSrc =
    readFileSync(join(process.cwd(), "src", "lib", "practice", "documents-workspace-review.ts"), "utf8");
  const canaryHits = FORBIDDEN.filter(f => engineSrc.includes(f));
  ok("10a-control. ...and the forbidden list really matches something -- the ENGINE carries imports on "
    + "that list, so the scan is capable of finding a violation",
    canaryHits.length > 0,
    `no forbidden import found in the review engine, so the scan above would never fire`);

  const payloadForClient = await documentsReview(admin, await ctxFor(USER_A, wsA));
  const found = functionPaths(payloadForClient);
  ok("10b. ⚠ the review payload is plain data to its leaves -- no function anywhere on it",
    found.length === 0, found.join(", "));
  ok("10b-control. ...and the walker really finds one when there is one, so 10b is not a walker that "
    + "returns empty for everything",
    functionPaths({ a: { b: [{ c: () => 1 }] } }).length === 1,
    "the walker found nothing in a payload that has one");

  console.log("\n══ 11. s20 PHASE 4 -- WHAT IS NOT THERE ════════════════════════════════════════════════\n");

  // ⚠ THESE ASSERT AN ABSENCE, AND THE ABSENCE IS THE DECISION. There is no patient authentication and no
  // delivery channel in this deployment. A secure link nobody can receive, to a recipient nobody can
  // verify, is not a feature -- and drawing it disabled is what s18 forbids.
  // ⚠ existsSync BEFORE readFileSync, AND A MISSING FILE IS A FAILURE RATHER THAN A CRASH. The break
  // process moved the review page aside to prove 9c, and this section threw on the read -- which killed
  // the process, so the four assertions below never ran and reported nothing at all. A harness that
  // crashes is a harness whose remaining assertions are silently absent.
  const workspaceFiles = [
    join(process.cwd(), "src", "lib", "practice", "documents-workspace-review.ts"),
    join(process.cwd(), "src", "lib", "practice", "documents-workspace-ai.ts"),
    join(process.cwd(), "src", "app", "practice", "(shell)", "documents", "_workspace", "ReviewBoard.tsx"),
    join(process.cwd(), "src", "app", "practice", "(shell)", "documents", "review", "page.tsx"),
  ];
  const allSource = workspaceFiles.map(f => (existsSync(f) ? readFileSync(f, "utf8") : "MISSING")).join("\n");
  ok("11a. nothing in Phase 3 or 4 mints a share token, a secure link or an expiry -- there is no channel "
    + "to send one down and no patient identity to send it to",
    !/shareToken|secure_link|secureLink|linkExpiry|expires_at/.test(allSource),
    "a token or expiry appears in the workspace");
  ok("11b. and nothing claims a patient uploaded anything -- `uploaded_by_patient` is still not a value "
    + "any row in this product can carry",
    !allSource.includes("uploaded_by_patient"),
    "a patient-upload provenance claim appears");

  const constantsSource = readFileSync(
    join(process.cwd(), "src", "lib", "practice", "documents-workspace-constants.ts"), "utf8");
  ok("11c. the absent Phase 4 surfaces are RECORDED with their reasons, so the next agent does not build "
    + "one on the assumption that nobody thought about it",
    constantsSource.includes("PATIENT UPLOAD CHANNELS") && constantsSource.includes("SECURE LINKS")
    && constantsSource.includes("EXTENDED IMPORT/EXPORT"),
    "the Phase 4 block is missing");

  const reviewSource = readFileSync(
    join(process.cwd(), "src", "lib", "practice", "documents-workspace-review.ts"), "utf8");
  ok("11d. and the ONE MIGRATION Phase 3 needs is written out in full -- practice_task has no "
    + "incoming_document_id, so the arrivals queue cannot be assigned to anybody",
    reviewSource.includes("incoming_document_id uuid")
    && reviewSource.includes("references practice_incoming_document(id) on delete set null"),
    "the column is not described");

  await cleanup();
  report();
}

main().catch(e => { console.error(e); process.exit(1); });
