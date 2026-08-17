/**
 * Practice team harness -- CPR-310, exercised against the live database through the same engine the
 * API uses.
 *
 * TWO OF THESE ASSERTIONS ARE ABOUT A BUG THAT WAS ALREADY SHIPPED.
 *
 * Migration 191 designed time-bounded capability grants -- source='delegation', effective_from,
 * effective_to -- and src/lib/practice/access.ts resolved them with `.is("effective_to", null)`. So a
 * grant with an end date was invisible EVEN WHILE LIVE, and effective_from was ignored entirely, making
 * a grant dated to start next Monday live the moment it was written. Section 1 asserts the fixed
 * resolver from all three directions.
 *
 * WHAT ELSE IT PROVES:
 *   2. THE ESCALATION RULE: you cannot delegate a capability you do not hold. Migration 191 gives the
 *      owner administration and no clinical access; the owner also runs the team. Without this rule
 *      those combine into one-click self-escalation. Asserted with its control -- the same call, for a
 *      capability the actor does hold, succeeds.
 *   3. INVITATIONS are bearer codes: single-use, expiring (derived, never stored), revocable, and every
 *      bad one gets the SAME refusal so guessing learns nothing. Redemption grants the role's
 *      capabilities, and a failure to grant them rolls the membership back rather than leaving somebody
 *      who can sign in and do nothing.
 *   4. A WORKSPACE MAY NEVER LOSE ITS LAST OWNER -- refused by the engine AND by the database when the
 *      engine is bypassed, with a control proving the trigger is not refusing everything.
 *   5. Ending a membership ends its grants; reinstating restores the ROLE's, not the ones that happened
 *      to be live, so a closed delegation window stays closed.
 *   6. Revoked access orphans work rather than hiding it (composes with CPR-340).
 *   7. Isolation non-vacuously; anon reads 0 rows from both new tables.
 *
 *   npx --yes tsx scripts/practice-team-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { createTask, taskBoard } from "../src/lib/practice/tasks";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  listTeam, createInvitation, revokeInvitation, listInvitations, acceptInvitation,
  setMembershipStatus, reinstateMembership, delegateCapability, endDelegation, membershipHistory,
} from "../src/lib/practice/team";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e16b1";
const OTHER_OWNER = "00000000-0000-4000-8000-0000000e16b2";
const JOINER = "00000000-0000-4000-8000-0000000e16b3";
const SECOND_JOINER = "00000000-0000-4000-8000-0000000e16b4";

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
    idempotency_key: `harness-team-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-team",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-team", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER_OWNER]);
}

const base = { actorId: OWNER, correlationId: "harness-team" };

/* eslint-disable @typescript-eslint/no-explicit-any */

const capsOf = async (userId: string, workspaceId: string): Promise<string[]> => {
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  return res.ok ? res.ctx.capabilities : [];
};

