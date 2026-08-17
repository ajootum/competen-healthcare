/**
 * PRACTITIONER IDENTITY PUBLICATION -- PIS-000 s6, s7, s10; CPB-002's sharing workspace.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *
 * Three gates stand between an issued identity and a booking address that opens: a claimed handle, a
 * discovery mode off `hidden`, and a lifecycle state resolveHandle will serve. The handle had a screen.
 * The other two had complete, tested engines and NOT ONE CALLER anywhere in the product -- so every
 * identity in this deployment sat `created` and `hidden`, and no public booking address could ever
 * resolve for anybody.
 *
 * ⚠ AND THE SHARE SHEET DID NOT KNOW THAT. identitySetupView populated `sharing` on `if (row.handle)`
 * alone, so the moment a handle was claimed the console offered a QR code, a print button and WhatsApp,
 * Facebook and LinkedIn links for a URL resolveHandle refuses. A screen showing a dead link is fixed by
 * a deploy. A box of printed cards is not.
 *
 * WHAT IT PROVES:
 *   0. The email signal is READ, and every way of failing to read it refuses.
 *   1. resolveHandle has three states, and a failed read is `unreadable` rather than "no such person".
 *   2. ⚠ THE SHARE SHEET IS GATED ON resolveHandle'S OWN ANSWER, not on a copy of its conditions -- with
 *      a drift control that a copy would fail.
 *   3. Publishing walks the lifecycle in order, reaches `active` and NEVER `licence_verified`.
 *   4. Discovery goes off as reliably as it goes on -- including when publishing would be refused.
 *   5. The s6 profile fields reach the page a patient reads, and nothing else does.
 *   6. The endpoint's subject is the caller, and no body can name a lifecycle state.
 *
 * ⚠ EVERY ASSERTION HERE WAS PROVEN ABLE TO FAIL: a deliberate break was applied to the code it guards,
 * the run went red, the file was restored byte-for-byte and the run went green again. Fourteen breaks,
 * listed in the build report. ~30 vacuous assertions have been found in this codebase, several of them
 * passing loudest when the rule they guarded had been deleted.
 *
 *   npx --yes tsx scripts/practice-identity-publication-harness.ts
 *
 * ⚠ RUN IT ALONE. Concurrent harness runs produce phantom MEMBERSHIP_CREATE_FAILED / CAPABILITY_GRANT_FAILED.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  issueIdentity, getIdentity, claimHandle, updateIdentity, publishIdentity, resolveHandle,
  identitySetupView, authEmailConfirmation, bookingUrl,
  DISCOVERY_MODES, PUBLICATION_NOTICE, RESOLVABLE_STATES, NOT_SELF_PUBLISHABLE,
} from "../src/lib/practice/identity-service";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

/* eslint-disable @typescript-eslint/no-explicit-any */

// The reserved .test TLD, so no real inbox can ever receive or hijack anything addressed to these.
const CONFIRMED_EMAIL = "pub-harness-confirmed@competen.test";
const UNCONFIRMED_EMAIL = "pub-harness-unconfirmed@competen.test";
/** A second publishable practitioner, so "the subject is the caller" has something to be stolen. */
const THIRD_EMAIL = "pub-harness-third@competen.test";
const HANDLE_P = "pubharnessone";
const HANDLE_U = "pubharnesstwo";
const HANDLE_T = "pubharnessthree";
const CORR = "harness-publication";
/**
 * A well-formed uuid that is not, and will not become, an auth user.
 *
 * ⚠ WELL-FORMED MATTERS. auth-js rejects a malformed id before it ever reaches the directory, which
 * surfaces as `unreadable` -- a true answer to a different question, and one that would have let 0c pass
 * without ever exercising the not-found branch it exists to check.
 */
const NO_SUCH_USER = "00000000-0000-4000-8000-0000000deadb";

