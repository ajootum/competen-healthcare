/**
 * Practice delegation harness -- CPR-310's area model, approvals and derived queues. Migration 208.
 *
 * WHAT IT PROVES:
 *   1. AN AREA DELEGATION MATERIALISES ORDINARY CAPABILITY GRANTS. The resolver -- resolveWorkspaceContext,
 *      which knows nothing about areas -- returns the capabilities afterwards and not before. If areas
 *      were a second place a permission could live, this would fail.
 *   2. NOTHING CLINICAL IS DELEGABLE, checked twice: no area names a signing or clinical-authorship
 *      capability, and NEVER_DELEGABLE refuses one independently at grant time.
 *   3. A DELEGATION MUST END, and an open-ended or backwards one is refused.
 *   4. WITHDRAWING ENDS EXACTLY THE GRANTS IT CREATED. A colleague holding the same capability by ROLE
 *      DEFAULT keeps it -- the failure that would otherwise take somebody's access away for a reason
 *      they could never discover.
 *   5. YOU CANNOT GRANT WHAT YOU DO NOT HOLD, per capability, and the partial case is reported rather
 *      than silently completed.
 *   6. NOBODY APPROVES THEIR OWN WORK, and a rejection without words is refused.
 *   7. AN APPROVAL IS A QUEUE, NOT A GATE: the delegate could already do the work, and the harness shows
 *      the work succeeding while its approval is still pending.
 *   8. THE WORK QUEUES ARE DERIVED from rows that already exist, and they discriminate.
 *   9. A ROLE TEMPLATE GRANTS EVERY AREA IN IT, validated against the fixed vocabulary.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-delegation-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import { createDocument } from "../src/lib/practice/documentation";
import {
  delegateArea, withdrawDelegation, delegationBoard, createRoleTemplate, applyRoleTemplate,
  requestApproval, decideApproval, listApprovals, workQueues,
} from "../src/lib/practice/delegation";
import { DELEGATION_AREAS, DELEGABLE_CAPABILITIES, NEVER_DELEGABLE } from "../src/lib/practice/delegation-constants";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e23d1";
const OTHER = "00000000-0000-4000-8000-0000000e23d2";
const ASSISTANT = "00000000-0000-4000-8000-0000000e23d3";
const SECOND = "00000000-0000-4000-8000-0000000e23d4";

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
    idempotency_key: `harness-del-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-del",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-del", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-del" };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A member with a role, added directly -- the invitation flow has its own harness. */
async function addMember(workspaceId: string, userId: string, roleCode: string, capabilities: string[]) {
  const { data: m } = await admin.from("practice_membership").insert({
    workspace_id: workspaceId, user_id: userId, role_code: roleCode, status: "active",
  }).select("id").single();
  if (capabilities.length) {
    await admin.from("practice_role_assignment").insert(
      capabilities.map(c => ({ membership_id: m!.id, capability_code: c, source: "role_default" })),
    );
  }
  return m!.id as string;
}

async function capsOf(workspaceId: string, userId: string): Promise<string[]> {
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  return res.ok ? [...res.ctx.capabilities] : [];
}

const tomorrow = () => new Date(Date.now() + 86400000).toISOString();
const yesterday = () => new Date(Date.now() - 86400000).toISOString();

