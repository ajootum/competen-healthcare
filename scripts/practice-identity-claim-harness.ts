/**
 * Practitioner identity issuance and handle claiming -- PIS-000 s2, s3, s8, s15.
 * Migrations 218 (identity, reserved handles, handle history), 219/220 (the number), 254 (booking access).
 *
 * WHAT IT PROVES:
 *   1. PROVISIONING ISSUES THE IDENTITY. It was a written function nothing called; every new practice now
 *      gets a permanent practitioner number without anybody asking for one.
 *   2. AND ISSUES NO PUBLIC NAME. The row arrives with a NULL handle, hidden, unreachable. A public
 *      address is a choice, not a side effect of signing up.
 *   3. ISSUANCE CANNOT BREAK PROVISIONING. A practice whose identity could not be issued is still a
 *      working practice, the failure is in the audit trail, and a later run issues the identity.
 *   4. THE SCHEMA PERMITS A NULL HANDLE, and migration 254's foreign key tolerates it -- while the
 *      DATABASE, not this code, refuses a published booking page that has no address.
 *   5. THE CLAIM IS ATOMIC. Two practitioners claiming the same handle at the same instant produce one
 *      winner and one HANDLE_TAKEN, and the unique index refuses the collision even to a caller that
 *      skipped every check.
 *   6. RESERVED AND RETIRED HANDLES ARE REFUSED, and a retired one stays claimed by its old owner.
 *   7. THE AVAILABILITY CHECK IS ONE BIT. Taken, reserved and retired are indistinguishable, and nothing
 *      in the answer names a person, a practice or a reason.
 *   8. A FAILED READ IS NEVER "FREE". An unreadable reserved list refuses the claim rather than allowing
 *      it, and writes nothing.
 *   9. THE SETUP PAYLOAD HAS THREE STATES AND NO FUNCTIONS -- unclaimed renders as unclaimed, and a
 *      method on the payload would cross to a client component and kill the page.
 *
 *   npx --yes tsx scripts/practice-identity-claim-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import {
  issueIdentity, getIdentity, claimHandle, changeHandle, checkHandle,
  identitySetupView, resolveDisplayName, bookingUrl,
  HANDLE_PERMANENCE_NOTICE,
} from "../src/lib/practice/identity-service";
import { getFormat, parsePractitionerNumber } from "../src/lib/practice/identifier-format";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

/* eslint-disable @typescript-eslint/no-explicit-any */

const P = "00000000-0000-4000-8000-00000000c1a1";
const Q = "00000000-0000-4000-8000-00000000c1a2";
const R = "00000000-0000-4000-8000-00000000c1a3";
const USERS = [P, Q, R];

const CORR = "harness-identity-claim";

// Distinctive so a real practitioner could never be holding one of them.
const H_ALPHA = "hclaimalpha";
const H_RACE = "hclaimrace";
const H_FIRST = "hclaimfirst";
const H_SECOND = "hclaimsecond";

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