const ROUTE = resolve(process.cwd(), "src/app/api/v1/practice/identity/route.ts");
const CONSOLE = resolve(process.cwd(), "src/app/practice/(shell)/setup/identity/BookingAddressConsole.tsx");

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);
const report = () => {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`    FAILED: ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
};

/**
 * ⚠ A CLIENT THAT CANNOT READ. Not a mock of the engine -- a mock of a DATABASE HAVING A BAD DAY, which
 * is the only way to exercise the branch that used to answer "there is no such practitioner" when the
 * truth was "nobody asked the table successfully".
 */
const unreadableDb: any = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "simulated read failure" } }) }) }),
  }),
};
const unreadableDirectory: any = {
  auth: { admin: { getUserById: async () => { throw new Error("simulated directory failure"); } } },
};

/**
 * Strip comments, so an assertion about what the code does is not defeated by a comment explaining it.
 *
 * ⚠ CRUDE ON PURPOSE, AND SAFE FOR THESE TWO FILES. It would mangle a string literal containing `//`;
 * neither the route nor the console holds one, and the control below asserts the output is still real
 * code rather than trusting that.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Walk a payload and return every value that is a function. */
function functionsIn(value: unknown, path = "$"): string[] {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => functionsIn(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => functionsIn(v, `${path}.${k}`));
  return [];
}

async function findAuthUser(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    // ⚠ A FAILED DIRECTORY READ IS NOT "NO SUCH USER". Returning null here would make the cleanup below
    // silently skip a leaked fixture and the create below fail on a duplicate email.
    if (error) throw new Error(`the auth directory could not be listed: ${error.message}`);
    const hit = (data?.users ?? []).find(u => u.email === email);
    if (hit) return hit.id;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

async function makeUser(email: string, confirmed: boolean): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: `Harness!${Math.random().toString(36).slice(2)}Aa1`, email_confirm: confirmed,
  });
  if (error || !data?.user) throw new Error(`could not create ${email}: ${error?.message ?? "no user"}`);
  return data.user.id;
}

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pub-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

/**
 * ⚠ THE IDENTITY ROW IS DELETED, WHICH IS WHAT PUTS THE HANDLE BACK.
 *
 * claimHandle writes NO history row -- only changeHandle retires a name into practice_handle_history,
 * where it stays claimed for ever so printed codes keep working. So this harness claims and never
 * changes, and deleting the row genuinely frees @pubharnessone for the next run. The history delete
 * below is a belt-and-braces for a future edit that starts changing handles; it is not load-bearing today.
 */