async function main() {
  console.log("\nPractice delegation harness (CPR-310, migration 208)\n");
  await cleanup();

  // ── 2. Nothing clinical is delegable, asserted over the vocabulary itself ─
  const clinical = DELEGABLE_CAPABILITIES.filter(c => (NEVER_DELEGABLE as readonly string[]).includes(c));
  ok("NO AREA NAMES A CAPABILITY THAT MAY NEVER BE DELEGATED", clinical.length === 0, clinical.join(", "));
  ok("and the never-delegable list actually contains the signing capabilities",
    (NEVER_DELEGABLE as readonly string[]).includes("encounter.sign") &&
    (NEVER_DELEGABLE as readonly string[]).includes("document.sign"));
  ok("the areas are the six the specification names, and each grants something",
    DELEGATION_AREAS.length === 6 && DELEGATION_AREAS.every(a => a.capabilities.length > 0),
    String(DELEGATION_AREAS.length));
  // A control proving the first assertion is not vacuous: if it scanned nothing it would also pass.
  ok("CONTROL: the delegable set is non-empty (the clinical scan is not vacuous)",
    DELEGABLE_CAPABILITIES.length > 8, String(DELEGABLE_CAPABILITIES.length));

  const wsA = await provision(OWNER, "HARNESS Delegation A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Delegation B (synthetic)", "b");


  // The assistant holds ONE capability by role default, and it is one the scheduling area also grants.
  // That is deliberate: it makes a withdrawal that ended grants BY CAPABILITY rather than by delegation
  // fail this harness, not merely a withdrawal that reached across memberships.
  const assistantMembership = await addMember(wsA, ASSISTANT, "practice_assistant", ["search.use"]);
  const before = await capsOf(wsA, ASSISTANT);
  ok("the assistant starts with only their role default", before.join(",") === "search.use", before.join(","));

  // ── 3. A delegation must end ─────────────────────────────────────────────
  const openEnded = await delegateArea(admin, {
    workspaceId: wsA, membershipId: assistantMembership, area: "scheduling", effectiveTo: "", ...base,
  });
  ok("an open-ended delegation is refused", !openEnded.ok && openEnded.code === "END_REQUIRED");
  const backwards = await delegateArea(admin, {
    workspaceId: wsA, membershipId: assistantMembership, area: "scheduling", effectiveTo: yesterday(), ...base,
  });
  ok("one that ends before it starts is refused", !backwards.ok && backwards.code === "ENDS_BEFORE_IT_STARTS");
  const unknownArea = await delegateArea(admin, {
    workspaceId: wsA, membershipId: assistantMembership, area: "billing", effectiveTo: tomorrow(), ...base,
  });
  ok("an area that does not exist is refused", !unknownArea.ok && unknownArea.code === "UNKNOWN_AREA");
  const self = await delegateArea(admin, {
    workspaceId: wsA, membershipId: assistantMembership, area: "scheduling", effectiveTo: tomorrow(),
    actorId: ASSISTANT, correlationId: "h",
  });
  ok("you cannot delegate to yourself", !self.ok);

  // ── 1. The delegation reaches the ordinary resolver ──────────────────────
  const granted = await delegateArea(admin, {
    workspaceId: wsA, membershipId: assistantMembership, area: "scheduling",
    effectiveTo: tomorrow(), note: "Covering the diary", ...base,
  });
  ok("an area is delegated", granted.ok, granted.ok ? "" : granted.message);
  if (!granted.ok) return report();

  const after = await capsOf(wsA, ASSISTANT);
  ok("THE ORDINARY RESOLVER RETURNS THE CAPABILITIES -- an area is not a second place a permission lives",
    after.includes("appointment.manage") && after.includes("practice.calendar.view") && after.includes("queue.manage"),
    after.join(","));
  ok("and only what the area grants -- nothing clinical arrived with it",
    !after.includes("encounter.sign") && !after.includes("document.sign") && !after.includes("encounter.edit"),
    after.join(","));

  const board = await delegationBoard(admin, wsA);
  ok("the board shows it live, with the area's label",
    board.live.length === 1 && board.live[0].area === "scheduling" && board.live[0].state === "live",
    JSON.stringify(board.live.map(d => [d.area, d.state])));
  ok("and the summary counts holders per area, as a COUNT rather than the comp's percentage",
    board.byArea.find(a => a.code === "scheduling")?.holders === 1 &&
    !/%/.test(JSON.stringify(board.byArea)),
    JSON.stringify(board.byArea.map(a => [a.code, a.holders])));

  // ── 5. You cannot grant what you do not hold ─────────────────────────────
  // The assistant holds scheduling but not documentation; delegating on from them must be refused.
  const secondMembership = await addMember(wsA, SECOND, "practice_assistant", []);
  const cannot = await delegateArea(admin, {
    workspaceId: wsA, membershipId: secondMembership, area: "documentation",
    effectiveTo: tomorrow(), actorId: ASSISTANT, correlationId: "h",
  });
  // The assistant DOES hold patient.list (scheduling grants it), so a rule that granted whatever subset
  // the delegator happened to hold would let this through and put "Documentation and letters" against
  // their name. An area is all of it or none.
  ok("YOU CANNOT GRANT WHAT YOU DO NOT HOLD, AND A PARTIAL AREA IS NOT GRANTED EITHER",
    !cannot.ok && cannot.code === "CANNOT_DELEGATE_WHAT_YOU_LACK", cannot.ok ? "granted" : cannot.code);
  ok("and the refusal names exactly what is missing, not just that something is",
    !cannot.ok && /document\.author/.test(cannot.message), cannot.ok ? "" : cannot.message);

  const canPass = await delegateArea(admin, {
    workspaceId: wsA, membershipId: secondMembership, area: "scheduling",
    effectiveTo: tomorrow(), actorId: ASSISTANT, correlationId: "h",
  });
  ok("CONTROL: they CAN pass on the area they hold in full", canPass.ok, canPass.ok ? "" : canPass.message);
  ok("and the whole area goes with it, not a subset",
    canPass.ok && canPass.data.capabilities.length === DELEGATION_AREAS.find(a => a.code === "scheduling")!.capabilities.length,
    canPass.ok ? canPass.data.capabilities.join(",") : "");

  // ── 4. Withdrawing ends exactly its own grants ───────────────────────────
  // A colleague holds appointment.manage by ROLE DEFAULT. Withdrawing the assistant's delegation must
  // not touch it.
  const colleagueId = "00000000-0000-4000-8000-0000000e23d5";
  const colleagueMembership = await addMember(wsA, colleagueId, "practice_assistant", ["appointment.manage", "practice.calendar.view"]);
  void colleagueMembership;
  const colleagueBefore = await capsOf(wsA, colleagueId);
  ok("the colleague holds appointment.manage by role default", colleagueBefore.includes("appointment.manage"));

  const noReason = await withdrawDelegation(admin, { workspaceId: wsA, delegationId: granted.data.id, reason: " ", ...base });
  ok("withdrawing without a reason is refused", !noReason.ok && noReason.code === "REASON_REQUIRED");

  const withdrawn = await withdrawDelegation(admin, {
    workspaceId: wsA, delegationId: granted.data.id, reason: "Cover ended early", ...base,
  });
  ok("the delegation is withdrawn", withdrawn.ok, withdrawn.ok ? "" : withdrawn.message);

  const assistantAfter = await capsOf(wsA, ASSISTANT);
  ok("the assistant loses the delegated capabilities",
    !assistantAfter.includes("appointment.manage") && !assistantAfter.includes("queue.manage"),
    assistantAfter.join(","));
  ok("BUT KEEPS THEIR OWN ROLE DEFAULT, even though the area granted the same capability",
    assistantAfter.includes("search.use"), assistantAfter.join(","));
  const colleagueAfter = await capsOf(wsA, colleagueId);
  ok("THE COLLEAGUE'S ROLE DEFAULT SURVIVES -- withdrawal ends exactly the grants it created",
    colleagueAfter.includes("appointment.manage") && colleagueAfter.includes("practice.calendar.view"),
    colleagueAfter.join(","));

  const twice = await withdrawDelegation(admin, { workspaceId: wsA, delegationId: granted.data.id, reason: "again", ...base });
  ok("a delegation cannot be withdrawn twice", !twice.ok && twice.code === "ALREADY_WITHDRAWN");

  const afterBoard = await delegationBoard(admin, wsA);
  ok("the board distinguishes withdrawn from expired",
    afterBoard.delegations.find(d => d.id === granted.data.id)?.state === "withdrawn",
    JSON.stringify(afterBoard.delegations.map(d => d.state)));

  // ── 9. Role templates ────────────────────────────────────────────────────
  const badTemplate = await createRoleTemplate(admin, {
    workspaceId: wsA, code: "secretary", title: "Secretary", areas: ["scheduling", "billing"], ...base,
  });
  ok("a template naming an area that does not exist is refused",
    !badTemplate.ok && badTemplate.code === "UNKNOWN_AREA", badTemplate.ok ? "created" : badTemplate.code);
  const emptyTemplate = await createRoleTemplate(admin, {
    workspaceId: wsA, code: "empty", title: "Nothing", areas: [], ...base,
  });
  ok("a template with no areas is refused (it would grant nothing)", !emptyTemplate.ok);

  const template = await createRoleTemplate(admin, {
    workspaceId: wsA, code: "secretary", title: "Secretary",
    description: "Diary, registration, letters", areas: ["scheduling", "registration", "documentation"], ...base,
  });
  ok("CONTROL: a real template is created", template.ok, template.ok ? "" : template.message);
  if (!template.ok) return report();

  const applied = await applyRoleTemplate(admin, {
    workspaceId: wsA, membershipId: assistantMembership, templateId: template.data.id,
    effectiveTo: tomorrow(), ...base,
  });
  ok("applying it grants every area in it",
    applied.ok && applied.data.granted.length === 3 && applied.data.refused.length === 0,
    applied.ok ? JSON.stringify(applied.data) : applied.message);

  const templated = await capsOf(wsA, ASSISTANT);
  ok("and the resolver returns the union of all three areas",
    templated.includes("appointment.manage") && templated.includes("patient.create") && templated.includes("document.author"),
    templated.join(","));
  ok("still with nothing clinical in it",
    !templated.includes("document.sign") && !templated.includes("encounter.sign") && !templated.includes("diagnosis.record"),
    templated.join(","));

  // ── 6 and 7. Approvals ───────────────────────────────────────────────────
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Namusoke Betty", sex: "female", birthDate: "1988-06-11",
    phone: "0772 555 500", ...base,
  });
  if (!p1.ok) { ok("patient registers", false, p1.message); return report(); }

  // THE DELEGATE DOES THE WORK. They hold document.author through the template, so this succeeds --
  // which is the point: the approval below does not gate it.
  const drafted = await createDocument(admin, {
    workspaceId: wsA, patientId: p1.data.id, title: "Referral to physiotherapy",
    docType: "referral_letter", body: "Prepared by the secretary.",
    actorId: ASSISTANT, correlationId: "harness-del",
  });
  ok("the delegate CAN author the document -- the capability is what let them", drafted.ok,
    drafted.ok ? "" : drafted.message);

  const request = await requestApproval(admin, {
    workspaceId: wsA, subjectKind: "document", subjectId: drafted.ok ? drafted.data.id : null,
    patientId: p1.data.id, area: "documentation", summary: "Referral letter ready for signature",
    urgency: "urgent", assignedTo: OWNER, actorId: ASSISTANT, correlationId: "harness-del",
  });
  ok("an approval is requested", request.ok, request.ok ? "" : request.message);
  if (!request.ok) return report();

  const { data: stillDraft } = await admin.from("practice_clinical_document")
    .select("status").eq("id", drafted.ok ? drafted.data.id : "").maybeSingle();
  ok("AN APPROVAL IS A QUEUE, NOT A GATE: the work exists while its approval is still pending",
    stillDraft?.status === "DRAFT", String(stillDraft?.status));

  const selfDecide = await decideApproval(admin, {
    workspaceId: wsA, approvalId: request.data.id, decision: "APPROVED",
    actorId: ASSISTANT, correlationId: "h",
  });
  ok("NOBODY APPROVES THEIR OWN WORK", !selfDecide.ok && selfDecide.code === "SELF_APPROVAL",
    selfDecide.ok ? "approved" : selfDecide.code);

  const silentReject = await decideApproval(admin, {
    workspaceId: wsA, approvalId: request.data.id, decision: "REJECTED", ...base,
  });
  ok("a rejection without words is refused -- the person who did the work has to know what to change",
    !silentReject.ok && silentReject.code === "REASON_REQUIRED");

  const decided = await decideApproval(admin, {
    workspaceId: wsA, approvalId: request.data.id, decision: "APPROVED", note: "Read and signed", ...base,
  });
  ok("CONTROL: the practitioner decides it", decided.ok, decided.ok ? "" : decided.message);
  const decidedTwice = await decideApproval(admin, {
    workspaceId: wsA, approvalId: request.data.id, decision: "REJECTED", note: "no", ...base,
  });
  ok("and it cannot be decided twice", !decidedTwice.ok && decidedTwice.code === "ALREADY_DECIDED");

  // Ordering: urgent before routine, oldest before newest.
  //
  // THE URGENT ONE IS CREATED FIRST, DELIBERATELY. With it created last, a queue that simply ordered
  // newest-first would put it on top by coincidence and this assertion would pass while the ordering
  // was wrong -- which is exactly what happened to an earlier version of it.
  await requestApproval(admin, {
    workspaceId: wsA, subjectKind: "patient", summary: "An urgent one", urgency: "urgent",
    assignedTo: OWNER, actorId: ASSISTANT, correlationId: "h",
  });
  await requestApproval(admin, {
    workspaceId: wsA, subjectKind: "task", summary: "A routine one", assignedTo: OWNER,
    actorId: ASSISTANT, correlationId: "h",
  });
  const pending = await listApprovals(admin, wsA, { status: "PENDING" });
  ok("the queue puts URGENT FIRST -- ordered by what it costs to leave, not by newest",
    pending[0]?.urgency === "urgent" && pending[0]?.summary === "An urgent one",
    pending.map((a: any) => `${a.urgency}:${a.summary}`).join(" | "));
  ok("and it names who asked", pending[0]?.requestedByName !== undefined);

  // ── 8. The derived work queues ───────────────────────────────────────────
  const queues = await workQueues(admin, wsA, OWNER);
  const docQueue = queues.queues.find(q => q.key === "documents");
  const approvalQueue = queues.queues.find(q => q.key === "approvals");
  ok("THE WORK QUEUES ARE DERIVED and discriminate: one draft document, two approvals waiting",
    docQueue?.total === 1 && approvalQueue?.total === 2,
    JSON.stringify(queues.queues.map(q => [q.key, q.total])));
  ok("every queue leads somewhere -- a count nobody can open is decoration",
    queues.queues.every(q => q.href.startsWith("/practice/")),
    queues.queues.map(q => q.href).join(" "));
  ok("and the urgent count is separate from the total",
    queues.urgentApprovals === 1 && queues.pendingApprovals === 2,
    JSON.stringify({ urgent: queues.urgentApprovals, pending: queues.pendingApprovals }));

  // ── 10. Isolation ────────────────────────────────────────────────────────
  const crossMember = await delegateArea(admin, {
    workspaceId: wsB, membershipId: assistantMembership, area: "scheduling", effectiveTo: tomorrow(),
    actorId: OTHER, correlationId: "h",
  });
  ok("another workspace's membership cannot be delegated to",
    !crossMember.ok && crossMember.code === "NOT_FOUND", crossMember.ok ? "granted" : crossMember.code);
  const bBoard = await delegationBoard(admin, wsB);
  ok("B's board holds none of A's delegations", bBoard.delegations.length === 0, String(bBoard.delegations.length));
  ok("A's board is non-empty (the isolation test is not vacuous)", afterBoard.delegations.length > 0);
  const bQueues = await workQueues(admin, wsB, OTHER);
  ok("and B's queues count none of A's work",
    bQueues.queues.every(q => q.total === 0), JSON.stringify(bQueues.queues.map(q => q.total)));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