async function provision(user: string, name: string, suffix: string) {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `${CORR}-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error) throw new Error(`could not create a provisioning request: ${error.message}`);
  const run = await runProvisioning(
    admin, { id: req!.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload(name));
  return { requestId: req!.id as string, run };
}

/**
 * ⚠ ORDER MATTERS HERE AND THE SCHEMA IS WHY. practice_booking_access.handle references the identity's
 * handle ON DELETE RESTRICT, so an identity cannot be deleted while a booking page points at it. The
 * booking pages go first, then the workspaces, then the identities.
 *
 * ⚠ THE AUDIT TRAIL IS NOT CLEANED, BECAUSE IT CANNOT BE. practice_audit_event refuses DELETE -- probed,
 * not assumed: it answers "practice_audit_event is append only. DELETE refused on audit row ...". Other
 * harnesses in this repository attempt exactly that delete and discard its error, which is why they leave
 * rows behind and why nothing has ever noticed. So every audit assertion below identifies ITS OWN row by
 * the moment this run started, rather than counting rows and hoping the table was empty.
 */
async function cleanup() {
  for (const u of USERS) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_booking_access").delete().eq("workspace_id", w.id);    }
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, USERS);
}

/**
 * An admin client whose reads of ONE table fail.
 *
 * ⚠ THE POINT IS THAT A FAILURE MUST NOT LOOK LIKE AN ANSWER. practice_reserved_handle and
 * practice_handle_history have no database constraint tying them to the identity's handle column, so the
 * READ is the only thing enforcing them -- and a read that fails open would hand somebody @support.
 */
function adminWithBrokenTable(table: string) {
  const error = { message: "simulated read failure", code: "XXBRK", details: "", hint: "" };
  const broken: any = {};
  for (const m of ["select", "eq", "is", "in", "limit", "order", "not", "ilike"]) broken[m] = () => broken;
  broken.maybeSingle = async () => ({ data: null, error });
  broken.single = async () => ({ data: null, error });
  broken.then = (resolve: any, reject: any) => Promise.resolve({ data: null, error }).then(resolve, reject);
  return {
    from: (name: string) => (name === table ? broken : (admin as any).from(name)),
    rpc: (...args: any[]) => (admin as any).rpc(...args),
  } as any;
}

/**
 * Every path in a payload holding something that cannot cross the server/client boundary.
 *
 * ⚠ NOT JUST FUNCTIONS. A Map, a Set, a Date or a class instance all serialise to something that is not
 * what they were -- a Map becomes `{}`, silently -- so a round-trip comparison through JSON says they are
 * fine. This walks to the leaves and names anything that is not a string, a number, a boolean, null, a
 * plain object or an array. `kind` is reported so the assertion can separate "a method" from "a Map".
 */
function unsafePaths(value: any, path = "$"): { path: string; kind: string }[] {
  if (value === null) return [];
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return [];
  if (t === "function") return [{ path, kind: "function" }];
  if (t !== "object") return [{ path, kind: t }];
  if (Array.isArray(value)) return value.flatMap((v, i) => unsafePaths(v, `${path}[${i}]`));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    return [{ path, kind: value.constructor?.name ?? "exotic" }];
  return Object.entries(value).flatMap(([k, v]) => unsafePaths(v, `${path}.${k}`));
}

async function main() {
  console.log("\nPractitioner identity issuance and handle claiming (PIS-000 s2, s3, s8, s15)\n");
  await cleanup();
  // Every audit assertion is scoped to this instant onward. See cleanup(): the trail is append-only.
  const startedAt = new Date(Date.now() - 1000).toISOString();

  // ══ 1, 2. PROVISIONING ISSUES THE ROW, AND ONLY THE ROW ═══════════════════════════════════════════
  const { requestId: reqP, run: runP } = await provision(P, "Dr Miriam Kasule", "p");
  ok("1. provisioning succeeds", runP.ok, JSON.stringify(runP));
  ok("1b. AND REPORTS THAT IT ISSUED AN IDENTITY -- the step is not silent",
    runP.identityIssued === true, String(runP.identityIssued));

  const idP = await getIdentity(admin, P);
  ok("1c. AN IDENTITY EXISTS FOR THE PRACTITIONER, issued by provisioning and by nothing else",
    idP !== null, "no identity row after provisioning");
  if (!idP) return report();

  const format = await getFormat(admin);
  ok("1d. with a permanent number in the configured format, which parses and check-digits",
    parsePractitionerNumber(idP.practitioner_number, format).ok === true, idP.practitioner_number);
  ok("1e. and the name provisioning was given",
    idP.display_name === "Dr Miriam Kasule", String(idP.display_name));

  ok("2. AND NO HANDLE. A public address is not a side effect of signing up",
    idP.handle === null, String(idP.handle));
  ok("2b. and it publishes nothing: hidden, and only 'created'",
    idP.discovery === "hidden" && idP.status === "created",
    JSON.stringify({ d: idP.discovery, s: idP.status }));

  // Idempotence on resume -- the saga is re-runnable by design.
  const rerun = await runProvisioning(
    admin, { id: reqP, target_user_id: P, correlation_id: CORR, workspace_id: null }, payload("Dr Miriam Kasule"));
  const { count: idCount } = await admin.from("practice_practitioner_identity")
    .select("*", { count: "exact", head: true }).eq("user_id", P);
  const idP2 = await getIdentity(admin, P);
  ok("2c. RE-RUNNING PROVISIONING DOES NOT ISSUE A SECOND IDENTITY OR A SECOND NUMBER",
    rerun.ok && idCount === 1 && idP2.practitioner_number === idP.practitioner_number,
    JSON.stringify({ count: idCount, before: idP.practitioner_number, after: idP2?.practitioner_number }));

  // ══ 3. ISSUANCE CANNOT BREAK PROVISIONING ═════════════════════════════════════════════════════════
  //
  // A one-character display name is a name practice_workspace accepts (1..120) and the identity refuses
  // (2..120), so issuance fails for a reason that is real rather than injected -- and provisioning must
  // carry on regardless, because it is the critical path for every new practice on this platform.
  const { requestId: reqQ, run: runQ } = await provision(Q, "Q", "q");
  ok("3. PROVISIONING SUCCEEDS EVEN THOUGH THE IDENTITY COULD NOT BE ISSUED",
    runQ.ok === true, JSON.stringify(runQ));
  ok("3b. and says so rather than claiming an identity it does not have",
    runQ.identityIssued === false, String(runQ.identityIssued));
  ok("3c. no identity was written", (await getIdentity(admin, Q)) === null);

  const { data: wsQrow } = await admin.from("practice_workspace")
    .select("id, status").eq("owner_person_id", Q).maybeSingle();
  const { data: memQ } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", wsQrow?.id ?? "00000000-0000-4000-8000-000000000000");
  const memIds = ((memQ ?? []) as { id: string }[]).map(m => m.id);
  const { count: capsQ } = await admin.from("practice_role_assignment")
    .select("*", { count: "exact", head: true })
    .in("membership_id", memIds.length ? memIds : ["00000000-0000-4000-8000-000000000000"]);
  ok("3d. CONTROL: THE PRACTICE IS COMPLETE AND USABLE -- nothing was stranded",
    wsQrow?.status === "ONBOARDING" && (capsQ ?? 0) > 0,
    JSON.stringify({ status: wsQrow?.status, capabilities: capsQ }));

  const { data: deferred } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("actor_id", Q)
    .eq("event_type", "practice.identity_issue_deferred").gte("occurred_at", startedAt);
  const mine = (deferred ?? []).filter(d => (d.payload as any)?.requestId === reqQ);
  ok("3e. and the failure is IN THE AUDIT TRAIL rather than merely absent",
    mine.length === 1 && (mine[0].payload as any).errorCode === "VALIDATION_ERROR" &&
    /name/i.test(String((mine[0].payload as any).message)),
    JSON.stringify(deferred));

  // Now give Q a real identity, the way a later run or Practice Setup would.
  const lateQ = await issueIdentity(admin, {
    userId: Q, displayName: "Dr Grace Nabbosa", workspaceId: wsQrow?.id ?? null, correlationId: CORR,
  });
  ok("3f. AND IT IS RECOVERABLE: issuing later succeeds and creates exactly one",
    lateQ.ok && (lateQ as any).data.created === true && (lateQ as any).data.handle === null,
    JSON.stringify(lateQ));

  const { run: runR } = await provision(R, "Dr Peter Obua", "r");
  ok("3g. a third practitioner is provisioned for the collision tests",
    runR.ok && runR.identityIssued === true, JSON.stringify(runR));

  // ══ 4. THE SCHEMA, AND WHO OWNS THE PUBLISH RULE ══════════════════════════════════════════════════
  const wsP = idP.primary_workspace_id as string;
  const { error: accessError } = await admin.from("practice_booking_access")
    .insert({ workspace_id: wsP, handle: null });
  ok("4. A BOOKING PAGE MAY EXIST WITH NO HANDLE -- migration 254's foreign key tolerates a null",
    !accessError, accessError?.message ?? "");

  const { error: publishNoHandle } = await admin.from("practice_booking_access")
    .update({ mode: "link_only", publish_state: "published" }).eq("workspace_id", wsP);
  ok("4b. BUT THE DATABASE REFUSES TO PUBLISH ONE WITHOUT AN ADDRESS -- and it is the database, not this code",
    !!publishNoHandle && (publishNoHandle as any).code === "23514" &&
    /publishable/i.test(publishNoHandle.message),
    JSON.stringify(publishNoHandle));

  const { error: fkError } = await admin.from("practice_booking_access")
    .update({ handle: "nobodyholdsthisatall" }).eq("workspace_id", wsP);
  ok("4c. and a handle no identity holds is refused by the foreign key, so there is ONE namespace",
    !!fkError && (fkError as any).code === "23503", JSON.stringify(fkError));

  // ══ 5. THE CLAIM ══════════════════════════════════════════════════════════════════════════════════
  const viewBefore = await identitySetupView(admin, { userId: P, workspaceId: wsP });
  ok("5. AN UNCLAIMED ADDRESS RENDERS AS UNCLAIMED -- not blank, not an error",
    viewBefore.state === "unclaimed" && viewBefore.handle === null && viewBefore.bookingUrl === null &&
    viewBefore.practitionerNumber === idP.practitioner_number,
    JSON.stringify({ s: viewBefore.state, h: viewBefore.handle, u: viewBefore.bookingUrl }));
  ok("5b. with candidates OFFERED from the name",
    viewBefore.suggestions.includes("mkasule") && viewBefore.suggestionsIncomplete === false,
    JSON.stringify(viewBefore.suggestions));
  ok("5c. AND NONE OF THEM APPLIED -- building the view claims nothing",
    (await getIdentity(admin, P)).handle === null);
  ok("5d. and it carries the warning that a handle is close to permanent",
    viewBefore.permanenceNotice === HANDLE_PERMANENCE_NOTICE &&
    /not released|stays attached/i.test(viewBefore.permanenceNotice),
    viewBefore.permanenceNotice.slice(0, 60));

  const claimed = await claimHandle(admin, { userId: P, handle: `@${H_FIRST.toUpperCase()} `, correlationId: CORR });
  ok("5e. THE CLAIM WRITES THE ADDRESS, normalised, with the URL a patient would be given",
    claimed.ok && (claimed as any).data.handle === H_FIRST &&
    (claimed as any).data.bookingUrl === bookingUrl(H_FIRST),
    JSON.stringify(claimed));

  const again = await claimHandle(admin, { userId: P, handle: H_SECOND, correlationId: CORR });
  ok("5f. A CLAIM CANNOT BE REPEATED -- a second one would retire the first silently",
    !again.ok && (again as any).code === "HANDLE_ALREADY_CLAIMED",
    again.ok ? "it happened" : (again as any).code);
  ok("5g. and the original address is untouched",
    (await getIdentity(admin, P)).handle === H_FIRST);

  const viewAfter = await identitySetupView(admin, { userId: P, workspaceId: wsP });
  ok("5h. the view now reports it claimed, with the booking URL",
    viewAfter.state === "claimed" && viewAfter.handle === H_FIRST &&
    viewAfter.bookingUrl === bookingUrl(H_FIRST),
    JSON.stringify({ s: viewAfter.state, h: viewAfter.handle }));

  // The publish rule, now that there is something to publish at. This is the CONTROL for 4b: the same
  // update that the database refused a moment ago succeeds once an address exists.
  await admin.from("practice_booking_access").update({ handle: H_FIRST }).eq("workspace_id", wsP);
  const { error: publishNow } = await admin.from("practice_booking_access")
    .update({ mode: "link_only", publish_state: "published" }).eq("workspace_id", wsP);
  ok("4d. CONTROL: with an address claimed, the same publish the database refused is allowed",
    !publishNow, publishNow?.message ?? "");
  await admin.from("practice_booking_access").update({ publish_state: "draft" }).eq("workspace_id", wsP);

  const { data: claimAudit } = await admin.from("practice_audit_event")
    .select("payload").eq("actor_id", P).eq("event_type", "practice.handle_claimed")
    .gte("occurred_at", startedAt);
  ok("5i. and the claim is recorded, with the address and the URL",
    (claimAudit ?? []).length === 1 &&
    (claimAudit![0].payload as any).handle === H_FIRST &&
    (claimAudit![0].payload as any).bookingUrl === bookingUrl(H_FIRST),
    JSON.stringify(claimAudit));

  // ══ 6. ATOMIC UNDER CONCURRENCY ═══════════════════════════════════════════════════════════════════
  //
  // ⚠ THE TRAP THIS CODEBASE HAS NOW BEEN BITTEN BY THREE TIMES. Both callers read "available" and both
  // proceed; only the unique index can decide. Nothing here is serialised by the harness.
  const [raceQ, raceR] = await Promise.all([
    claimHandle(admin, { userId: Q, handle: H_RACE, correlationId: CORR }),
    claimHandle(admin, { userId: R, handle: H_RACE, correlationId: CORR }),
  ]);
  const winners = [raceQ, raceR].filter(r => r.ok);
  const losers = [raceQ, raceR].filter(r => !r.ok);
  ok("6. TWO PRACTITIONERS CLAIMING THE SAME HANDLE AT ONCE PRODUCE EXACTLY ONE WINNER",
    winners.length === 1 && losers.length === 1,
    JSON.stringify([raceQ, raceR]));
  ok("6b. and the loser is told it is taken, not handed a database message",
    losers.length === 1 && (losers[0] as any).code === "HANDLE_TAKEN" &&
    !/constraint|duplicate key|violates/i.test((losers[0] as any).message),
    JSON.stringify(losers[0]));

  const { count: holders } = await admin.from("practice_practitioner_identity")
    .select("*", { count: "exact", head: true }).eq("handle", H_RACE);
  ok("6c. and exactly one identity holds it in the database", holders === 1, String(holders));

  // ⚠ THE INDEX IS THE CONTROL, NOT THE CHECK ABOVE IT. A caller that skipped every read still cannot
  // collide, which is what makes the claim safe rather than merely usually safe.
  const loserUser = raceQ.ok ? R : Q;
  const loserIdentity = await getIdentity(admin, loserUser);
  const { error: rawCollision } = await admin.from("practice_practitioner_identity")
    .update({ handle: H_RACE }).eq("id", loserIdentity?.id ?? "00000000-0000-4000-8000-000000000000");
  ok("6d. AND A RAW WRITE THAT SKIPPED EVERY CHECK IS STILL REFUSED, by the unique index",
    !!rawCollision && (rawCollision as any).code === "23505", JSON.stringify(rawCollision));

  // ══ 7. RESERVED AND RETIRED ═══════════════════════════════════════════════════════════════════════
  const freeR = loserUser; // the identity that lost the race, and so is still unclaimed
  const reserved = await claimHandle(admin, { userId: freeR, handle: "support", correlationId: CORR });
  ok("7. A RESERVED HANDLE IS REFUSED (s4)",
    !reserved.ok && (reserved as any).code === "HANDLE_RESERVED",
    reserved.ok ? "it was claimed" : (reserved as any).code);
  ok("7b. AND THE REFUSAL DOES NOT SAY WHY IT IS RESERVED -- the reason column is not repeated back",
    !reserved.ok && !/platform|brand|profession|routing|generic/i.test((reserved as any).message),
    reserved.ok ? "" : (reserved as any).message);
  ok("7c. CONTROL: an ordinary free handle is available, so the refusal is about the reserve list",
    (await checkHandle(admin, H_ALPHA)).state === "available");

  // P changes address; the old one is retired and stays claimed for ever.
  const moved = await changeHandle(admin, { userId: P, handle: H_SECOND, correlationId: CORR });
  ok("7d. changing an address retires the old one rather than freeing it",
    moved.ok && (moved as any).data.previous === H_FIRST, JSON.stringify(moved));
  const stealRetired = await claimHandle(admin, { userId: freeR, handle: H_FIRST, correlationId: CORR });
  ok("7e. AND NOBODY ELSE MAY CLAIM IT -- a printed QR code must never reach a stranger",
    !stealRetired.ok && (stealRetired as any).code === "HANDLE_RETIRED",
    stealRetired.ok ? "it was claimed" : (stealRetired as any).code);

  // ══ 8. ONE BIT ════════════════════════════════════════════════════════════════════════════════════
  const takenBit = await checkHandle(admin, H_RACE);
  const reservedBit = await checkHandle(admin, "support");
  const retiredBit = await checkHandle(admin, H_FIRST);
  ok("8. TAKEN, RESERVED AND RETIRED ARE THE SAME ANSWER -- one bit, not three",
    takenBit.state === "unavailable" && reservedBit.state === "unavailable" &&
    retiredBit.state === "unavailable",
    JSON.stringify([takenBit.state, reservedBit.state, retiredBit.state]));

  const bits = JSON.stringify([takenBit, reservedBit, retiredBit]);
  ok("8b. and the answers name nobody: no user, no identity, no practice, no reason",
    !bits.includes(P) && !bits.includes(Q) && !bits.includes(R) && !bits.includes(wsP) &&
    !/reserved|retired|taken|reason|Kasule|Nabbosa|Obua/i.test(bits),
    bits.slice(0, 200));
  ok("8c. CONTROL: a free one and a malformed one ARE distinguished, because neither discloses a person",
    (await checkHandle(admin, H_ALPHA)).state === "available" &&
    (await checkHandle(admin, "ab")).state === "invalid");
  ok("8d. and a valid candidate comes back with the URL it would become",
    (await checkHandle(admin, H_ALPHA)).url === bookingUrl(H_ALPHA));

  // ══ 9. A FAILED READ IS NEVER "FREE" ══════════════════════════════════════════════════════════════
  const brokenReserved = adminWithBrokenTable("practice_reserved_handle");
  const blindClaim = await claimHandle(brokenReserved, { userId: freeR, handle: H_ALPHA, correlationId: CORR });
  ok("9. AN UNREADABLE RESERVE LIST REFUSES THE CLAIM rather than allowing it",
    !blindClaim.ok && (blindClaim as any).code === "HANDLE_UNREADABLE",
    blindClaim.ok ? "it was claimed" : (blindClaim as any).code);
  ok("9b. and nothing was written",
    (await getIdentity(admin, freeR)).handle === null, String((await getIdentity(admin, freeR)).handle));
  ok("9c. and the availability check reports it unreadable, never available",
    (await checkHandle(brokenReserved, H_ALPHA)).state === "unreadable");
  ok("9d. CONTROL: the same handle on a working client IS available, so 9 is about the failure",
    (await checkHandle(admin, H_ALPHA)).state === "available");

  const brokenIdentity = adminWithBrokenTable("practice_practitioner_identity");
  const blindView = await identitySetupView(brokenIdentity, { userId: P, workspaceId: wsP });
  ok("9e. AN UNREADABLE IDENTITY IS `unreadable`, NOT `none` -- otherwise a screen would offer to issue a second permanent number",
    blindView.state === "unreadable" && blindView.reason !== null,
    JSON.stringify({ s: blindView.state, r: blindView.reason }));

  // ══ 10. THE PAYLOAD THAT CROSSES TO A CLIENT COMPONENT ════════════════════════════════════════════
  const noIdentityView = await identitySetupView(admin, {
    userId: "00000000-0000-4000-8000-0000000000fe", workspaceId: wsP, fallbackDisplayName: "Nobody At All",
  });
  ok("10. THE THIRD STATE EXISTS: a practice with no identity row reports `none`, not an error",
    noIdentityView.state === "none" && noIdentityView.practitionerNumber === null &&
    noIdentityView.displayName === "Nobody At All",
    JSON.stringify({ s: noIdentityView.state }));

  const walked = [viewBefore, viewAfter, noIdentityView, blindView]
    .flatMap((v, i) => unsafePaths(v, `view${i}`));
  ok("10b. AND NOTHING IN ANY OF THE FOUR STATES IS A FUNCTION -- a method here is tsc-clean and kills the page",
    walked.filter(w => w.kind === "function").length === 0,
    walked.map(w => `${w.path}:${w.kind}`).join(", "));
  ok("10c. nor a Map, a Set, a Date or anything else that arrives as a different object than it left",
    walked.length === 0, walked.map(w => `${w.path}:${w.kind}`).join(", "));
  // ⚠ WITHOUT THIS, 10b AND 10c ARE A FUNCTION THAT RETURNS AN EMPTY ARRAY. The walker is given something
  // it must object to, of each kind, and has to find every one.
  const canary = unsafePaths({
    fine: "a string", alsoFine: [1, true, null], nested: { deep: { ok: 2 } },
    method: () => 1, map: new Map(), when: new Date(), set: new Set(),
  });
  ok("10c-control. ⚠ and the walker CAN object -- it finds a method, a Map, a Date and a Set, and nothing else",
    canary.length === 4 &&
    canary.map(c => c.path.replace("$.", "")).sort().join(",") === "map,method,set,when",
    JSON.stringify(canary));

  ok("10d. the booking page is reported as its own thing, and this build creates none",
    viewAfter.bookingPage.state === "present" && noIdentityView.bookingPage.state === "present",
    JSON.stringify(viewAfter.bookingPage));

  // ══ 11. THE NAME AN IDENTITY IS ISSUED UNDER ══════════════════════════════════════════════════════
  ok("11. the display name falls back to the individual practice's own name",
    (await resolveDisplayName(admin, P, wsP)) === "Dr Miriam Kasule",
    String(await resolveDisplayName(admin, P, wsP)));
  ok("11b. and with no practice to ask, it refuses to invent one",
    (await resolveDisplayName(admin, "00000000-0000-4000-8000-0000000000fe", null)) === null);

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exitCode = 1; }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