async function cleanup() {
  const ids = (await Promise.all(
    [CONFIRMED_EMAIL, UNCONFIRMED_EMAIL, THIRD_EMAIL].map(e => findAuthUser(e)),
  )).filter(Boolean) as string[];
  for (const id of ids) {
    const { data: ident } = await admin.from("practice_practitioner_identity").select("id").eq("user_id", id);
    for (const i of (ident ?? []) as any[])
      await admin.from("practice_handle_history").delete().eq("identity_id", i.id);
    await admin.from("practice_practitioner_identity").delete().eq("user_id", id);
  }
  // ⚠ The workspace teardown lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause and REPORTS a failure rather than discarding
  // it. The old inline pattern threw the delete's error away and leaked workspaces.
  if (ids.length > 0) await purgeWorkspacesOwnedBy(admin, ids);
  for (const id of ids) {
    await admin.from("profiles").delete().eq("id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log(`  cleanup: auth user ${id} could not be deleted -- ${error.message}`);
  }
}

async function main() {
  console.log("\nPractitioner identity publication (PIS-000 s6, s7, s10; CPB-002)\n");
  await cleanup();

  const routeSource = readFileSync(ROUTE, "utf8");
  const routeCode = codeOnly(routeSource);
  const consoleSource = codeOnly(readFileSync(CONSOLE, "utf8"));

  const userP = await makeUser(CONFIRMED_EMAIL, true);
  const userU = await makeUser(UNCONFIRMED_EMAIL, false);
  const userT = await makeUser(THIRD_EMAIL, true);
  const wsP = await provision(userP, "Dr Publication Harness");
  const issuedU = await issueIdentity(admin, {
    userId: userU, displayName: "Dr Unconfirmed Harness", workspaceId: null, correlationId: CORR,
  });
  const issuedT = await issueIdentity(admin, {
    userId: userT, displayName: "Dr Third Harness", workspaceId: null, correlationId: CORR,
  });
  const claimedT = await claimHandle(admin, { userId: userT, handle: HANDLE_T, correlationId: CORR });
  ok("fixture-control. three identities exist: a confirmed sign-in, an unconfirmed one, and a second confirmed practitioner who has a handle and has NOT published -- the one 6e checks nobody can publish on their behalf",
    (await getIdentity(admin, userP)) !== null && issuedU.ok && issuedT.ok && claimedT.ok,
    issuedU.ok ? (issuedT.ok ? (claimedT.ok ? "" : (claimedT as any).message) : (issuedT as any).message) : (issuedU as any).message);
  if (!issuedU.ok || !issuedT.ok || !claimedT.ok) { await cleanup(); return report(); }

  // ══ 0. THE EMAIL SIGNAL ═══════════════════════════════════════════════════════════════════════
  section("0. email_verified is derived, never asserted");

  const emailP = await authEmailConfirmation(admin, userP);
  ok("0a-control. a confirmed sign-in reads as confirmed, with the time it happened -- so 0b is a discrimination and not a constant",
    emailP.state === "confirmed" && !!emailP.confirmedAt, JSON.stringify(emailP));

  const emailU = await authEmailConfirmation(admin, userU);
  ok("0b. ⚠ AN UNCONFIRMED SIGN-IN READS AS UNCONFIRMED. This is the whole reason there is no 'yes, my email is verified' button: the state means somebody checked, and the person being checked cannot be the one who says so",
    emailU.state === "unconfirmed" && emailU.confirmedAt === null && !!emailU.reason,
    JSON.stringify(emailU));

  const emailMissing = await authEmailConfirmation(admin, NO_SUCH_USER);
  ok("0c. a user id with no sign-in account reads as no_account -- never as confirmed",
    emailMissing.state === "no_account", JSON.stringify(emailMissing));

  const emailBroken = await authEmailConfirmation(unreadableDirectory, userP);
  ok("0d. ⚠ AND A DIRECTORY THAT WILL NOT ANSWER IS `unreadable`, NOT `unconfirmed`. Both refuse, but only one of them is a statement about the practitioner's own account, and sending somebody off to fix an email that is fine is its own harm",
    emailBroken.state === "unreadable" && /simulated directory failure/.test(emailBroken.reason ?? ""),
    JSON.stringify(emailBroken));

  // ══ 1. THE RESOLVER'S THREE STATES ════════════════════════════════════════════════════════════
  section("1. resolveHandle answers in three states");

  const claimed = await claimHandle(admin, { userId: userP, handle: HANDLE_P, correlationId: CORR });
  ok("1-control. the handle was claimed, so everything below is about a real address rather than an absent one",
    claimed.ok && (claimed as any).data.bookingUrl === bookingUrl(HANDLE_P),
    claimed.ok ? "" : (claimed as any).message);
  if (!claimed.ok) { await cleanup(); return report(); }

  const freshRow = await getIdentity(admin, userP);
  ok("1a. ⚠ A CLAIMED HANDLE DOES NOT OPEN. The identity is `created` and `hidden`, which is where all 32 identities in this deployment sit -- so this is the state every practitioner who ever claimed one has actually been in",
    freshRow.status === "created" && freshRow.discovery === "hidden"
    && (await resolveHandle(admin, HANDLE_P)).kind === "none",
    JSON.stringify({ s: freshRow.status, d: freshRow.discovery }));

  const brokenResolve = await resolveHandle(unreadableDb, HANDLE_P);
  ok("1b. ⚠ A FAILED READ IS `unreadable`, AND IT USED TO BE `none`. All three queries destructured only `data`, so a database that could not answer served a 404 for a live, published clinician to a patient holding their card",
    brokenResolve.kind === "unreadable"
    && /simulated read failure/.test((brokenResolve as any).reason ?? ""),
    JSON.stringify(brokenResolve));

  ok("1c-control. and the same call against the real database is NOT unreadable, so 1b is about the failure and not about the call",
    (await resolveHandle(admin, HANDLE_P)).kind !== "unreadable");

  // ══ 2. THE SHARING HONESTY GATE ═══════════════════════════════════════════════════════════════
  section("2. the share sheet is gated on the resolver's own answer");

  const hiddenView = await identitySetupView(admin, { userId: userP, workspaceId: wsP });
  ok("2a. ⚠ NO SHARE SHEET FOR AN ADDRESS THAT DOES NOT OPEN. This is the defect: `sharing` was populated on `if (row.handle)` alone, so a claimed handle produced a QR code, a print button and WhatsApp, Facebook and LinkedIn links for a URL the resolver refuses",
    hiddenView.state === "claimed" && hiddenView.sharing === null
    && hiddenView.address.state === "does_not_resolve",
    JSON.stringify({ state: hiddenView.state, sharing: hiddenView.sharing !== null, address: hiddenView.address.state }));

  ok("2b. and the screen is told what is actually standing in the way, in facts about this identity rather than a shrug",
    hiddenView.address.remaining.length === 2
    && hiddenView.address.remaining.some(r => /hidden/i.test(r))
    && hiddenView.address.remaining.some(r => /created/i.test(r)),
    JSON.stringify(hiddenView.address.remaining));

  // ⚠ THE DRIFT CONTROL, AND IT IS THE MOST IMPORTANT ASSERTION IN THIS FILE.
  //
  // The obvious implementation of the gate is `discovery !== "hidden" && status === "active"`, and it
  // would pass every other assertion here. It is wrong for exactly one state: RESOLVABLE_STATES also
  // holds `licence_verified`, which reaches the public without ever being `active`. A copy of the
  // resolver's conditions would withhold the share sheet from a practitioner whose page is live -- and
  // the day RESOLVABLE_STATES gains a state, the copy would go on being wrong silently.
  await admin.from("practice_practitioner_identity")
    .update({ status: "licence_verified", discovery: "link_only" }).eq("user_id", userP);
  const licencedView = await identitySetupView(admin, { userId: userP, workspaceId: wsP });
  ok("2c. ⚠ AND THE GATE IS resolveHandle ITSELF, NOT A COPY OF ITS CONDITIONS. `licence_verified` + link_only opens without ever being `active`, so a hand-written `status === 'active'` check would withhold the share sheet from a live page -- and would keep doing so silently the day RESOLVABLE_STATES changes",
    licencedView.sharing !== null && licencedView.address.state === "resolves"
    && RESOLVABLE_STATES.has("licence_verified"),
    JSON.stringify({ sharing: licencedView.sharing !== null, address: licencedView.address.state }));

  // Put it back to the state a real practitioner is in before publishing.
  await admin.from("practice_practitioner_identity")
    .update({ status: "created", discovery: "hidden" }).eq("user_id", userP);

  ok("2d. the view's payload carries no functions -- a method on it type-checks, passes eslint, passes this file and kills the page at runtime",
    functionsIn(hiddenView).length === 0, functionsIn(hiddenView).join(", "));

  ok("2e. the console renders the payload's sharing workspace and never builds one of its own, so there is no branch in the screen that can put a dead share sheet back",
    /view\.sharing &&/.test(consoleSource) && !/identitySharing|shareTargets|bookingQr/.test(consoleSource),
    "the console composes its own sharing payload");

  ok("2f. and it shows the engine's own publication notice rather than a paraphrase that can drift out of true",
    /view\.publicationNotice/.test(consoleSource)
    && /publishes|search/i.test(PUBLICATION_NOTICE) && PUBLICATION_NOTICE.length > 200,
    `${PUBLICATION_NOTICE.length} chars`);

  // ══ 3. PUBLISHING ═════════════════════════════════════════════════════════════════════════════
  section("3. publishing walks the lifecycle, and never through licence_verified");

  const noHandle = await publishIdentity(admin, { userId: userU, discovery: "link_only", correlationId: CORR });
  ok("3a. publishing with no handle is refused -- a discovery setting on an identity with no address gives a patient nothing to open",
    !noHandle.ok && (noHandle as any).code === "NO_HANDLE",
    noHandle.ok ? "it published" : (noHandle as any).code);

  const toHidden = await publishIdentity(admin, { userId: userP, discovery: "hidden", correlationId: CORR });
  ok("3b. publishing to `hidden` is refused rather than accepted -- it would run every lifecycle step and then leave the address shut, and report success for both",
    !toHidden.ok && (toHidden as any).code === "DISCOVERY_IS_HIDDEN",
    toHidden.ok ? "it published" : (toHidden as any).code);

  const claimedU = await claimHandle(admin, { userId: userU, handle: HANDLE_U, correlationId: CORR });
  ok("3c-control. the unconfirmed practitioner claims a handle too, so 3d is about their email and not about a missing address",
    claimedU.ok, claimedU.ok ? "" : (claimedU as any).message);

  const unconfirmedPublish = await publishIdentity(admin, { userId: userU, discovery: "link_only", correlationId: CORR });
  const rowUAfter = await getIdentity(admin, userU);
  ok("3d. ⚠ AN UNCONFIRMED SIGN-IN EMAIL CANNOT BECOME `email_verified`. Refused, with the row STILL `created` afterwards -- so this is a write that did not happen rather than an error message over one that did",
    !unconfirmedPublish.ok && (unconfirmedPublish as any).code === "EMAIL_NOT_CONFIRMED"
    && rowUAfter.status === "created"
    && (unconfirmedPublish as any).completed.length === 0,
    JSON.stringify({ code: (unconfirmedPublish as any).code, status: rowUAfter.status }));

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠ PUBLISHED WITH NO PRIMARY WORKSPACE, WHICH IS THE STATE 31 OF THE 33 LIVE IDENTITIES ARE IN.
  //
  // `primary_workspace_id` is null on all but two identities in this deployment, so a publication path
  // that needed it would work for two people and silently fail for everybody else. It is nulled here
  // before the one end-to-end publish in this file, so that assertion is made in the majority state
  // rather than the lucky one.
  //
  // ⚠ AND IT MUST STILL BE NULL AFTERWARDS. updateIdentity accepts `primaryWorkspaceId`, so having
  // publish quietly fill it in is one line away -- and an identity's workspace being assigned by
  // whoever happened to press a button is precisely the implicit write this codebase has been bitten
  // by. Whose workspace an identity belongs to is provisioning's decision, not publication's.
  // ────────────────────────────────────────────────────────────────────────────────────────────────
  await admin.from("practice_practitioner_identity")
    .update({ primary_workspace_id: null }).eq("user_id", userP);
  const published = await publishIdentity(admin, { userId: userP, discovery: "link_only", correlationId: CORR });
  ok("3e-control. ⚠ AND THE SAME CALL FOR A CONFIRMED SIGN-IN WORKS, END TO END: the address a patient would type now RESOLVES, which no address in this deployment has ever done",
    published.ok && (published as any).data.address === "resolves"
    && (await resolveHandle(admin, HANDLE_P)).kind === "found",
    published.ok ? JSON.stringify((published as any).data.address) : (published as any).message);
  if (!published.ok) { await cleanup(); return report(); }

  ok("3f. and it reports the steps it performed, in order",
    published.data.completed.join(",") === "email_confirmed,email_verified,active,discovery",
    JSON.stringify(published.data.completed));

  const afterPublish = await getIdentity(admin, userP);
  ok("3g. ⚠ THE LIFECYCLE LANDS ON `active` AND STEPS AROUND `licence_verified` ENTIRELY. s10 allows email_verified -> licence_verified, and transitionIdentity writes licence_verified_by = the actor -- so a practitioner-facing path through it would let a clinician record that somebody checked their licence on their own say-so, into a column the rest of the product reads as provenance",
    afterPublish.status === "active"
    && afterPublish.licence_verified_at === null && afterPublish.licence_verified_by === null
    && afterPublish.licence_reference === null,
    JSON.stringify({ s: afterPublish.status, by: afterPublish.licence_verified_by }));

  ok("3g-workspace. ⚠ NONE OF THIS NEEDED A PRIMARY WORKSPACE, AND PUBLISHING DID NOT QUIETLY SET ONE. The identity that just went live still has primary_workspace_id null -- so the 31 of 33 live identities with no workspace pointer are not blocked from publishing, and whose practice an identity belongs to stays provisioning's decision rather than a side effect of pressing a button",
    afterPublish.primary_workspace_id === null,
    String(afterPublish.primary_workspace_id));

  const { data: auditRows, error: auditError } = await admin.from("practice_audit_event")
    .select("event_type, workspace_id").eq("actor_id", userP).eq("event_type", "practice.identity_published");
  ok("3g-audit. and the publication was still recorded, against a null workspace rather than not at all -- an audit row that cannot be written is how a lifecycle change becomes untraceable",
    !auditError && (auditRows ?? []).length === 1 && (auditRows as any[])[0].workspace_id === null,
    auditError?.message ?? JSON.stringify(auditRows));

  const openView = await identitySetupView(admin, { userId: userP, workspaceId: wsP });
  ok("3h-control. NOW the share sheet appears, and it carries the one composition of the booking link -- so 2a is a gate that opens rather than a section somebody deleted",
    openView.sharing !== null && openView.sharing!.url === bookingUrl(HANDLE_P)
    && openView.address.state === "resolves" && openView.address.remaining.length === 0,
    JSON.stringify({ sharing: openView.sharing !== null, address: openView.address.state }));

  const again = await publishIdentity(admin, { userId: userP, discovery: "link_only", correlationId: CORR });
  // ⚠ `email_confirmed` IS IN `completed` ON EVERY RUN, AND THAT IS CORRECT RATHER THAN A LEFTOVER. It is
  // the one step that is a CHECK rather than a write: the directory really was asked again, this time,
  // and reporting it as "already true" would claim a stale answer had been reused.
  ok("3i. publishing an already-published identity says what was already true instead of pretending to have done it",
    again.ok && (again as any).data.completed.join(",") === "email_confirmed"
    && (again as any).data.alreadyTrue.join(",") === "email_verified,active,discovery",
    again.ok ? JSON.stringify((again as any).data) : (again as any).message);

  await admin.from("practice_practitioner_identity").update({ status: "suspended" }).eq("user_id", userP);
  const suspended = await publishIdentity(admin, { userId: userP, discovery: "public", correlationId: CORR });
  const stillSuspended = await getIdentity(admin, userP);
  ok("3j. ⚠ A PRACTITIONER DOES NOT LIFT THEIR OWN SUSPENSION. s10's table lets `suspended` return to `active`, which is right for the lifecycle and wrong for a self-service button: a suspension somebody could clear from their own settings page is not a suspension",
    !suspended.ok && (suspended as any).code === "STATUS_NOT_SELF_SERVICE"
    && stillSuspended.status === "suspended" && NOT_SELF_PUBLISHABLE.has("suspended"),
    JSON.stringify({ code: (suspended as any).code, status: stillSuspended.status }));

  // ══ 4. TURNING IT OFF ═════════════════════════════════════════════════════════════════════════
  section("4. going private works at least as reliably as going public");

  const hideWhileSuspended = await updateIdentity(admin, { userId: userP, discovery: "hidden", correlationId: CORR });
  ok("4a. ⚠ GOING PRIVATE WORKS EVEN WHERE PUBLISHING IS REFUSED. The identity 3j just refused to publish is hidden here without argument -- somebody switching their page off may be doing it because a patient, an employer or a stranger has become a problem, and a precondition between them and that is a failure at the moment it matters most",
    hideWhileSuspended.ok && (await getIdentity(admin, userP)).discovery === "hidden",
    hideWhileSuspended.ok ? "" : (hideWhileSuspended as any).message);

  await admin.from("practice_practitioner_identity").update({ status: "active" }).eq("user_id", userP);
  await updateIdentity(admin, { userId: userP, discovery: "link_only", correlationId: CORR });
  ok("4b-control. the page is open again, so 4c is a switch being thrown rather than a state that never changed",
    (await resolveHandle(admin, HANDLE_P)).kind === "found");

  const goDark = await updateIdentity(admin, { userId: userP, discovery: "hidden", correlationId: CORR });
  const darkView = await identitySetupView(admin, { userId: userP, workspaceId: wsP });
  ok("4c. ⚠ AND IT STOPS OPENING IMMEDIATELY, FOR EVERYBODY -- including anybody holding a card or a code already given out -- and the share sheet goes with it",
    goDark.ok && (await resolveHandle(admin, HANDLE_P)).kind === "none"
    && darkView.sharing === null && darkView.address.state === "does_not_resolve",
    JSON.stringify({ sharing: darkView.sharing !== null, address: darkView.address.state }));

  for (const mode of DISCOVERY_MODES.filter(m => m.key !== "hidden")) {
    const set = await updateIdentity(admin, { userId: userP, discovery: mode.key, correlationId: CORR });
    const row = await getIdentity(admin, userP);
    ok(`4d. every mode s7 defines can actually be set -- ${mode.key}`,
      set.ok && row.discovery === mode.key, set.ok ? row.discovery : (set as any).message);
  }

  // ⚠ THE MESSAGE IS PART OF THE ASSERTION, AND THAT IS NOT PEDANTRY. There is a check constraint on the
  // column too, so deleting the engine's validation leaves the write refused by Postgres with the same
  // VALIDATION_ERROR code -- and this assertion would have gone on passing over a deleted guard. Naming
  // the modes is something only the engine's own refusal does. (Found by breaking it: the first version
  // of this line stayed green with the validation removed.)
  const bogus = await updateIdentity(admin, { userId: userP, discovery: "everybody", correlationId: CORR });
  ok("4e. and a mode s7 does not define is refused BY THIS ENGINE rather than written -- the refusal names the modes s7 defines, which the database's own constraint cannot do",
    !bogus.ok && (bogus as any).code === "VALIDATION_ERROR"
    && /must be one of/.test((bogus as any).message)
    && DISCOVERY_MODES.every(m => (bogus as any).message.includes(m.key))
    && (await getIdentity(admin, userP)).discovery !== "everybody",
    bogus.ok ? "it was written" : (bogus as any).message);

  // ⚠ userU has an identity and a handle but has never published; the refusal below is about the handle
  // rule in updateIdentity, so it is exercised on an identity that HAS one only after the control.
  await admin.from("practice_practitioner_identity").update({ handle: null }).eq("user_id", userU);
  const publicNoHandle = await updateIdentity(admin, { userId: userU, discovery: "public", correlationId: CORR });
  ok("4f. ⚠ `public` IS REFUSED WITHOUT A HANDLE. A public listing with no address is a page that cannot be found and cannot be identified, and it would still have published the row",
    !publicNoHandle.ok && (publicNoHandle as any).code === "NO_HANDLE",
    publicNoHandle.ok ? "it published" : (publicNoHandle as any).code);

  const linkNoHandle = await updateIdentity(admin, { userId: userU, discovery: "link_only", correlationId: CORR });
  ok("4f-control. and the refusal is specific to `public` -- link_only is accepted on the same handle-less identity, so 4f is about the listing rather than about the engine refusing everything",
    linkNoHandle.ok, linkNoHandle.ok ? "" : (linkNoHandle as any).message);
  await updateIdentity(admin, { userId: userU, discovery: "hidden", correlationId: CORR });

  // ══ 5. WHAT THE PAGE SAYS ═════════════════════════════════════════════════════════════════════
  section("5. the s6 profile fields, and nothing else");

  await updateIdentity(admin, { userId: userP, discovery: "link_only", correlationId: CORR });
  const saved = await updateIdentity(admin, {
    userId: userP, qualifications: "MBChB, MMed", specialties: "Neurosurgery",
    biography: "Spine surgery.", languages: "English, Luganda", consultationTypes: "In person",
    correlationId: CORR,
  });
  const publicProfile = await resolveHandle(admin, HANDLE_P);
  ok("5a. what a practitioner writes reaches the page a patient reads",
    saved.ok && publicProfile.kind === "found"
    && (publicProfile as any).profile.qualifications === "MBChB, MMed"
    && (publicProfile as any).profile.specialties === "Neurosurgery"
    && (publicProfile as any).profile.languages === "English, Luganda"
    && (publicProfile as any).profile.consultationTypes === "In person",
    JSON.stringify(publicProfile.kind === "found" ? publicProfile.profile : publicProfile));

  const formView = await identitySetupView(admin, { userId: userP, workspaceId: wsP });
  ok("5b. and the console gets them back, so the edit form is not a blank that erases what is there",
    formView.publicProfile.qualifications === "MBChB, MMed"
    && formView.publicProfile.biography === "Spine surgery.",
    JSON.stringify(formView.publicProfile));

  // ⚠ THE MESSAGE AGAIN, FOR THE SAME REASON. display_name is NOT NULL (migration 218), so removing the
  // engine's check leaves Postgres refusing the write with the same code -- two layers, and an assertion
  // that reads only the code cannot tell which of them is still standing.
  const blankName = await updateIdentity(admin, { userId: userP, displayName: "   ", correlationId: CORR });
  ok("5c. a blank display name is refused BY THIS ENGINE -- it is the one field the page cannot be published without, and the column being NOT NULL is a second layer rather than this one",
    !blankName.ok && (blankName as any).code === "VALIDATION_ERROR"
    && /display name is required/.test((blankName as any).message)
    && (await getIdentity(admin, userP)).display_name === "Dr Publication Harness",
    blankName.ok ? "it was cleared" : (blankName as any).message);

  ok("5d. and the licence record stays internal after publication -- the columns exist, and none of them reaches a patient",
    publicProfile.kind === "found"
    && !Object.keys((publicProfile as any).profile).some(k => /licence|verified|user|workspace/i.test(k)),
    JSON.stringify(Object.keys(publicProfile.kind === "found" ? publicProfile.profile : {})));

  // ══ 6. THE ENDPOINT ═══════════════════════════════════════════════════════════════════════════
  section("6. the subject is the caller, and no body names a state");

  // ⚠ THE CODE, WITH THE COMMENTS STRIPPED. The comments in that file exist precisely to say why
  // licence_verified has no door and why transitionIdentity is not imported, and an assertion that
  // forbade the words would forbid the explanation -- which is how a rule loses the note saying what it
  // is for. `routeCode` is what the runtime sees.
  ok("6a-control. the comment stripper leaves real code behind, so 6a and 6b are assertions about something rather than about an empty string",
    routeCode.length > 1000 && /publishIdentity/.test(routeCode) && !/⚠/.test(routeCode),
    `${routeCode.length} chars of code from ${routeSource.length} of file`);

  ok("6a. ⚠ NO CODE IN THE ROUTE NAMES `licence_verified`. Not as an option, not behind a confirmation, not in a list it filters -- the state has no practitioner-facing door to be argued through",
    !/licence_verified/.test(routeCode), "the route's code names licence_verified");

  ok("6b. and it cannot reach the lifecycle sideways either: it imports publishIdentity's fixed sequence and not transitionIdentity",
    /publishIdentity/.test(routeCode) && /updateIdentity/.test(routeCode)
    && !/transitionIdentity/.test(routeCode),
    "the route imports transitionIdentity");

  ok("6c. ⚠ A BODY THAT NAMES A LIFECYCLE STATE IS REFUSED, NOT IGNORED. Dropping the field is the polite option and the dangerous one: it leaves a caller believing they set a state, and the next person to add a field one spread operator away from honouring it",
    /STATUS_NOT_ACCEPTED/.test(routeCode)
    && ["status", "to", "transition", "licenceReference"].every(k => new RegExp(`"${k}"`).test(routeCode)),
    "the guard does not cover every way of naming a state");

  const subjects = routeCode.match(/userId:\s*[^,\n]+/g) ?? [];
  ok("6d. ⚠ THE SUBJECT IS THE CALLER, EVERY TIME. Every engine call in the route names ctx.userId and nothing reads a subject out of the body -- an identity is permanent and public, so a body-supplied target would let one practice publish another person's name, qualifications and place of work",
    subjects.length >= 5 && subjects.every(s => s.trim() === "userId: ctx.userId")
    && !/body\.(userId|user_id|targetUserId|subject|actorId)/.test(routeCode),
    JSON.stringify(subjects));

  // ⚠ AND THE ENGINE AGREES, NOT ONLY THE ROUTE -- WITH A TARGET THAT COULD ACTUALLY HAVE BEEN STOLEN.
  //
  // The first version of this named the UNCONFIRMED practitioner as the target, and it could not fail:
  // that identity had no handle and no confirmed email, so a subject-swapping engine would have refused
  // anyway and the assertion would have passed over the bug. userT is a second CONFIRMED practitioner
  // holding a claimed handle and sitting `created`/`hidden` -- everything a publish needs. If the engine
  // took its subject from the fields handed in below, userT's page would open. It must not.
  const beforeT = await getIdentity(admin, userT);
  const stolen = await publishIdentity(admin, {
    userId: userP, discovery: "public", correlationId: CORR,
    ...({ targetUserId: userT, user_id: userT, subject: userT, userID: userT } as any),
  } as any);
  const afterT = await getIdentity(admin, userT);
  ok("6e. ⚠ AND NAMING SOMEBODY ELSE IN THE CALL PUBLISHES THE CALLER, NEVER THEM. The second practitioner has a claimed handle, a confirmed sign-in and nothing standing in the way -- and is still `created`, still hidden, and still does not resolve",
    stolen.ok && afterT.status === "created" && afterT.discovery === "hidden"
    && afterT.status === beforeT.status
    && (await resolveHandle(admin, HANDLE_T)).kind === "none",
    JSON.stringify({ published: stolen.ok, t: afterT.status, d: afterT.discovery }));

  ok("6e-control. and the caller WAS published by that same call, so 6e is a subject that stayed put rather than a call that did nothing",
    (await getIdentity(admin, userP)).discovery === "public",
    (await getIdentity(admin, userP)).discovery);

  // ══ PUT IT BACK ═══════════════════════════════════════════════════════════════════════════════
  await cleanup();
  const gone = await resolveHandle(admin, HANDLE_P);
  ok("teardown. the published address is taken back down, and the handle is free for the next run -- this harness claims and never changes, so nothing was retired into practice_handle_history",
    gone.kind === "none", JSON.stringify(gone));

  report();
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