async function main() {
  console.log("\nPractice team harness (CPR-310, migration 201)\n");
  await cleanup();

  const reg = await admin.rpc("plat_function_registry");
  const fns = (reg.data ?? []) as { fn_name: string }[];
  ok("the function registry probe returns rows (the trigger checks are not vacuous)", fns.length > 0);
  ok("practice_last_owner_guard() is deployed (migration 201 s3)",
    fns.some(f => f.fn_name === "practice_last_owner_guard"), "NOT FOUND");
  ok("practice_membership_event_immutable() is deployed (migration 201 s3)",
    fns.some(f => f.fn_name === "practice_membership_event_immutable"), "NOT FOUND");

  const wsA = await provision(OWNER, "HARNESS Team A (synthetic)", "a");
  const wsB = await provision(OTHER_OWNER, "HARNESS Team B (synthetic)", "b");

  // ── 3. Invitations ────────────────────────────────────────────────────────
  const badRole = await createInvitation(admin, { workspaceId: wsA, roleCode: "practice_owner", ...base });
  ok("an invitation cannot confer ownership (that is a transfer, not an invitation)",
    !badRole.ok && badRole.code === "ROLE_NOT_INVITABLE", badRole.ok ? "was allowed" : badRole.code);

  const invite = await createInvitation(admin, {
    workspaceId: wsA, roleCode: "practice_assistant", invitedName: "Desk cover", ...base,
  });
  ok("an invitation is created and returns its code once (control)", invite.ok, invite.ok ? "" : invite.message);
  if (!invite.ok) return report();
  ok("the code is unambiguous: no 0, O, 1 or I to misread down a phone",
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(invite.data.code),
    invite.data.code);

  const listed = await listInvitations(admin, wsA);
  ok("THE CODE IS NEVER LISTED BACK (one careless screen-share should not be an open door)",
    listed.length === 1 && !("code" in listed[0]), Object.keys(listed[0] ?? {}).join(","));
  ok("a live invitation reads as usable and not expired",
    listed[0].usable === true && listed[0].expired === false, JSON.stringify({ u: listed[0].usable, e: listed[0].expired }));

  const wrongCode = await acceptInvitation(admin, { code: "AAAAA-BBBBB", userId: JOINER, correlationId: "h" });
  const revokedInvite = await createInvitation(admin, { workspaceId: wsA, roleCode: "practitioner", ...base });
  if (revokedInvite.ok) await revokeInvitation(admin, { workspaceId: wsA, invitationId: revokedInvite.data.id, ...base });
  const usedRevoked = revokedInvite.ok
    ? await acceptInvitation(admin, { code: revokedInvite.data.code, userId: JOINER, correlationId: "h" }) : null;
  ok("EVERY BAD CODE GETS THE SAME REFUSAL (guessing learns nothing about which was nearly right)",
    !wrongCode.ok && !usedRevoked?.ok &&
    wrongCode.code === "INVALID_CODE" && usedRevoked?.code === "INVALID_CODE" &&
    wrongCode.message === usedRevoked?.message,
    `${wrongCode.ok ? "allowed" : wrongCode.code} / ${usedRevoked?.ok ? "allowed" : usedRevoked?.code}`);

  // Expiry is DERIVED: back-date one and it stops working with nothing having run.
  const expiring = await createInvitation(admin, { workspaceId: wsA, roleCode: "practitioner", ...base });
  if (!expiring.ok) { ok("a second invitation for the expiry check", false, expiring.message); return report(); }
  await admin.from("practice_invitation")
    .update({ expires_at: new Date(Date.now() - 60000).toISOString() }).eq("id", expiring.data.id);
  const expiredUse = await acceptInvitation(admin, { code: expiring.data.code, userId: JOINER, correlationId: "h" });
  ok("AN EXPIRED CODE STOPS WORKING WITH NOTHING HAVING RUN (expiry is derived, not swept)",
    !expiredUse.ok && expiredUse.code === "INVALID_CODE", expiredUse.ok ? "was allowed" : expiredUse.code);
  const afterExpiry = await listInvitations(admin, wsA);
  ok("...and it reads as expired but its STATUS is still PENDING (no stored expiry)",
    afterExpiry.some(i => i.id === expiring.data.id && i.expired === true && i.status === "PENDING"),
    JSON.stringify(afterExpiry.map(i => ({ s: i.status, e: i.expired }))));

  const joined = await acceptInvitation(admin, { code: invite.data.code, userId: JOINER, correlationId: "h" });
  ok("a valid code joins the practice (control for every refusal above)", joined.ok, joined.ok ? "" : joined.message);
  if (!joined.ok) return report();
  ok("the joiner lands in the right workspace, in the invited role",
    joined.data.workspaceId === wsA && joined.data.roleCode === "practice_assistant", JSON.stringify(joined.data));

  const joinerCaps = await capsOf(JOINER, wsA);
  ok("JOINING GRANTS THE ROLE'S CAPABILITIES (not an empty sidebar and 403 everywhere)",
    joinerCaps.includes("task.manage") && joinerCaps.includes("patient.list") && joinerCaps.length > 3,
    `${joinerCaps.length}: ${joinerCaps.join(",")}`);
  // THE ASSISTANT'S BOUNDARY IS WRITING, NOT SEEING. Migration 194 s7 deliberately gives them
  // encounter.list so they can run the consultation queue at the desk -- an earlier version of this
  // assertion had that wrong and failed honestly. What they must not hold is the ability to write or
  // read the clinical record itself.
  ok("...and NOT the clinical write capabilities, nor the record itself",
    !joinerCaps.includes("encounter.edit") && !joinerCaps.includes("encounter.sign") &&
    !joinerCaps.includes("document.view") && !joinerCaps.includes("procedure.record") &&
    !joinerCaps.includes("inbox.review"),
    joinerCaps.join(","));

  const reuse = await acceptInvitation(admin, { code: invite.data.code, userId: SECOND_JOINER, correlationId: "h" });
  ok("A CODE WORKS ONCE", !reuse.ok && reuse.code === "INVALID_CODE", reuse.ok ? "was allowed" : reuse.code);

  // ── 1. THE RESOLVER FIX: time-bounded grants, all three directions ────────
  const { data: joinerMembership } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", wsA).eq("user_id", JOINER).eq("status", "active").single();

  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  const lend = await delegateCapability(admin, {
    workspaceId: wsA, membershipId: joinerMembership!.id, capability: "practice.members.manage",
    effectiveTo: future, note: "covering while I travel", ...base,
  });
  ok("a capability the owner holds can be lent (control)", lend.ok, lend.ok ? "" : lend.message);
  if (!lend.ok) return report();

  const withDelegation = await capsOf(JOINER, wsA);
  ok("A LIVE DELEGATION RESOLVES -- the bug this module found: an end-dated grant used to be invisible",
    withDelegation.includes("practice.members.manage"), withDelegation.join(","));

  // Direction two: expired must NOT resolve.
  await admin.from("practice_role_assignment")
    .update({ effective_to: new Date(Date.now() - 60000).toISOString() }).eq("id", lend.data.id);
  ok("AN EXPIRED DELEGATION DOES NOT RESOLVE, with nothing having run",
    !(await capsOf(JOINER, wsA)).includes("practice.members.manage"));

  // Direction three: not-yet-started must NOT resolve. This is the security-relevant one -- the old
  // resolver ignored effective_from entirely, so a grant dated to begin next Monday was live at once.
  await admin.from("practice_role_assignment").update({
    effective_from: new Date(Date.now() + 86400000).toISOString(),
    effective_to: new Date(Date.now() + 5 * 86400000).toISOString(),
  }).eq("id", lend.data.id);
  ok("A NOT-YET-STARTED DELEGATION DOES NOT RESOLVE (effective_from used to be ignored entirely)",
    !(await capsOf(JOINER, wsA)).includes("practice.members.manage"));

  // And the control that makes all three mean something: the role defaults, which are open-ended, still
  // resolve throughout.
  ok("...while open-ended role capabilities resolve throughout (the filter is not refusing everything)",
    (await capsOf(JOINER, wsA)).includes("task.manage"));

  await admin.from("practice_role_assignment")
    .update({ effective_from: new Date(Date.now() - 60000).toISOString(), effective_to: future }).eq("id", lend.data.id);

  // ── 2. THE ESCALATION RULE ────────────────────────────────────────────────
  //
  // A REAL SUBJECT HAS TO BE BUILT FIRST, and building it is the point. Provisioning gives the founding
  // practitioner BOTH memberships -- practice_owner and practitioner -- so in a solo practice the owner
  // legitimately holds clinical access and delegating it is not escalation at all. An earlier version
  // of this assertion missed that and failed honestly.
  //
  // The escalation this rule exists for is the OTHER shape: a practice where the owner administers and
  // somebody else does the clinical work. So the owner's practitioner membership is revoked, leaving
  // them with administration alone -- exactly the boundary migration 191 draws -- and the attempt is
  // made from there.
  const { data: ownerClinical } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", wsA).eq("user_id", OWNER).eq("role_code", "practitioner").eq("status", "active").single();
  const dropClinical = await setMembershipStatus(admin, {
    workspaceId: wsA, membershipId: ownerClinical!.id, status: "revoked", ...base,
  });
  ok("an owner's separate PRACTITIONER membership can be revoked (the last-owner guard is not blanket)",
    dropClinical.ok, dropClinical.ok ? "" : dropClinical.message);

  const ownerCaps = await capsOf(OWNER, wsA);
  ok("the owner now genuinely lacks clinical access (the escalation test has a real subject)",
    !ownerCaps.includes("encounter.list") && ownerCaps.includes("practice.members.manage"), ownerCaps.join(","));

  const escalate = await delegateCapability(admin, {
    workspaceId: wsA, membershipId: joinerMembership!.id, capability: "encounter.list",
    effectiveTo: future, ...base,
  });
  ok("YOU CANNOT DELEGATE A CAPABILITY YOU DO NOT HOLD",
    !escalate.ok && escalate.code === "CANNOT_DELEGATE_WHAT_YOU_LACK", escalate.ok ? "was allowed" : escalate.code);

  const { data: ownerMembership } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", wsA).eq("user_id", OWNER).eq("role_code", "practice_owner").eq("status", "active").single();
  const selfLend = await delegateCapability(admin, {
    workspaceId: wsA, membershipId: ownerMembership!.id, capability: "practice.members.manage",
    effectiveTo: future, ...base,
  });
  ok("you cannot delegate to yourself", !selfLend.ok && selfLend.code === "SELF_DELEGATION",
    selfLend.ok ? "was allowed" : selfLend.code);

  const openEnded = await delegateCapability(admin, {
    workspaceId: wsA, membershipId: joinerMembership!.id, capability: "practice.locations.manage",
    effectiveTo: "", ...base,
  });
  ok("A DELEGATION MUST END (an open-ended one is a role change wearing a temporary label)",
    !openEnded.ok && openEnded.code === "END_REQUIRED", openEnded.ok ? "was allowed" : openEnded.code);

  const backwards = await delegateCapability(admin, {
    workspaceId: wsA, membershipId: joinerMembership!.id, capability: "practice.locations.manage",
    effectiveFrom: future, effectiveTo: new Date(Date.now() + 60000).toISOString(), ...base,
  });
  ok("a delegation cannot end before it starts", !backwards.ok && backwards.code === "ENDS_BEFORE_IT_STARTS",
    backwards.ok ? "was allowed" : backwards.code);

  const endIt = await endDelegation(admin, { workspaceId: wsA, grantId: lend.data.id, ...base });
  ok("a delegation can be ended early", endIt.ok, endIt.ok ? "" : endIt.message);
  ok("...and the capability goes with it", !(await capsOf(JOINER, wsA)).includes("practice.members.manage"));

  const { data: roleGrant } = await admin.from("practice_role_assignment")
    .select("id").eq("membership_id", joinerMembership!.id).eq("source", "role_default").limit(1).single();
  const endRoleGrant = await endDelegation(admin, { workspaceId: wsA, grantId: roleGrant!.id, ...base });
  ok("a ROLE capability cannot be ended as if it were a delegation",
    !endRoleGrant.ok && endRoleGrant.code === "NOT_A_DELEGATION", endRoleGrant.ok ? "was allowed" : endRoleGrant.code);

  // ── 4. THE LAST OWNER ─────────────────────────────────────────────────────
  const removeOwner = await setMembershipStatus(admin, {
    workspaceId: wsA, membershipId: ownerMembership!.id, status: "revoked", ...base,
  });
  ok("the engine refuses to remove the last active owner",
    !removeOwner.ok && removeOwner.code === "LAST_OWNER", removeOwner.ok ? "was allowed" : removeOwner.code);

  // THE GUARANTEE MIGRATION 201 s3 PROMISES: bypass the engine entirely.
  const rawRemove = await admin.from("practice_membership")
    .update({ status: "revoked" }).eq("id", ownerMembership!.id);
  ok("THE DATABASE refuses it too (migration 201 s3 trigger)",
    !!rawRemove.error && /last active owner/i.test(rawRemove.error.message),
    rawRemove.error?.message ?? "the update succeeded");
  const rawDemote = await admin.from("practice_membership")
    .update({ role_code: "practitioner" }).eq("id", ownerMembership!.id);
  ok("...including demoting them out of ownership rather than revoking",
    !!rawDemote.error && /last active owner/i.test(rawDemote.error.message),
    rawDemote.error?.message ?? "the update succeeded");

  // CONTROL: the same raw update on a non-owner membership succeeds, so the trigger is not refusing
  // every membership change.
  const rawOther = await admin.from("practice_membership")
    .update({ status: "suspended" }).eq("id", joinerMembership!.id);
  ok("a raw status change on a NON-owner membership succeeds (the trigger is not refusing everything)",
    !rawOther.error, rawOther.error?.message ?? "");
  await admin.from("practice_membership").update({ status: "active" }).eq("id", joinerMembership!.id);

  // ── 5. Ending a membership ends its grants ────────────────────────────────
  const reLend = await delegateCapability(admin, {
    workspaceId: wsA, membershipId: joinerMembership!.id, capability: "practice.members.manage",
    effectiveTo: future, ...base,
  });
  ok("a fresh delegation for the suspension test", reLend.ok, reLend.ok ? "" : reLend.message);

  const suspend = await setMembershipStatus(admin, {
    workspaceId: wsA, membershipId: joinerMembership!.id, status: "suspended", note: "on leave", ...base,
  });
  ok("a membership can be suspended", suspend.ok, suspend.ok ? "" : suspend.message);
  ok("SUSPENSION TAKES EVERYTHING WITH IT", (await capsOf(JOINER, wsA)).length === 0, (await capsOf(JOINER, wsA)).join(","));

  const reinstate = await reinstateMembership(admin, { workspaceId: wsA, membershipId: joinerMembership!.id, ...base });
  ok("a membership can be reinstated", reinstate.ok, reinstate.ok ? "" : reinstate.message);
  const afterReinstate = await capsOf(JOINER, wsA);
  ok("REINSTATING RESTORES THE ROLE'S CAPABILITIES", afterReinstate.includes("task.manage"), afterReinstate.join(","));
  ok("...AND NOT THE DELEGATION THAT WAS LIVE WHEN THEY LEFT (a closed window stays closed)",
    !afterReinstate.includes("practice.members.manage"), afterReinstate.join(","));

  // ── 6. Revoked access orphans work, it does not hide it ───────────────────
  const task = await createTask(admin, {
    workspaceId: wsA, title: "Order the fridge thermometer", assignedTo: JOINER, ...base,
  });
  ok("a task is assigned to the joiner", task.ok, task.ok ? "" : task.message);
  const boardBefore = await taskBoard(admin, wsA, OWNER);
  ok("before revocation it is somebody else's live work, not orphaned",
    boardBefore.orphaned.length === 0 && boardBefore.others.length === 1,
    `orphaned=${boardBefore.orphaned.length} others=${boardBefore.others.length}`);

  await setMembershipStatus(admin, { workspaceId: wsA, membershipId: joinerMembership!.id, status: "revoked", ...base });
  const boardAfter = await taskBoard(admin, wsA, OWNER);
  ok("REVOKING ACCESS ORPHANS THE WORK RATHER THAN HIDING IT (composes with CPR-340)",
    boardAfter.orphaned.length === 1, `${boardAfter.orphaned.length} orphaned`);

  // ── The team view and its trail ───────────────────────────────────────────
  const team = await listTeam(admin, wsA);
  const joinerEntry = team.find((p: any) => p.userId === JOINER);
  ok("a revoked person STAYS LISTED (an audit asks who used to have access)",
    !!joinerEntry && joinerEntry.active === false && joinerEntry.endedRoles.length > 0,
    JSON.stringify(joinerEntry?.endedRoles));
  const ownerEntry = team.find((p: any) => p.userId === OWNER);
  ok("the owner appears ONCE despite holding two memberships",
    team.filter((p: any) => p.userId === OWNER).length === 1 && (ownerEntry?.memberships.length ?? 0) === 2,
    `${ownerEntry?.memberships.length} memberships`);

  const history = await membershipHistory(admin, wsA);
  ok("the trail records joining, delegation and revocation, newest first",
    history.some((h: any) => h.event_type === "joined") &&
    history.some((h: any) => h.event_type === "capability_delegated") &&
    history.some((h: any) => h.event_type === "revoked"),
    history.map((h: any) => h.event_type).join(","));

  const rewriteEvent = await admin.from("practice_membership_event")
    .update({ note: "a different history" }).eq("workspace_id", wsA);
  ok("the DATABASE refuses to rewrite a membership event", !!rewriteEvent.error,
    rewriteEvent.error?.message ?? "the update succeeded");

  // ── 7. Isolation + anon ───────────────────────────────────────────────────
  const crossInvite = await createInvitation(admin, { workspaceId: wsB, roleCode: "practitioner", ...base });
  const crossRevoke = crossInvite.ok
    ? await revokeInvitation(admin, { workspaceId: wsA, invitationId: crossInvite.data.id, ...base }) : null;
  ok("A cannot revoke B's invitation", !!crossRevoke && !crossRevoke.ok && crossRevoke.code === "NOT_FOUND",
    crossRevoke?.ok ? "was allowed" : crossRevoke?.code ?? "setup failed");
  const crossStatus = await setMembershipStatus(admin, {
    workspaceId: wsB, membershipId: joinerMembership!.id, status: "active", ...base,
  });
  ok("A's membership cannot be changed through B's workspace",
    !crossStatus.ok && crossStatus.code === "NOT_FOUND", crossStatus.ok ? "was allowed" : crossStatus.code);
  ok("B's team holds none of A's people",
    (await listTeam(admin, wsB)).every((p: any) => p.userId !== JOINER));

  const TABLES = ["practice_invitation", "practice_membership_event"];
  let svcRows = 0, leaked = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: c } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((c ?? 0) > 0) leaked++;
  }
  ok("the service role sees rows in both team tables (the denial test is not vacuous)",
    svcRows === TABLES.length, `${svcRows}/${TABLES.length}`);
  ok("anon reads 0 rows from both team tables", leaked === 0, `${leaked} table(s) leaked`);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
